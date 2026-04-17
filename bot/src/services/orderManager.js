const gateClient = require('../api/gateClient');
const config = require('../config');
const logger = require('../utils/logger');
const kellyPersistence = require('../utils/kellyPersistence');

/**
 * 주문 실행 및 포지션 관리 서비스 (멀티 페어 지원)
 *
 * 페어별 독립 상태:
 *  - slOrderIds / tpOrderIds / lastKnownPositions : pair → value Map
 *  - tradeStatsByPair                            : pair → Kelly 통계 (영구 저장)
 *  - openExposureUsdt                            : pair → leveraged notional (USDT)
 *
 * 전역 상태:
 *  - dailyPnl (전 페어 합산 일일 손익, maxDailyLossUsdt 한도 적용, 영구 저장)
 */
class OrderManager {
  constructor() {
    // 페어별 상태 (런타임)
    this.slOrderIds = new Map();
    this.tpOrderIds = new Map();
    this.lastKnownPositions = new Map();
    this.tradeStatsByPair = new Map();
    this.openExposureUsdt = new Map();

    // Phase B/C: SL/TP 트리거 가격 저장 (복원/재등록용)
    // 주문 ID만 있으면 취소는 가능하지만 재등록하려면 가격이 필요하다.
    this.slPrices = new Map();
    this.tpPrices = new Map();

    // Phase C: 주기적 SL/TP 존재 검증 카운터 (페어별)
    this.sltpCheckCounter = new Map();

    // race condition 방지: 포지션 조회 empty 연속 횟수
    // 1-2회 null은 Gate.io 일시 장애/eventual consistency로 보고 무시,
    // 3회 연속이면 진짜 청산으로 판단
    this.emptyReadCount = new Map();

    // 영구 저장에서 복원
    this._loadPersistedStats();
  }

  // ===== Phase B/C 공통 헬퍼: SL/TP 상태 저장/정리 =====

  /**
   * SL/TP 주문 결과를 내부 Map에 기록
   * @param {string} contract
   * @param {object|null} slOrder placeSLTP 결과의 slOrder
   * @param {object|null} tpOrder placeSLTP 결과의 tpOrder
   * @param {number} slPrice 설정한 SL 가격
   * @param {number} tpPrice 설정한 TP 가격
   */
  _storeSLTP(contract, slOrder, tpOrder, slPrice, tpPrice) {
    this.slOrderIds.set(contract, slOrder ? slOrder.id : null);
    this.tpOrderIds.set(contract, tpOrder ? tpOrder.id : null);
    if (Number.isFinite(slPrice) && slPrice > 0) this.slPrices.set(contract, slPrice);
    if (Number.isFinite(tpPrice) && tpPrice > 0) this.tpPrices.set(contract, tpPrice);
  }

  /**
   * 포지션 종료/청산 시 해당 페어 관련 런타임 Map 전부 정리
   */
  _clearPairState(contract) {
    this.slOrderIds.delete(contract);
    this.tpOrderIds.delete(contract);
    this.slPrices.delete(contract);
    this.tpPrices.delete(contract);
    this.sltpCheckCounter.delete(contract);
    this.openExposureUsdt.delete(contract);
  }

  /**
   * 트리거 주문을 SL/TP로 분류 (Phase B)
   *  - long:  SL = rule 2 (<=) & price < entry,  TP = rule 1 (>=) & price > entry
   *  - short: SL = rule 1 (>=) & price > entry,  TP = rule 2 (<=) & price < entry
   * 첫 번째 매칭만 채택 (중복 시 가장 먼저 발견한 것 사용)
   */
  _classifyTriggers(orders, direction, entry) {
    let sl = null;
    let tp = null;
    for (const order of orders) {
      const price = parseFloat(order.trigger && order.trigger.price);
      const rule = order.trigger && order.trigger.rule;
      if (!Number.isFinite(price) || price <= 0) continue;

      if (direction === 'long') {
        if (rule === 2 && price < entry && !sl) sl = { id: order.id, price };
        else if (rule === 1 && price > entry && !tp) tp = { id: order.id, price };
      } else {
        if (rule === 1 && price > entry && !sl) sl = { id: order.id, price };
        else if (rule === 2 && price < entry && !tp) tp = { id: order.id, price };
      }
    }
    return { sl, tp };
  }

  /**
   * SL/TP 가격을 현재 mark price 기준으로 "올바른 방향"에 있는지 검증 & 필요 시 조정
   *
   *  - long  SL : mark 미만   | long  TP : mark 초과
   *  - short SL : mark 초과   | short TP : mark 미만
   *
   * 이탈된 경우 (예: 진입 후 급등으로 폴백 TP 가 이미 mark 아래) 해당 쪽만
   * mark × (1 ± pct) 로 재계산. Gate.io 가 "trigger 즉시 발동" 상태로 거부하는
   * 400 에러 방지. (2026-04-16 XRP_USDT 사례)
   *
   * @returns {{sl: number, tp: number, adjusted: boolean}}
   */
  _adjustPricesToMark(direction, mark, sl, tp) {
    if (!Number.isFinite(mark) || mark <= 0) return { sl, tp, adjusted: false };
    const slPct = Math.max(config.stopLossPercent, 0) / 100;
    const tpPct = Math.max(config.takeProfitPercent, 0) / 100;

    let newSl = sl;
    let newTp = tp;
    let adjusted = false;

    if (direction === 'long') {
      if (Number.isFinite(sl) && sl >= mark) {
        newSl = mark * (1 - slPct);
        adjusted = true;
      }
      if (Number.isFinite(tp) && tp <= mark) {
        newTp = mark * (1 + tpPct);
        adjusted = true;
      }
    } else {
      if (Number.isFinite(sl) && sl <= mark) {
        newSl = mark * (1 + slPct);
        adjusted = true;
      }
      if (Number.isFinite(tp) && tp >= mark) {
        newTp = mark * (1 - tpPct);
        adjusted = true;
      }
    }

    return { sl: newSl, tp: newTp, adjusted };
  }

  /**
   * 저장된 Kelly 통계 + dailyPnl 복원
   */
  _loadPersistedStats() {
    try {
      const data = kellyPersistence.load();

      // dailyPnl 복원 (같은 날짜일 때만)
      if (data.dailyPnl && data.dailyPnl.date === new Date().toDateString()) {
        this.dailyPnl = data.dailyPnl.pnl || 0;
        this.dailyPnlResetDate = data.dailyPnl.date;
        logger.info(`일일 PnL 복원: ${this.dailyPnl.toFixed(2)} USDT (${this.dailyPnlResetDate})`);
      } else {
        this.dailyPnl = 0;
        this.dailyPnlResetDate = new Date().toDateString();
      }

      // 페어별 Kelly 통계 복원
      if (data.pairs) {
        for (const [pair, stats] of Object.entries(data.pairs)) {
          this.tradeStatsByPair.set(pair, {
            wins: stats.wins || 0,
            losses: stats.losses || 0,
            totalWinUsdt: stats.totalWinUsdt || 0,
            totalLossUsdt: stats.totalLossUsdt || 0,
          });
        }
        const total = [...this.tradeStatsByPair.values()].reduce((s, v) => s + v.wins + v.losses, 0);
        if (total > 0) {
          logger.info(`Kelly 통계 복원: ${this.tradeStatsByPair.size}개 페어, 총 ${total}건 거래`);
        }
      }
    } catch (err) {
      logger.error(`Kelly 통계 복원 실패 (기본값 사용): ${err.message}`);
      this.dailyPnl = 0;
      this.dailyPnlResetDate = new Date().toDateString();
    }
  }

  /**
   * 현재 통계를 영구 저장 (실패해도 봇 크래시 안 함)
   */
  _saveStats() {
    try {
      kellyPersistence.save(this.tradeStatsByPair, this.dailyPnl, this.dailyPnlResetDate);
    } catch (err) {
      logger.error(`Kelly 통계 저장 실패 (무시): ${err.message}`);
    }
  }

  // ===== Kelly 통계 (페어별) =====

  _getStats(pair) {
    if (!this.tradeStatsByPair.has(pair)) {
      this.tradeStatsByPair.set(pair, {
        wins: 0,
        losses: 0,
        totalWinUsdt: 0,
        totalLossUsdt: 0,
      });
    }
    return this.tradeStatsByPair.get(pair);
  }

  recordTradeResult(pair, pnl) {
    const s = this._getStats(pair);
    if (pnl > 0) {
      s.wins += 1;
      s.totalWinUsdt += pnl;
    } else if (pnl < 0) {
      s.losses += 1;
      s.totalLossUsdt += Math.abs(pnl);
    }
    this._saveStats();
  }

  /**
   * 페어별 Kelly Criterion 비율 계산
   *   f* = p - (1 - p) / R
   *   표본 부족 시 defaultFraction, 음수면 0
   */
  calculateKellyFraction(pair) {
    const k = config.kelly;
    const { wins, losses, totalWinUsdt, totalLossUsdt } = this._getStats(pair);
    const total = wins + losses;

    if (total < k.minTrades || wins === 0 || losses === 0) {
      return k.defaultFraction;
    }

    const p = wins / total;
    const avgWin = totalWinUsdt / wins;
    const avgLoss = totalLossUsdt / losses;
    const R = avgWin / avgLoss;

    const raw = p - (1 - p) / R;
    if (raw <= 0) return 0;

    return Math.min(raw * k.fraction, k.maxFraction);
  }

  // ===== 노출 관리 =====

  /** 전 페어 현재 leveraged notional 합 */
  getTotalOpenExposure() {
    let sum = 0;
    for (const v of this.openExposureUsdt.values()) sum += v;
    return sum;
  }

  /**
   * 기존(봇 시작 전부터 존재하던) 포지션을 등록 — 모니터링/노출 관리에 포함
   *
   * Phase B: 봇 재시작 시 SL/TP 가 Gate.io 에 실제로 존재하는지 확인하고,
   *          없으면 config 기본값(stopLossPercent/takeProfitPercent)으로 복원.
   *          실패해도 봇 구동은 계속되며 수동 개입이 필요함을 로그로 경고.
   */
  async registerExistingPosition(pair, position) {
    const prev = this.lastKnownPositions.get(pair);
    this.lastKnownPositions.set(pair, {
      size: position.size,
      entryPrice: position.entryPrice,
      unrealisedPnl: position.unrealisedPnl || 0,
      firstSeenAt: prev && prev.firstSeenAt ? prev.firstSeenAt : Date.now(),
    });

    try {
      const contractInfo = await gateClient.getContract(pair);
      const contractValue = Math.abs(contractInfo.quantoMultiplier) * (position.entryPrice || position.markPrice || 0);
      const notional = Math.abs(position.size) * contractValue; // leveraged notional
      if (notional > 0) this.openExposureUsdt.set(pair, notional);
    } catch (err) {
      logger.debug(`[${pair}] 기존 포지션 노출 계산 실패: ${err.message}`);
    }

    // Phase B: SL/TP 검증 & 필요 시 복원
    try {
      await this._verifyAndRestoreSLTP(pair, position);
    } catch (err) {
      logger.error(`[${pair}] SL/TP 검증/복원 중 예외 (무시, 봇 계속): ${err.message}`);
    }
  }

  /**
   * (Phase B) 기존 포지션의 SL/TP 상태 점검 & 필요 시 복원
   *
   * 흐름:
   *   1. Gate.io 에서 해당 페어의 open trigger 주문 조회
   *   2. 있으면 → 분류해서 내부 Map 에만 저장 (재등록 금지 — 사용자 설정 존중)
   *   3. 없으면 → config.stopLossPercent/takeProfitPercent 기반 폴백 SL/TP 등록
   */
  async _verifyAndRestoreSLTP(pair, position) {
    const size = Math.abs(position.size);
    const entry = position.entryPrice || position.markPrice || 0;
    const direction = position.size > 0 ? 'long' : 'short';

    if (size <= 0 || entry <= 0) {
      logger.warn(`[${pair}] 기존 포지션 entry/size 부족 — SL/TP 복원 스킵`);
      return;
    }

    const existing = await gateClient.listTriggerOrders(pair, 'open');

    if (existing.length > 0) {
      // 기존 트리거가 있으면 분류해서 저장만 함 (사용자가 수동 배치한 경우 존중)
      const classified = this._classifyTriggers(existing, direction, entry);
      if (classified.sl) {
        this.slOrderIds.set(pair, classified.sl.id);
        this.slPrices.set(pair, classified.sl.price);
      }
      if (classified.tp) {
        this.tpOrderIds.set(pair, classified.tp.id);
        this.tpPrices.set(pair, classified.tp.price);
      }
      const slTag = classified.sl ? classified.sl.price : 'NONE';
      const tpTag = classified.tp ? classified.tp.price : 'NONE';
      logger.info(
        `[${pair}] 기존 SL/TP 감지 & 로드: SL=${slTag} TP=${tpTag} (open trigger ${existing.length}건)`
      );
      return;
    }

    // 트리거 하나도 없음 → 폴백 SL/TP 계산 & 등록
    const slPct = Math.max(config.stopLossPercent, 0) / 100;
    const tpPct = Math.max(config.takeProfitPercent, 0) / 100;
    const slRaw = direction === 'long' ? entry * (1 - slPct) : entry * (1 + slPct);
    const tpRaw = direction === 'long' ? entry * (1 + tpPct) : entry * (1 - tpPct);

    // mark price 기준 검증 — 진입 후 변동으로 폴백가가 이탈했으면 조정
    const mark = position.markPrice || entry;
    const { sl, tp, adjusted } = this._adjustPricesToMark(direction, mark, slRaw, tpRaw);
    if (adjusted) {
      logger.warn(
        `[${pair}] 폴백 SL/TP 가 현재가 이탈 — mark 기준 재계산: mark=${mark} | SL ${slRaw.toFixed(6)}→${sl.toFixed(6)} TP ${tpRaw.toFixed(6)}→${tp.toFixed(6)}`
      );
    }

    logger.warn(
      `[${pair}] 기존 포지션에 SL/TP 없음 — 폴백 등록 시도: direction=${direction} entry=${entry} mark=${mark} SL=${sl.toFixed(6)} TP=${tp.toFixed(6)}`
    );

    try {
      const result = await gateClient.placeSLTP(pair, size, direction, sl, tp);
      this._storeSLTP(pair, result.slOrder, result.tpOrder, sl, tp);
      logger.info(`[${pair}] 폴백 SL/TP 등록 완료`);
    } catch (err) {
      logger.error(
        `[${pair}] 폴백 SL/TP 등록 실패 — 수동 설정 필요: ${err.message}`
      );
    }
  }

  // ===== 일일 손실 관리 =====

  _resetDailyPnlIfNeeded() {
    const today = new Date().toDateString();
    if (today !== this.dailyPnlResetDate) {
      logger.info(`일일 PnL 초기화: ${this.dailyPnl.toFixed(2)} USDT → 0`);
      this.dailyPnl = 0;
      this.dailyPnlResetDate = today;
      this._saveStats();
    }
  }

  isDailyLossLimitReached() {
    this._resetDailyPnlIfNeeded();
    if (this.dailyPnl <= -config.maxDailyLossUsdt) {
      logger.warn(`일일 최대 손실 한도 도달: ${this.dailyPnl.toFixed(2)} USDT`);
      return true;
    }
    return false;
  }

  // ===== 포지션 사이징 =====

  /**
   * 포지션 수량 계산
   *   marginBudget    = balance.total × f* × poiBoost
   *   leveragedNotional = marginBudget × leverage
   *   총 노출 상한(balance × maxTotalExposure) 초과 시 남은 한도로 축소
   *   한도 0이면 0 반환 → 진입 스킵
   *
   * @param contract 거래 페어
   * @param price    진입가
   * @param poiBoost HTF POI 기반 가중치 (1.0 = HTF POI 안, 0.5 = 밖)
   */
  async calculatePositionSize(contract, price, poiBoost = 1.0) {
    try {
      const contractInfo = await gateClient.getContract(contract);
      const multiplier = contractInfo.quantoMultiplier;
      const contractValue = Math.abs(multiplier) * price;

      const kellyFrac = this.calculateKellyFraction(contract);
      const balance = await gateClient.getBalance();

      const effectiveFrac = kellyFrac > 0 ? kellyFrac : config.kelly.defaultFraction;
      let marginBudget = balance.total * effectiveFrac * poiBoost;
      let leveragedNotional = marginBudget * config.leverage;

      // 총 노출 상한 캡
      const maxTotal = balance.total * config.kelly.maxTotalExposure;
      const current = this.getTotalOpenExposure();
      const available = Math.max(0, maxTotal - current);

      if (leveragedNotional > available) {
        logger.warn(
          `[${contract}] 총 노출 한도 초과 - 축소: 요청 ${leveragedNotional.toFixed(2)} → 한도 ${available.toFixed(2)} USDT (현재 ${current.toFixed(2)}/${maxTotal.toFixed(2)})`
        );
        leveragedNotional = available;
        marginBudget = leveragedNotional / config.leverage;
      }

      if (leveragedNotional <= 0) {
        logger.warn(`[${contract}] 총 노출 한도 도달 - 진입 스킵`);
        return { size: 0, leveragedNotional: 0, marginBudget: 0 };
      }

      const stats = this._getStats(contract);
      const boostTag = poiBoost < 1 ? ` | boost=${poiBoost}(HTF POI 밖)` : ' | boost=1.0(HTF POI 안)';
      logger.info(
        `[${contract}] [Kelly] f*=${(kellyFrac * 100).toFixed(2)}%${boostTag} | 표본=${stats.wins + stats.losses} (W:${stats.wins}/L:${stats.losses}) | 잔고=${balance.total.toFixed(2)} | margin=${marginBudget.toFixed(2)} | notional=${leveragedNotional.toFixed(2)} USDT`
      );

      const size = Math.floor(leveragedNotional / contractValue);
      return {
        size: Math.max(size, contractInfo.orderSizeMin || 1),
        leveragedNotional,
        marginBudget,
      };
    } catch (err) {
      logger.error(`[${contract}] 수량 계산 실패: ${err.message}`);
      return { size: 0, leveragedNotional: 0, marginBudget: 0 };
    }
  }

  // ===== 주문 실행 =====

  /**
   * 매매 신호에 따라 주문 실행 + SL/TP 지정가 등록
   * @param signal  { signal, entry, sl, tp, reason, confluence }
   * @param contract  거래 페어 (예: "BTC_USDT")
   */
  async executeSignal(signal, contract) {
    const { signal: direction, entry, sl, tp, reason, confluence } = signal;

    if (!contract) {
      logger.error('executeSignal: contract 인자 필요');
      return { executed: false, reason: 'contract 없음' };
    }

    // 일일 손실 한도 확인
    if (this.isDailyLossLimitReached()) {
      return { executed: false, reason: '일일 최대 손실 한도 도달' };
    }

    // 기존 포지션 확인 (해당 페어)
    const existingPosition = await gateClient.getPosition(contract);
    if (existingPosition && existingPosition.size !== 0) {
      logger.info(`[${contract}] 이미 포지션 보유 중: size=${existingPosition.size}`);
      return { executed: false, reason: '기존 포지션 보유 중' };
    }

    // 잔고 확인
    const balance = await gateClient.getBalance();
    if (!balance || balance.available <= 0 || balance.total <= 0) {
      logger.warn(`[${contract}] 잔고 부족: available=${balance?.available ?? 0} total=${balance?.total ?? 0}`);
      return { executed: false, reason: '잔고 부족' };
    }

    // 레버리지 설정
    await gateClient.setLeverage(contract, config.leverage);

    // HTF POI 가중치: POI 안이면 full, 밖이면 half (옵션 3-A)
    const poiBoost = signal.hasHtfPoi ? 1.0 : 0.5;

    // 수량 계산 (노출 한도 확인 + POI 가중치 포함)
    const sizeResult = await this.calculatePositionSize(contract, entry, poiBoost);
    const size = sizeResult.size;
    if (!size || size <= 0) {
      return { executed: false, reason: '노출 한도 또는 수량 0' };
    }

    const side = direction === 'long' ? 'buy' : 'sell';

    logger.info('='.repeat(60));
    logger.info(`[${contract}] [신호] ${reason}`);
    logger.info(`[${contract}] [컨플루언스] ${confluence.join(' | ')}`);
    logger.info(`[${contract}] [방향] ${direction.toUpperCase()} | [진입] ${entry} | [SL] ${sl} | [TP] ${tp}`);
    logger.info(`[${contract}] [수량] ${size} 계약 | [레버리지] x${config.leverage}`);
    logger.info('='.repeat(60));

    // 1. 시장가 진입 주문
    const order = await gateClient.createOrder(contract, size, side);

    // 2. 실제 체결된 포지션 조회 (최대 6회 재시도)
    await new Promise(r => setTimeout(r, 1000));
    let actualPosition = null;
    for (let i = 0; i < 6; i++) {
      actualPosition = await gateClient.getPosition(contract);
      if (actualPosition && actualPosition.size !== 0) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    let actualSize;
    let entryPriceActual;
    if (actualPosition && actualPosition.size !== 0) {
      actualSize = Math.abs(actualPosition.size);
      entryPriceActual = actualPosition.entryPrice || entry;
      const prev = this.lastKnownPositions.get(contract);
      this.lastKnownPositions.set(contract, {
        size: actualPosition.size,
        entryPrice: actualPosition.entryPrice,
        unrealisedPnl: actualPosition.unrealisedPnl,
        firstSeenAt: prev && prev.firstSeenAt ? prev.firstSeenAt : Date.now(),
      });
      logger.info(`[${contract}] [체결 확인] size=${actualPosition.size} entry=${actualPosition.entryPrice}`);
    } else {
      const orderSize = order && order.size !== undefined ? Math.abs(Number(order.size)) : size;
      const orderFillPrice = order && (order.fillPrice || order.fill_price);
      actualSize = orderSize || size;
      entryPriceActual = orderFillPrice ? parseFloat(orderFillPrice) : entry;
      const prev = this.lastKnownPositions.get(contract);
      this.lastKnownPositions.set(contract, {
        size: direction === 'long' ? actualSize : -actualSize,
        entryPrice: entryPriceActual,
        unrealisedPnl: 0,
        firstSeenAt: prev && prev.firstSeenAt ? prev.firstSeenAt : Date.now(),
      });
      logger.warn(
        `[${contract}] [체결 확인 폴백] getPosition 실패 → 주문 응답 사용 (size=${actualSize}, entry=${entryPriceActual})`
      );
    }

    // 노출 기록 (leveraged notional)
    this.openExposureUsdt.set(contract, sizeResult.leveragedNotional);

    // 3. SL/TP 지정가 주문 등록 (최대 3회 재시도)
    let sltpSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const sltpResult = await gateClient.placeSLTP(contract, actualSize, direction, sl, tp);
        // Phase B/C: ID 뿐 아니라 가격도 저장 — 재등록 시 필요
        this._storeSLTP(contract, sltpResult.slOrder, sltpResult.tpOrder, sl, tp);
        logger.info(`[${contract}] SL 주문 ID: ${this.slOrderIds.get(contract)} | TP 주문 ID: ${this.tpOrderIds.get(contract)}`);
        sltpSuccess = true;
        break;
      } catch (err) {
        logger.error(`[${contract}] SL/TP 등록 실패 (${attempt}/3): ${err.message}`);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    if (!sltpSuccess) {
      logger.error(`[${contract}] SL/TP 등록 3회 실패 - 수동으로 SL/TP 설정 필요!`);
      this.slOrderIds.set(contract, null);
      this.tpOrderIds.set(contract, null);
    }

    return {
      executed: true,
      order,
      direction,
      entry,
      sl,
      tp,
      size,
    };
  }

  // ===== 포지션 모니터링 =====

  /**
   * 페어별 포지션 모니터링
   *
   * Phase C: 포지션 유지 중일 때 5틱마다 Gate.io 에 실제 SL/TP 주문이
   *          존재하는지 확인하고, 사라졌으면 저장된 가격으로 재등록.
   */
  async monitorPosition(contract, sl, tp, direction) {
    const position = await gateClient.getPosition(contract);

    // 포지션 살아 있음 → 카운터 초기화
    if (position && position.size !== 0) {
      const currentPrice = position.markPrice;
      const prev = this.lastKnownPositions.get(contract);
      this.lastKnownPositions.set(contract, {
        size: position.size,
        entryPrice: position.entryPrice,
        unrealisedPnl: position.unrealisedPnl,
        firstSeenAt: prev && prev.firstSeenAt ? prev.firstSeenAt : Date.now(),
      });
      this.emptyReadCount.delete(contract);
      logger.debug(
        `[${contract}] [포지션] ${direction} | 현재: ${currentPrice} | PnL: ${position.unrealisedPnl.toFixed(2)} USDT | SL: ${sl} | TP: ${tp}`
      );

      // Phase C: 5틱마다 SL/TP 존재 검증 (1분 cron 기준 ≈ 5분 간격)
      const nextCount = (this.sltpCheckCounter.get(contract) || 0) + 1;
      this.sltpCheckCounter.set(contract, nextCount);
      if (nextCount % 5 === 0) {
        try {
          await this._verifySLTPExists(contract, position);
        } catch (err) {
          logger.error(`[${contract}] SL/TP 존재 검증 실패 (무시): ${err.message}`);
        }
      }

      return { action: 'holding', price: currentPrice, pnl: position.unrealisedPnl };
    }

    // 포지션 empty — 즉시 재조회 (2초 후) 후 카운트
    // Gate.io API가 소형 포지션(1계약)을 간헐적으로 누락하는 문제 대응
    await new Promise((r) => setTimeout(r, 2000));
    const retryPosition = await gateClient.getPosition(contract);

    if (retryPosition && retryPosition.size !== 0) {
      // 재조회 성공 → 일시적 API 장애였음, 정상 복귀
      const currentPrice = retryPosition.markPrice;
      const prev = this.lastKnownPositions.get(contract);
      this.lastKnownPositions.set(contract, {
        size: retryPosition.size,
        entryPrice: retryPosition.entryPrice,
        unrealisedPnl: retryPosition.unrealisedPnl,
        firstSeenAt: prev && prev.firstSeenAt ? prev.firstSeenAt : Date.now(),
      });
      this.emptyReadCount.delete(contract);
      logger.info(`[${contract}] 포지션 재조회 성공 (2초 후) — 일시적 API 누락`);
      return { action: 'holding', price: currentPrice, pnl: retryPosition.unrealisedPnl };
    }

    // 재조회도 empty → 카운터 증가
    const prevCount = this.emptyReadCount.get(contract) || 0;
    const count = prevCount + 1;
    this.emptyReadCount.set(contract, count);

    const EMPTY_THRESHOLD = 5;

    if (count < EMPTY_THRESHOLD) {
      if (this.lastKnownPositions.has(contract)) {
        logger.warn(
          `[${contract}] 포지션 조회 empty ${count}/${EMPTY_THRESHOLD} (재조회 포함) — SL/TP 유지`
        );
        return { action: 'holding_check', price: 0, pnl: 0 };
      }
      logger.warn(
        `[${contract}] 포지션 empty ${count}/${EMPTY_THRESHOLD} & 이전 기록 없음`
      );
      return { action: 'holding_check', price: 0, pnl: 0 };
    }

    // 5회 연속 empty (재조회 포함 = 10번 조회) → 진짜 청산됨
    this.emptyReadCount.delete(contract);

    if (!this.lastKnownPositions.has(contract)) {
      logger.warn(`[${contract}] 포지션 확인 불가 (${EMPTY_THRESHOLD}회 연속 empty) - 조건부 주문 정리`);
      try {
        await gateClient.cancelAllTriggerOrders(contract);
      } catch {}
      this._clearPairState(contract);
      return { action: 'failed', reason: '포지션 조회 실패' };
    }

    // 이전에 있었는데 5회 연속 없음 → SL/TP 체결 또는 수동 청산
    try {
      await gateClient.cancelAllTriggerOrders(contract);
    } catch {}

    // 실제 실현 PnL 을 청산 이력 API 에서 조회.
    //   과거엔 lastKnownPositions.unrealisedPnl (직전 폴링 당시 값) 의 부호로
    //   tp_hit/sl_hit 를 분류했지만, 반등 중 SL hit 등 경계 사례에서 오분류가
    //   발생해 Kelly 통계와 알림이 오염되었다. 이제는 listPositionClose 로 실제
    //   실현 PnL 을 집계하고, action 은 'closed' 로 통합한다.
    //
    //   시간 필터: 포지션 최초 감지 시각(firstSeenAt) 이후에 발생한 청산만 집계.
    //   EMPTY_THRESHOLD × cron 주기만큼 감지 지연이 생기므로 고정 60초 윈도우는
    //   실제 청산 trade 를 놓친다. firstSeenAt 이 없으면 10분 윈도우로 폴백.
    let pnl = 0;
    let unknown = false;
    const known = this.lastKnownPositions.get(contract);
    const sinceMs = (known && known.firstSeenAt) ? known.firstSeenAt : (Date.now() - 600_000);
    try {
      const closes = await gateClient.getRecentClosedPositions(contract, 20);
      let found = false;
      for (const p of closes) {
        // Gate.io time 은 초(epoch seconds). ms 로 변환.
        const tMs = typeof p.time === 'number' ? p.time * 1000 : NaN;
        if (!Number.isFinite(tMs) || tMs < sinceMs) continue;
        if (p.pnl != null && Number.isFinite(p.pnl)) {
          pnl += p.pnl;
          found = true;
        }
      }
      if (!found) {
        unknown = true;
        logger.warn(`[${contract}] 청산 이력에서 실현 PnL 미확인 — 'closed (unknown)' 처리 (sinceMs=${sinceMs})`);
      }
    } catch (err) {
      unknown = true;
      logger.error(`[${contract}] 청산 이력 조회 실패 — 'closed (unknown)' 처리: ${err.message}`);
    }

    const action = unknown ? 'closed (unknown)' : 'closed';
    const pnlTag = unknown ? 'N/A' : `${pnl.toFixed(2)} USDT`;
    logger.info(`[${contract}] [포지션 종료] ${action} (${EMPTY_THRESHOLD}회 empty) | PnL: ${pnlTag}`);

    if (!unknown) {
      this.dailyPnl += pnl;
      this.recordTradeResult(contract, pnl);
    }
    this.lastKnownPositions.delete(contract);
    this._clearPairState(contract);

    return { action, price: 0, pnl: unknown ? 0 : pnl };
  }

  /**
   * (Phase C) 포지션 유지 중 SL/TP 가 Gate.io 에 둘 다 존재하는지 검증.
   *
   * 정책 (강화판):
   *   1. 오픈 트리거를 SL/TP 로 분류
   *   2. 둘 다 존재 → IDs/가격 갱신만 수행 (사용자가 UI 에서 수동 설정했을 경우 자동 캡처)
   *   3. 한 쪽 또는 둘 다 누락 → 저장된 가격(slPrices/tpPrices) 또는 발견된 트리거
   *      가격을 조합해 재등록 가격 결정 → mark 기준 조정 → orphan 취소 후 원자적 재등록
   *   4. 재등록 가격을 얻을 수 없으면 경고만 (수동 개입 필요)
   *
   * 이전 "트리거 ≥ 1건이면 OK" 정책의 부분 누락 맹점을 제거.
   */
  async _verifySLTPExists(contract, position) {
    const direction = position.size > 0 ? 'long' : 'short';
    const known = this.lastKnownPositions.get(contract);
    const entry = (known && known.entryPrice) || position.entryPrice || 0;
    const mark = position.markPrice || entry;

    const triggers = await gateClient.listTriggerOrders(contract, 'open');
    const { sl: foundSl, tp: foundTp } = this._classifyTriggers(triggers, direction, entry);

    // 케이스 1: 둘 다 존재 → IDs/가격 갱신 후 종료
    if (foundSl && foundTp) {
      this.slOrderIds.set(contract, foundSl.id);
      this.slPrices.set(contract, foundSl.price);
      this.tpOrderIds.set(contract, foundTp.id);
      this.tpPrices.set(contract, foundTp.price);
      logger.debug(
        `[${contract}] SL/TP 검증 OK (SL=${foundSl.price} TP=${foundTp.price}, triggers=${triggers.length})`
      );
      return;
    }

    // 케이스 2/3: 부분 또는 전체 누락 → 재등록 가격 결정
    //   발견된 쪽은 그 가격을 유지 (UI 에서 수동으로 조정했을 수 있음)
    //   누락된 쪽은 저장된 가격 사용, 없으면 null
    const rawSl = foundSl ? foundSl.price : this.slPrices.get(contract);
    const rawTp = foundTp ? foundTp.price : this.tpPrices.get(contract);

    if (!Number.isFinite(rawSl) || !Number.isFinite(rawTp) || rawSl <= 0 || rawTp <= 0) {
      logger.warn(
        `[${contract}] SL/TP 누락 감지 & 재등록 가격 부족 — 수동 조치 필요 | found=SL:${!!foundSl}/TP:${!!foundTp} stored=SL:${this.slPrices.get(contract)}/TP:${this.tpPrices.get(contract)}`
      );
      return;
    }

    // mark 기준 검증 & 필요 시 조정
    const { sl, tp, adjusted } = this._adjustPricesToMark(direction, mark, rawSl, rawTp);
    if (adjusted) {
      logger.warn(
        `[${contract}] 재등록 SL/TP 가 mark 이탈 — 조정: mark=${mark} | SL ${rawSl}→${sl} TP ${rawTp}→${tp}`
      );
    }

    logger.warn(
      `[${contract}] SL/TP 부분 누락 감지 — 재등록 시도: foundSL=${!!foundSl} foundTP=${!!foundTp} → SL=${sl} TP=${tp} dir=${direction}`
    );

    // 기존 orphan 트리거 정리 (Phase D 안전 버전) → 원자적 재등록
    try {
      await gateClient.cancelAllTriggerOrders(contract);
    } catch (err) {
      logger.warn(`[${contract}] 재등록 전 orphan 정리 실패 (계속 진행): ${err.message}`);
    }

    try {
      const size = Math.abs(position.size);
      const result = await gateClient.placeSLTP(contract, size, direction, sl, tp);
      this._storeSLTP(contract, result.slOrder, result.tpOrder, sl, tp);
      logger.info(`[${contract}] SL/TP 재등록 완료`);
    } catch (err) {
      logger.error(`[${contract}] SL/TP 재등록 실패 — 수동 조치 필요: ${err.message}`);
    }
  }

  // ===== 수동 청산 =====

  async closeAndCleanup(contract) {
    try {
      await gateClient.cancelAllTriggerOrders(contract);
      logger.info(`[${contract}] SL/TP 조건부 주문 취소 완료`);
    } catch {}

    const result = await gateClient.closePosition(contract);

    this.lastKnownPositions.delete(contract);
    this.emptyReadCount.delete(contract);
    this._clearPairState(contract);

    return result;
  }
}

module.exports = OrderManager;
