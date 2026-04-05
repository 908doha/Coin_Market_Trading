const GateApi = require('gate-api');
const config = require('../config');
const logger = require('../utils/logger');

const client = new GateApi.ApiClient();
client.setApiKeySecret(config.apiKey, config.apiSecret);

const futuresApi = new GateApi.FuturesApi(client);
const SETTLE = 'usdt'; // USDT 마진 선물

/**
 * Gate.io 선물 API 클라이언트
 */
const gateClient = {
  /**
   * 캔들(K선) 데이터 조회
   */
  async getCandles(contract, interval, limit = 200) {
    try {
      const opts = { interval, limit };
      const { body } = await futuresApi.listFuturesCandlesticks(SETTLE, contract, opts);
      return body.map((c) => ({
        timestamp: c.t * 1000,
        open: parseFloat(c.o),
        high: parseFloat(c.h),
        low: parseFloat(c.l),
        close: parseFloat(c.c),
        volume: parseFloat(c.v),
      }));
    } catch (err) {
      logger.error(`캔들 조회 실패: ${err.message}`);
      throw err;
    }
  },

  /**
   * 현재가 조회
   */
  async getTicker(contract) {
    try {
      const { body } = await futuresApi.listFuturesTickers(SETTLE, { contract });
      const ticker = body[0];
      return {
        last: parseFloat(ticker.last),
        markPrice: parseFloat(ticker.markPrice),
        indexPrice: parseFloat(ticker.indexPrice),
        volume24h: parseFloat(ticker.volume24h),
      };
    } catch (err) {
      logger.error(`티커 조회 실패: ${err.message}`);
      throw err;
    }
  },

  /**
   * 선물 계약 정보 조회
   */
  async getContract(contract) {
    try {
      const { body } = await futuresApi.getFuturesContract(SETTLE, contract);
      return {
        name: body.name,
        quantoMultiplier: parseFloat(body.quantoMultiplier),
        leverageMin: body.leverageMin,
        leverageMax: body.leverageMax,
        markPrice: parseFloat(body.markPrice),
        orderSizeMin: body.orderSizeMin,
      };
    } catch (err) {
      logger.error(`계약 정보 조회 실패: ${err.message}`);
      throw err;
    }
  },

  /**
   * 레버리지 설정
   * 여러 방식으로 시도하여 호환성 확보
   */
  async setLeverage(contract, leverage) {
    const levStr = leverage.toString();

    // 방법 1: 싱글 모드 (leverage를 문자열로)
    try {
      await futuresApi.updatePositionLeverage(SETTLE, contract, levStr);
      logger.info(`레버리지 설정 완료: ${contract} x${leverage}`);
      return;
    } catch (err) {
      logger.debug(`싱글 모드 레버리지 실패: ${err.message}`);
    }

    // 방법 2: 듀얼 모드
    try {
      await futuresApi.updateDualModePositionLeverage(SETTLE, contract, levStr);
      logger.info(`레버리지 설정 완료 (듀얼): ${contract} x${leverage}`);
      return;
    } catch (err) {
      logger.debug(`듀얼 모드 레버리지 실패: ${err.message}`);
    }

    // 방법 3: 크로스 레버리지
    try {
      await futuresApi.updatePositionLeverage(SETTLE, contract, '0', {
        crossLeverageLimit: levStr,
      });
      logger.info(`레버리지 설정 완료 (크로스): ${contract} x${leverage}`);
      return;
    } catch (err) {
      logger.debug(`크로스 레버리지 실패: ${err.message}`);
    }

    // 모든 방법 실패 시 경고만 (주문은 계속 진행)
    logger.warn(`레버리지 설정 실패 - 거래소 기본 레버리지로 진행: ${contract}`);
  },

  /**
   * 선물 주문 (시장가)
   */
  async createOrder(contract, size, side) {
    try {
      const order = new GateApi.FuturesOrder();
      order.contract = contract;
      order.size = side === 'buy' ? Math.abs(size) : -Math.abs(size);
      order.price = '0'; // 시장가
      order.tif = 'ioc'; // Immediate or Cancel

      const { body } = await futuresApi.createFuturesOrder(SETTLE, order);
      logger.info(`주문 체결: ${side} ${contract} size=${size} id=${body.id}`);
      return body;
    } catch (err) {
      logger.error(`주문 실패: ${err.message}`);
      throw err;
    }
  },

  /**
   * 지정가 주문
   */
  async createLimitOrder(contract, size, side, price) {
    try {
      const order = new GateApi.FuturesOrder();
      order.contract = contract;
      order.size = side === 'buy' ? Math.abs(size) : -Math.abs(size);
      order.price = price.toString();
      order.tif = 'gtc'; // Good Till Cancel

      const { body } = await futuresApi.createFuturesOrder(SETTLE, order);
      logger.info(`지정가 주문: ${side} ${contract} @ ${price} size=${size} id=${body.id}`);
      return body;
    } catch (err) {
      logger.error(`지정가 주문 실패: ${err.message}`);
      throw err;
    }
  },

  /**
   * 현재 포지션 조회
   * 싱글 모드와 듀얼 모드 모두 대응
   */
  async getPosition(contract) {
    // 싱글 모드 시도
    try {
      const { body } = await futuresApi.getPosition(SETTLE, contract);
      return {
        size: body.size,
        entryPrice: parseFloat(body.entryPrice || '0'),
        markPrice: parseFloat(body.markPrice || '0'),
        unrealisedPnl: parseFloat(body.unrealisedPnl || '0'),
        leverage: body.leverage,
        mode: body.mode || 'single',
      };
    } catch (err) {
      // 포지션 없음
      if (err.body && (err.body.label === 'POSITION_NOT_FOUND' || err.body.label === 'POSITION_EMPTY')) {
        return null;
      }
    }

    // 듀얼 모드 시도
    try {
      const { body } = await futuresApi.getDualModePosition(SETTLE, contract);
      // 듀얼 모드는 long/short 포지션 배열을 반환
      if (Array.isArray(body)) {
        for (const pos of body) {
          if (pos.size && pos.size !== 0) {
            return {
              size: pos.size,
              entryPrice: parseFloat(pos.entryPrice || '0'),
              markPrice: parseFloat(pos.markPrice || '0'),
              unrealisedPnl: parseFloat(pos.unrealisedPnl || '0'),
              leverage: pos.leverage,
              mode: pos.mode || 'dual',
            };
          }
        }
      }
      return null;
    } catch (err) {
      if (err.body && (err.body.label === 'POSITION_NOT_FOUND' || err.body.label === 'POSITION_EMPTY')) {
        return null;
      }
      // 둘 다 실패하면 포지션 없음으로 처리
      logger.debug(`포지션 없음 (${err.message})`);
      return null;
    }
  },

  /**
   * 포지션 청산 (전량)
   */
  async closePosition(contract) {
    try {
      const position = await this.getPosition(contract);
      if (!position || position.size === 0) {
        logger.info(`청산할 포지션 없음: ${contract}`);
        return null;
      }
      // 반대 방향으로 같은 수량 시장가 주문
      const closeSide = position.size > 0 ? 'sell' : 'buy';
      return await this.createOrder(contract, Math.abs(position.size), closeSide);
    } catch (err) {
      logger.error(`포지션 청산 실패: ${err.message}`);
      throw err;
    }
  },

  /**
   * 잔고 조회
   */
  async getBalance() {
    try {
      const { body } = await futuresApi.listFuturesAccounts(SETTLE);
      return {
        total: parseFloat(body.total),
        available: parseFloat(body.available),
        unrealisedPnl: parseFloat(body.unrealisedPnl),
      };
    } catch (err) {
      logger.error(`잔고 조회 실패: ${err.message}`);
      throw err;
    }
  },

  /**
   * 미체결 주문 전체 취소
   */
  async cancelAllOrders(contract) {
    try {
      await futuresApi.cancelFuturesOrders(SETTLE, contract, { side: 'ask' });
      await futuresApi.cancelFuturesOrders(SETTLE, contract, { side: 'bid' });
      logger.info(`미체결 주문 전체 취소: ${contract}`);
    } catch (err) {
      logger.error(`주문 취소 실패: ${err.message}`);
      throw err;
    }
  },

  /**
   * 조건부 주문 생성 (Price Trigger Order)
   * SL/TP를 거래소에 지정가로 등록
   *
   * @param {string} contract - 거래쌍
   * @param {number} size - 수량 (양수: buy, 음수: sell)
   * @param {number} triggerPrice - 트리거 가격 (이 가격 도달 시 주문 발동)
   * @param {number} orderPrice - 실제 체결될 지정가 (0이면 시장가)
   * @param {string} triggerRule - 트리거 조건: '1' = >=, '2' = <=
   */
  async createPriceTriggerOrder(contract, size, triggerPrice, orderPrice, triggerRule) {
    try {
      const triggerOrder = {
        initial: {
          contract,
          size,
          price: orderPrice.toString(),
          tif: 'gtc',
        },
        trigger: {
          strategy_type: 0, // 0: price trigger
          price_type: 1,    // 1: mark price
          price: triggerPrice.toString(),
          rule: triggerRule, // 1: >=, 2: <=
        },
        orderType: 'close-long-order',
      };

      // 방향에 따라 orderType 설정
      if (size > 0) {
        triggerOrder.orderType = 'close-short-order'; // 숏 청산 (매수)
      } else {
        triggerOrder.orderType = 'close-long-order';  // 롱 청산 (매도)
      }

      const { body } = await futuresApi.createPriceTriggeredOrder(SETTLE, triggerOrder);
      logger.info(`조건부 주문 등록: ${contract} trigger=${triggerPrice} order=${orderPrice} id=${body.id}`);
      return body;
    } catch (err) {
      logger.error(`조건부 주문 실패: ${err.message}`);
      throw err;
    }
  },

  /**
   * SL/TP 지정가 주문 세트 등록
   *
   * @param {string} contract - 거래쌍
   * @param {number} size - 포지션 수량 (양수)
   * @param {string} direction - 'long' 또는 'short'
   * @param {number} sl - 손절 가격
   * @param {number} tp - 익절 가격
   */
  async placeSLTP(contract, size, direction, sl, tp) {
    const results = { slOrder: null, tpOrder: null };

    if (direction === 'long') {
      // Long SL: 가격이 SL 이하로 떨어지면 → 매도 지정가
      results.slOrder = await this.createPriceTriggerOrder(
        contract,
        -Math.abs(size),  // 매도
        sl,               // 트리거 가격
        sl,               // 지정가 (SL 가격으로 청산)
        '2'               // rule 2: 가격 <= triggerPrice
      );

      // Long TP: 가격이 TP 이상으로 오르면 → 매도 지정가
      results.tpOrder = await this.createPriceTriggerOrder(
        contract,
        -Math.abs(size),  // 매도
        tp,               // 트리거 가격
        tp,               // 지정가 (TP 가격으로 청산)
        '1'               // rule 1: 가격 >= triggerPrice
      );
    } else {
      // Short SL: 가격이 SL 이상으로 오르면 → 매수 지정가
      results.slOrder = await this.createPriceTriggerOrder(
        contract,
        Math.abs(size),   // 매수
        sl,               // 트리거 가격
        sl,               // 지정가
        '1'               // rule 1: 가격 >= triggerPrice
      );

      // Short TP: 가격이 TP 이하로 떨어지면 → 매수 지정가
      results.tpOrder = await this.createPriceTriggerOrder(
        contract,
        Math.abs(size),   // 매수
        tp,               // 트리거 가격
        tp,               // 지정가
        '2'               // rule 2: 가격 <= triggerPrice
      );
    }

    logger.info(`SL/TP 지정가 등록 완료: SL=${sl} TP=${tp}`);
    return results;
  },

  /**
   * 조건부 주문 전체 취소
   */
  async cancelAllTriggerOrders(contract) {
    try {
      await futuresApi.cancelPriceTriggeredOrderList(SETTLE, contract);
      logger.info(`조건부 주문 전체 취소: ${contract}`);
    } catch (err) {
      logger.error(`조건부 주문 취소 실패: ${err.message}`);
      throw err;
    }
  },

  /**
   * 조건부 주문 목록 조회
   */
  async listTriggerOrders(contract, status = 'open') {
    try {
      const { body } = await futuresApi.listPriceTriggeredOrders(SETTLE, status, {
        contract,
      });
      return body;
    } catch (err) {
      logger.error(`조건부 주문 조회 실패: ${err.message}`);
      throw err;
    }
  },
};

module.exports = gateClient;
