const gateClient = require('../api/gateClient');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * 주문 실행 및 포지션 관리 서비스
 *
 * SL/TP 처리 방식:
 *   진입 시 Gate.io 조건부 주문(Price Trigger)으로 SL/TP를 지정가 등록
 *   → 거래소가 가격 도달 시 자동으로 지정가 청산 실행
 *   → 봇이 꺼져 있어도 SL/TP는 거래소에서 동작
 */
class OrderManager {
  constructor() {
    this.dailyPnl = 0;
    this.dailyPnlResetDate = new Date().toDateString();
    this.slOrderId = null;
    this.tpOrderId = null;
    this.lastKnownPosition = null;

    // Kelly Criterion 학습용 통계 (인메모리)
    this.tradeStats = {
      wins: 0,
      losses: 0,
      totalWinUsdt: 0,
      totalLossUsdt: 0, // 양수로 누적
    };
  }

  /**
   * 청산된 거래 결과를 Kelly 통계에 반영
   */
  recordTradeResult(pnl) {
    if (pnl > 0) {
      this.tradeStats.wins += 1;
      this.tradeStats.totalWinUsdt += pnl;
    } else if (pnl < 0) {
      this.tradeStats.losses += 1;
      this.tradeStats.totalLossUsdt += Math.abs(pnl);
    }
  }

  /**
   * Kelly Criterion 기반 자본 대비 베팅 비율 계산
   *   f* = p - (1 - p) / R
   *   - p : 승률
   *   - R : 평균 승리 / 평균 패배
   *   - fractional Kelly 적용 후 상한 캡, 음수면 0
   *   - 표본이 minTrades 미만이면 defaultFraction 사용
   * @returns {number|null} 0 이상 maxFraction 이하의 비율 (Kelly 비활성화 시 null)
   */
  calculateKellyFraction() {
    const k = config.kelly;
    if (!k.enabled) return null;

    const { wins, losses, totalWinUsdt, totalLossUsdt } = this.tradeStats;
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

    const scaled = raw * k.fraction;
    return Math.min(scaled, k.maxFraction);
  }

  /**
   * 일일 손익 초기화 (날짜 변경 시)
   */
  _resetDailyPnlIfNeeded() {
    const today = new Date().toDateString();
    if (today !== this.dailyPnlResetDate) {
      logger.info(`일일 PnL 초기화: ${this.dailyPnl.toFixed(2)} USDT → 0`);
      this.dailyPnl = 0;
      this.dailyPnlResetDate = today;
    }
  }

  /**
   * 일일 최대 손실 한도 확인
   */
  isDailyLossLimitReached() {
    this._resetDailyPnlIfNeeded();
    if (this.dailyPnl <= -config.maxDailyLossUsdt) {
      logger.warn(`일일 최대 손실 한도 도달: ${this.dailyPnl.toFixed(2)} USDT`);
      return true;
    }
    return false;
  }

  /**
   * 포지션 수량 계산
   *
   * Kelly Criterion이 활성화되어 있으면 잔고 × kellyFraction 을 베팅 자본으로,
   * 아니면 config.positionSizeUsdt 를 베팅 자본으로 사용한다.
   */
  async calculatePositionSize(contract, price) {
    try {
      const contractInfo = await gateClient.getContract(contract);
      const multiplier = contractInfo.quantoMultiplier;
      const contractValue = Math.abs(multiplier) * price;

      let notional = config.positionSizeUsdt;
      const kellyFrac = this.calculateKellyFraction();
      if (kellyFrac !== null) {
        try {
          const balance = await gateClient.getBalance();
          if (kellyFrac <= 0) {
            logger.warn('Kelly 비율 0 - 최소 수량으로 폴백');
            notional = 0;
          } else {
            notional = balance.total * kellyFrac;
            const { wins, losses } = this.tradeStats;
            logger.info(
              `[Kelly] f*=${(kellyFrac * 100).toFixed(2)}% | 표본=${wins + losses} (W:${wins}/L:${losses}) | 베팅 자본=${notional.toFixed(2)} USDT`
            );
          }
        } catch (err) {
          logger.error(`Kelly용 잔고 조회 실패, 기본 사이즈 사용: ${err.message}`);
        }
      }

      const size = Math.floor((notional * config.leverage) / contractValue);
      return Math.max(size, contractInfo.orderSizeMin || 1);
    } catch (err) {
      logger.error(`수량 계산 실패: ${err.message}`);
      return 1;
    }
  }

  /**
   * 매매 신호에 따라 주문 실행 + SL/TP 지정가 등록
   */
  async executeSignal(signal) {
    const { signal: direction, entry, sl, tp, reason, confluence } = signal;
    const contract = config.tradePair;

    // 일일 손실 한도 확인
    if (this.isDailyLossLimitReached()) {
      return { executed: false, reason: '일일 최대 손실 한도 도달' };
    }

    // 기존 포지션 확인
    const existingPosition = await gateClient.getPosition(contract);
    if (existingPosition && existingPosition.size !== 0) {
      logger.info(`이미 포지션 보유 중: size=${existingPosition.size}`);
      return { executed: false, reason: '기존 포지션 보유 중' };
    }

    // 잔고 확인
    const balance = await gateClient.getBalance();
    if (balance.available < config.positionSizeUsdt) {
      logger.warn(`잔고 부족: ${balance.available.toFixed(2)} USDT`);
      return { executed: false, reason: '잔고 부족' };
    }

    // 레버리지 설정
    await gateClient.setLeverage(contract, config.leverage);

    // 수량 계산
    const size = await this.calculatePositionSize(contract, entry);
    const side = direction === 'long' ? 'buy' : 'sell';

    logger.info('='.repeat(60));
    logger.info(`[신호] ${reason}`);
    logger.info(`[컨플루언스] ${confluence.join(' | ')}`);
    logger.info(`[방향] ${direction.toUpperCase()} | [진입] ${entry} | [SL] ${sl} | [TP] ${tp}`);
    logger.info(`[수량] ${size} 계약 | [레버리지] x${config.leverage}`);
    logger.info(`[SL/TP] 지정가 주문으로 거래소에 등록`);
    logger.info('='.repeat(60));

    // 1. 시장가 진입 주문
    const order = await gateClient.createOrder(contract, size, side);

    // 2. 실제 체결된 포지션 조회 (체결 반영 대기)
    await new Promise(r => setTimeout(r, 1000));
    let actualPosition = null;
    for (let i = 0; i < 3; i++) {
      actualPosition = await gateClient.getPosition(contract);
      if (actualPosition && actualPosition.size !== 0) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!actualPosition || actualPosition.size === 0) {
      logger.error('진입 주문 체결 확인 실패');
      return { executed: false, reason: '진입 체결 확인 실패' };
    }

    const actualSize = Math.abs(actualPosition.size);
    this.lastKnownPosition = {
      size: actualPosition.size,
      entryPrice: actualPosition.entryPrice,
      unrealisedPnl: actualPosition.unrealisedPnl,
    };
    logger.info(`[체결 확인] size=${actualPosition.size} entry=${actualPosition.entryPrice}`);

    // 3. SL/TP 지정가 주문을 거래소에 등록 (최대 3회 재시도)
    let sltpSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const sltpResult = await gateClient.placeSLTP(contract, actualSize, direction, sl, tp);
        this.slOrderId = sltpResult.slOrder ? sltpResult.slOrder.id : null;
        this.tpOrderId = sltpResult.tpOrder ? sltpResult.tpOrder.id : null;
        logger.info(`SL 주문 ID: ${this.slOrderId} | TP 주문 ID: ${this.tpOrderId}`);
        sltpSuccess = true;
        break;
      } catch (err) {
        logger.error(`SL/TP 등록 실패 (${attempt}/3): ${err.message}`);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    if (!sltpSuccess) {
      logger.error('SL/TP 등록 3회 실패 - 수동으로 SL/TP 설정 필요!');
      this.slOrderId = null;
      this.tpOrderId = null;
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

  /**
   * 포지션 모니터링
   *
   * SL/TP는 거래소 조건부 주문으로 등록되어 있으므로
   * 여기서는 포지션 상태와 체결 여부만 확인한다.
   *
   * 체결 판단 규칙:
   *  - 이전에 포지션 있었다가 지금 없음 → SL/TP 체결
   *  - 처음부터 포지션 없음 → 진입 실패 또는 조회 오류
   */
  async monitorPosition(contract, sl, tp, direction) {
    const position = await gateClient.getPosition(contract);

    // 포지션이 살아 있음
    if (position && position.size !== 0) {
      const currentPrice = position.markPrice;
      this.lastKnownPosition = {
        size: position.size,
        entryPrice: position.entryPrice,
        unrealisedPnl: position.unrealisedPnl,
      };
      logger.debug(
        `[포지션] ${direction} | 현재: ${currentPrice} | PnL: ${position.unrealisedPnl.toFixed(2)} USDT | SL: ${sl} | TP: ${tp}`
      );
      return { action: 'holding', price: currentPrice, pnl: position.unrealisedPnl };
    }

    // 포지션이 없음: 이전에 있었던 경우에만 청산으로 판단
    if (!this.lastKnownPosition) {
      // 한번도 포지션을 확인한 적 없음 → 진입 실패 또는 미체결
      logger.warn(`[포지션 확인 불가] 진입 후 포지션 조회 실패 - 조건부 주문 정리`);
      try {
        await gateClient.cancelAllTriggerOrders(contract);
      } catch {
        // 무시
      }
      this.slOrderId = null;
      this.tpOrderId = null;
      return { action: 'failed', reason: '포지션 조회 실패' };
    }

    // 이전에는 있었는데 지금 없음 → SL/TP 체결
    try {
      await gateClient.cancelAllTriggerOrders(contract);
    } catch {
      // 이미 없을 수 있음
    }

    const pnl = this.lastKnownPosition.unrealisedPnl || 0;
    const action = pnl >= 0 ? 'tp_hit' : 'sl_hit';
    const label = action === 'tp_hit' ? 'TP 익절' : 'SL 손절';
    logger.info(`[${label}] 지정가 체결 | PnL: ${pnl.toFixed(2)} USDT`);

    this.dailyPnl += pnl;
    this.recordTradeResult(pnl);
    this.slOrderId = null;
    this.tpOrderId = null;
    this.lastKnownPosition = null;

    return { action, price: 0, pnl };
  }

  /**
   * 포지션 수동 청산 시 조건부 주문도 함께 취소
   */
  async closeAndCleanup(contract) {
    // 조건부 주문 (SL/TP) 취소
    try {
      await gateClient.cancelAllTriggerOrders(contract);
      logger.info('SL/TP 조건부 주문 취소 완료');
    } catch {
      // 이미 없을 수 있음
    }

    // 포지션 청산
    const result = await gateClient.closePosition(contract);

    this.slOrderId = null;
    this.tpOrderId = null;

    return result;
  }
}

module.exports = OrderManager;
