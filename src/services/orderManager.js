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
   * 포지션 수량 계산 (USDT 기준)
   */
  async calculatePositionSize(contract, price) {
    try {
      const contractInfo = await gateClient.getContract(contract);
      const multiplier = contractInfo.quantoMultiplier;
      const contractValue = Math.abs(multiplier) * price;
      const size = Math.floor((config.positionSizeUsdt * config.leverage) / contractValue);
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

    // 2. SL/TP 지정가 주문을 거래소에 등록
    try {
      const sltpResult = await gateClient.placeSLTP(contract, size, direction, sl, tp);
      this.slOrderId = sltpResult.slOrder ? sltpResult.slOrder.id : null;
      this.tpOrderId = sltpResult.tpOrder ? sltpResult.tpOrder.id : null;
      logger.info(`SL 주문 ID: ${this.slOrderId} | TP 주문 ID: ${this.tpOrderId}`);
    } catch (err) {
      logger.error(`SL/TP 등록 실패: ${err.message} - 수동 모니터링으로 전환`);
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
   */
  async monitorPosition(contract, sl, tp, direction) {
    const position = await gateClient.getPosition(contract);

    // 포지션이 없으면 SL 또는 TP가 체결된 것
    if (!position || position.size === 0) {
      // 남은 조건부 주문 정리 (SL 체결 시 TP 취소, TP 체결 시 SL 취소)
      try {
        await gateClient.cancelAllTriggerOrders(contract);
      } catch {
        // 이미 없을 수 있음
      }

      // 어떤 주문이 체결됐는지 확인
      const closedPnl = await this._getLastClosedPnl(contract);

      if (closedPnl !== null) {
        this.dailyPnl += closedPnl;
        const action = closedPnl >= 0 ? 'tp_hit' : 'sl_hit';
        const label = action === 'tp_hit' ? 'TP 익절' : 'SL 손절';
        logger.info(`[${label}] 지정가 체결 | PnL: ${closedPnl.toFixed(2)} USDT`);

        this.slOrderId = null;
        this.tpOrderId = null;

        return { action, price: 0, pnl: closedPnl };
      }

      this.slOrderId = null;
      this.tpOrderId = null;
      return { action: 'none', reason: '포지션 없음' };
    }

    // 포지션 유지 중
    const currentPrice = position.markPrice;
    logger.debug(
      `[포지션] ${direction} | 현재: ${currentPrice} | PnL: ${position.unrealisedPnl.toFixed(2)} USDT | SL: ${sl} | TP: ${tp} (지정가 대기 중)`
    );
    return { action: 'holding', price: currentPrice, pnl: position.unrealisedPnl };
  }

  /**
   * 최근 청산된 포지션의 실현 PnL 조회
   */
  async _getLastClosedPnl(contract) {
    try {
      const position = await gateClient.getPosition(contract);
      if (position && position.size === 0) {
        // 포지션이 닫힌 상태에서의 정보 활용
        return position.unrealisedPnl || 0;
      }
    } catch {
      // 무시
    }
    return 0;
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
