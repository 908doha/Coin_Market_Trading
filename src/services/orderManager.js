const gateClient = require('../api/gateClient');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * 주문 실행 및 포지션 관리 서비스
 */
class OrderManager {
  constructor() {
    this.dailyPnl = 0;
    this.dailyPnlResetDate = new Date().toDateString();
    this.activeOrders = [];
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
      // 1 계약 = multiplier * price USDT
      const contractValue = Math.abs(multiplier) * price;
      const size = Math.floor((config.positionSizeUsdt * config.leverage) / contractValue);
      return Math.max(size, contractInfo.orderSizeMin || 1);
    } catch (err) {
      logger.error(`수량 계산 실패: ${err.message}`);
      // 기본 수량 반환
      return 1;
    }
  }

  /**
   * 매매 신호에 따라 주문 실행
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
    logger.info('='.repeat(60));

    // 시장가 주문 실행
    const order = await gateClient.createOrder(contract, size, side);

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
   * 포지션 모니터링 - SL/TP 도달 시 청산
   */
  async monitorPosition(contract, sl, tp, direction) {
    const position = await gateClient.getPosition(contract);
    if (!position || position.size === 0) return { action: 'none', reason: '포지션 없음' };

    const currentPrice = position.markPrice;

    if (direction === 'long') {
      if (currentPrice <= sl) {
        logger.warn(`[SL 도달] Long 청산 @ ${currentPrice} (SL: ${sl})`);
        const closeOrder = await gateClient.closePosition(contract);
        this.dailyPnl += position.unrealisedPnl;
        return { action: 'sl_hit', price: currentPrice, pnl: position.unrealisedPnl, closeOrder };
      }
      if (currentPrice >= tp) {
        logger.info(`[TP 도달] Long 익절 @ ${currentPrice} (TP: ${tp})`);
        const closeOrder = await gateClient.closePosition(contract);
        this.dailyPnl += position.unrealisedPnl;
        return { action: 'tp_hit', price: currentPrice, pnl: position.unrealisedPnl, closeOrder };
      }
    }

    if (direction === 'short') {
      if (currentPrice >= sl) {
        logger.warn(`[SL 도달] Short 청산 @ ${currentPrice} (SL: ${sl})`);
        const closeOrder = await gateClient.closePosition(contract);
        this.dailyPnl += position.unrealisedPnl;
        return { action: 'sl_hit', price: currentPrice, pnl: position.unrealisedPnl, closeOrder };
      }
      if (currentPrice <= tp) {
        logger.info(`[TP 도달] Short 익절 @ ${currentPrice} (TP: ${tp})`);
        const closeOrder = await gateClient.closePosition(contract);
        this.dailyPnl += position.unrealisedPnl;
        return { action: 'tp_hit', price: currentPrice, pnl: position.unrealisedPnl, closeOrder };
      }
    }

    logger.debug(
      `[포지션] ${direction} | 현재: ${currentPrice} | PnL: ${position.unrealisedPnl.toFixed(2)} USDT | SL: ${sl} | TP: ${tp}`
    );
    return { action: 'holding', price: currentPrice, pnl: position.unrealisedPnl };
  }
}

module.exports = OrderManager;
