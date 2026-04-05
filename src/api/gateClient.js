const GateApi = require('gate-api');
const config  = require('../config');
const logger  = require('../utils/logger');

const client = new GateApi.ApiClient();
client.setApiKeySecret(config.apiKey, config.apiSecret);

const futuresApi = new GateApi.FuturesApi(client);
const spotApi    = new GateApi.SpotApi(client);
const SETTLE = 'usdt';

const gateClient = {
  // 외부에서 futuresApi 직접 접근용 (positions 라우트)
  _futuresApi: futuresApi,

  async getCandles(contract, interval, limit = 200) {
    try {
      const { body } = await futuresApi.listFuturesCandlesticks(SETTLE, contract, { interval, limit });
      return body.map((c) => ({
        timestamp: c.t * 1000,
        open:  parseFloat(c.o),
        high:  parseFloat(c.h),
        low:   parseFloat(c.l),
        close: parseFloat(c.c),
        volume: parseFloat(c.v),
      }));
    } catch (err) { logger.error(`캔들 조회 실패: ${err.message}`); throw err; }
  },

  async getTicker(contract) {
    try {
      const { body } = await futuresApi.listFuturesTickers(SETTLE, { contract });
      const t = body[0];
      return {
        last:       parseFloat(t.last),
        markPrice:  parseFloat(t.markPrice),
        indexPrice: parseFloat(t.indexPrice),
        volume24h:  parseFloat(t.volume24h),
      };
    } catch (err) { logger.error(`티커 조회 실패: ${err.message}`); throw err; }
  },

  async getContract(contract) {
    try {
      const { body } = await futuresApi.getFuturesContract(SETTLE, contract);
      return {
        name:             body.name,
        quantoMultiplier: parseFloat(body.quantoMultiplier),
        leverageMin:      body.leverageMin,
        leverageMax:      body.leverageMax,
        markPrice:        parseFloat(body.markPrice),
        orderSizeMin:     body.orderSizeMin,
      };
    } catch (err) { logger.error(`계약 정보 조회 실패: ${err.message}`); throw err; }
  },

  async setLeverage(contract, leverage) {
    try {
      await futuresApi.updateDualModePositionLeverage(SETTLE, contract, leverage, {
        crossLeverageLimit: leverage.toString(),
      });
      logger.info(`레버리지 설정: ${contract} x${leverage}`);
    } catch (err) { logger.error(`레버리지 설정 실패: ${err.message}`); throw err; }
  },

  async createOrder(contract, size, side) {
    try {
      const order = new GateApi.FuturesOrder();
      order.contract = contract;
      order.size  = side === 'buy' ? Math.abs(size) : -Math.abs(size);
      order.price = '0';
      order.tif   = 'ioc';
      const { body } = await futuresApi.createFuturesOrder(SETTLE, order);
      logger.info(`주문 체결: ${side} ${contract} size=${size} id=${body.id}`);
      return body;
    } catch (err) { logger.error(`주문 실패: ${err.message}`); throw err; }
  },

  async createLimitOrder(contract, size, side, price) {
    try {
      const order = new GateApi.FuturesOrder();
      order.contract = contract;
      order.size  = side === 'buy' ? Math.abs(size) : -Math.abs(size);
      order.price = price.toString();
      order.tif   = 'gtc';
      const { body } = await futuresApi.createFuturesOrder(SETTLE, order);
      logger.info(`지정가 주문: ${side} ${contract} @ ${price} size=${size} id=${body.id}`);
      return body;
    } catch (err) { logger.error(`지정가 주문 실패: ${err.message}`); throw err; }
  },

  async getPosition(contract) {
    try {
      const { body } = await futuresApi.getPosition(SETTLE, contract);
      return {
        size:          body.size,
        entryPrice:    parseFloat(body.entryPrice),
        markPrice:     parseFloat(body.markPrice),
        unrealisedPnl: parseFloat(body.unrealisedPnl),
        leverage:      body.leverage,
        mode:          body.mode,
      };
    } catch (err) {
      if (err.body && err.body.label === 'POSITION_NOT_FOUND') return null;
      logger.error(`포지션 조회 실패: ${err.message}`); throw err;
    }
  },

  async closePosition(contract) {
    try {
      const position = await this.getPosition(contract);
      if (!position || position.size === 0) { logger.info(`청산할 포지션 없음: ${contract}`); return null; }
      const closeSide = position.size > 0 ? 'sell' : 'buy';
      return await this.createOrder(contract, Math.abs(position.size), closeSide);
    } catch (err) { logger.error(`포지션 청산 실패: ${err.message}`); throw err; }
  },

  // Spot + Futures 합산 잔고
  async getBalance() {
    try {
      const [futuresRes, spotRes] = await Promise.allSettled([
        futuresApi.listFuturesAccounts(SETTLE),
        spotApi.listSpotAccounts({ currency: 'USDT' }),
      ]);

      let futuresTotal = 0, futuresAvailable = 0, unrealisedPnl = 0;
      if (futuresRes.status === 'fulfilled') {
        const b = futuresRes.value.body;
        futuresTotal     = parseFloat(b.total)         || 0;
        futuresAvailable = parseFloat(b.available)     || 0;
        unrealisedPnl    = parseFloat(b.unrealisedPnl) || 0;
        logger.info(`Futures 잔고: total=${futuresTotal} available=${futuresAvailable}`);
      } else { logger.warn(`Futures 잔고 조회 실패: ${futuresRes.reason?.message}`); }

      let spotTotal = 0, spotAvailable = 0;
      if (spotRes.status === 'fulfilled') {
        const accounts = spotRes.value.body;
        const usdt = Array.isArray(accounts) ? accounts.find((a) => a.currency === 'USDT') : null;
        if (usdt) {
          spotAvailable = parseFloat(usdt.available) || 0;
          spotTotal     = spotAvailable + (parseFloat(usdt.locked) || 0);
          logger.info(`Spot 잔고: available=${spotAvailable} total=${spotTotal}`);
        }
      } else { logger.warn(`Spot 잔고 조회 실패: ${spotRes.reason?.message}`); }

      const total     = futuresTotal + spotTotal;
      const available = futuresAvailable + spotAvailable;
      logger.info(`총 잔고: ${total} USDT (Spot ${spotTotal} + Futures ${futuresTotal})`);
      return { total, available, unrealisedPnl, futuresTotal, spotTotal };
    } catch (err) { logger.error(`잔고 조회 실패: ${err.message}`); throw err; }
  },

  async cancelAllOrders(contract) {
    try {
      await futuresApi.cancelFuturesOrders(SETTLE, contract, { side: 'ask' });
      await futuresApi.cancelFuturesOrders(SETTLE, contract, { side: 'bid' });
      logger.info(`미체결 주문 전체 취소: ${contract}`);
    } catch (err) { logger.error(`주문 취소 실패: ${err.message}`); throw err; }
  },

  async createPriceTriggerOrder(contract, size, triggerPrice, orderPrice, triggerRule) {
    try {
      const triggerOrder = {
        initial: { contract, size, price: orderPrice.toString(), tif: 'gtc' },
        trigger: { strategy_type: 0, price_type: 1, price: triggerPrice.toString(), rule: triggerRule },
        orderType: size > 0 ? 'close-short-order' : 'close-long-order',
      };
      const { body } = await futuresApi.createPriceTriggeredOrder(SETTLE, triggerOrder);
      logger.info(`조건부 주문 등록: ${contract} trigger=${triggerPrice} id=${body.id}`);
      return body;
    } catch (err) { logger.error(`조건부 주문 실패: ${err.message}`); throw err; }
  },

  async placeSLTP(contract, size, direction, sl, tp) {
    const results = { slOrder: null, tpOrder: null };
    if (direction === 'long') {
      results.slOrder = await this.createPriceTriggerOrder(contract, -Math.abs(size), sl, sl, '2');
      results.tpOrder = await this.createPriceTriggerOrder(contract, -Math.abs(size), tp, tp, '1');
    } else {
      results.slOrder = await this.createPriceTriggerOrder(contract,  Math.abs(size), sl, sl, '1');
      results.tpOrder = await this.createPriceTriggerOrder(contract,  Math.abs(size), tp, tp, '2');
    }
    logger.info(`SL/TP 등록 완료: SL=${sl} TP=${tp}`);
    return results;
  },

  async cancelAllTriggerOrders(contract) {
    try {
      await futuresApi.cancelPriceTriggeredOrderList(SETTLE, contract);
      logger.info(`조건부 주문 전체 취소: ${contract}`);
    } catch (err) { logger.error(`조건부 주문 취소 실패: ${err.message}`); throw err; }
  },

  async listTriggerOrders(contract, status = 'open') {
    try {
      const { body } = await futuresApi.listPriceTriggeredOrders(SETTLE, status, { contract });
      return body;
    } catch (err) { logger.error(`조건부 주문 조회 실패: ${err.message}`); throw err; }
  },
};

module.exports = gateClient;
