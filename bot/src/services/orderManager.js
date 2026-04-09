const gateClient = require('../api/gateClient');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * 주문 실행 및 포지션 관리 서비스 (멀티 페어 지원)
 *
 * 페어별 독립 상태:
 *  - slOrderIds / tpOrderIds / lastKnownPositions : pair → value Map
 *  - tradeStatsByPair                            : pair → Kelly 통계
 *  - openExposureUsdt                            : pair → leveraged notional (USDT)
 *
 * 전역 상태:
 *  - dailyPnl (전 페어 합산 일일 손익, maxDailyLossUsdt 한도 적용)
 */
class OrderManager {
  constructor() {
    this.dailyPnl = 0;
    this.dailyPnlResetDate = new Date().toDateString();

    // 페어별 상태
    this.slOrderIds = new Map();
    this.tpOrderIds = new Map();
    this.lastKnownPositions = new Map();
    this.tradeStatsByPair = new Map();
    this.openExposureUsdt = new Map(); // leveraged notional per pair
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
   */
  async registerExistingPosition(pair, position) {
    this.lastKnownPositions.set(pair, {
      size: position.size,
      entryPrice: position.entryPrice,
      unrealisedPnl: position.unrealisedPnl || 0,
    });

    try {
      const contractInfo = await gateClient.getContract(pair);
      const contractValue = Math.abs(contractInfo.quantoMultiplier) * (position.entryPrice || position.markPrice || 0);
      const notional = Math.abs(position.size) * contractValue; // leveraged notional
      if (notional > 0) this.openExposureUsdt.set(pair, notional);
    } catch (err) {
      logger.debug(`[${pair}] 기존 포지션 노출 계산 실패: ${err.message}`);
    }
  }

  // ===== 일일 손실 관리 =====

  _resetDailyPnlIfNeeded() {
    const today = new Date().toDateString();
    if (today !== this.dailyPnlResetDate) {
      logger.info(`일일 PnL 초기화: ${this.dailyPnl.toFixed(2)} USDT → 0`);
      this.dailyPnl = 0;
      this.dailyPnlResetDate = today;
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
      this.lastKnownPositions.set(contract, {
        size: actualPosition.size,
        entryPrice: actualPosition.entryPrice,
        unrealisedPnl: actualPosition.unrealisedPnl,
      });
      logger.info(`[${contract}] [체결 확인] size=${actualPosition.size} entry=${actualPosition.entryPrice}`);
    } else {
      const orderSize = order && order.size !== undefined ? Math.abs(Number(order.size)) : size;
      const orderFillPrice = order && (order.fillPrice || order.fill_price);
      actualSize = orderSize || size;
      entryPriceActual = orderFillPrice ? parseFloat(orderFillPrice) : entry;
      this.lastKnownPositions.set(contract, {
        size: direction === 'long' ? actualSize : -actualSize,
        entryPrice: entryPriceActual,
        unrealisedPnl: 0,
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
        this.slOrderIds.set(contract, sltpResult.slOrder ? sltpResult.slOrder.id : null);
        this.tpOrderIds.set(contract, sltpResult.tpOrder ? sltpResult.tpOrder.id : null);
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
   */
  async monitorPosition(contract, sl, tp, direction) {
    const position = await gateClient.getPosition(contract);

    // 포지션 살아 있음
    if (position && position.size !== 0) {
      const currentPrice = position.markPrice;
      this.lastKnownPositions.set(contract, {
        size: position.size,
        entryPrice: position.entryPrice,
        unrealisedPnl: position.unrealisedPnl,
      });
      logger.debug(
        `[${contract}] [포지션] ${direction} | 현재: ${currentPrice} | PnL: ${position.unrealisedPnl.toFixed(2)} USDT | SL: ${sl} | TP: ${tp}`
      );
      return { action: 'holding', price: currentPrice, pnl: position.unrealisedPnl };
    }

    // 포지션 없음
    if (!this.lastKnownPositions.has(contract)) {
      logger.warn(`[${contract}] 포지션 확인 불가 - 조건부 주문 정리`);
      try {
        await gateClient.cancelAllTriggerOrders(contract);
      } catch {}
      this.slOrderIds.delete(contract);
      this.tpOrderIds.delete(contract);
      this.openExposureUsdt.delete(contract);
      return { action: 'failed', reason: '포지션 조회 실패' };
    }

    // 이전에 있었는데 지금 없음 → SL/TP 체결
    try {
      await gateClient.cancelAllTriggerOrders(contract);
    } catch {}

    const pnl = this.lastKnownPositions.get(contract).unrealisedPnl || 0;
    const action = pnl >= 0 ? 'tp_hit' : 'sl_hit';
    const label = action === 'tp_hit' ? 'TP 익절' : 'SL 손절';
    logger.info(`[${contract}] [${label}] 지정가 체결 | PnL: ${pnl.toFixed(2)} USDT`);

    this.dailyPnl += pnl;
    this.recordTradeResult(contract, pnl);
    this.slOrderIds.delete(contract);
    this.tpOrderIds.delete(contract);
    this.lastKnownPositions.delete(contract);
    this.openExposureUsdt.delete(contract);

    return { action, price: 0, pnl };
  }

  // ===== 수동 청산 =====

  async closeAndCleanup(contract) {
    try {
      await gateClient.cancelAllTriggerOrders(contract);
      logger.info(`[${contract}] SL/TP 조건부 주문 취소 완료`);
    } catch {}

    const result = await gateClient.closePosition(contract);

    this.slOrderIds.delete(contract);
    this.tpOrderIds.delete(contract);
    this.lastKnownPositions.delete(contract);
    this.openExposureUsdt.delete(contract);

    return result;
  }
}

module.exports = OrderManager;
