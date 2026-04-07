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
    // 포지션 응답 파싱 헬퍼
    const parsePosition = (pos) => {
      // SDK는 camelCase, raw API는 snake_case일 수 있으므로 둘 다 처리
      const size = pos.size || 0;
      const entryPrice = pos.entryPrice || pos.entry_price || '0';
      const markPrice = pos.markPrice || pos.mark_price || '0';
      const unrealisedPnl = pos.unrealisedPnl || pos.unrealised_pnl || '0';
      const leverage = pos.leverage || pos.cross_leverage_limit || pos.crossLeverageLimit || '0';
      const mode = pos.mode || 'single';

      return {
        size: Number(size),
        entryPrice: parseFloat(entryPrice),
        markPrice: parseFloat(markPrice),
        unrealisedPnl: parseFloat(unrealisedPnl),
        leverage: leverage.toString().replace(/[^0-9.]/g, ''),
        mode,
      };
    };

    // 싱글 모드 시도
    try {
      const { body } = await futuresApi.getPosition(SETTLE, contract);
      logger.debug(`포지션 원본: ${JSON.stringify(body)}`);
      const parsed = parsePosition(body);
      if (parsed.size !== 0) return parsed;
      return null;
    } catch (err) {
      if (err.body && (err.body.label === 'POSITION_NOT_FOUND' || err.body.label === 'POSITION_EMPTY')) {
        return null;
      }
    }

    // 듀얼 모드 시도
    try {
      const { body } = await futuresApi.getDualModePosition(SETTLE, contract);
      if (Array.isArray(body)) {
        for (const pos of body) {
          const parsed = parsePosition(pos);
          if (parsed.size !== 0) {
            logger.debug(`듀얼 포지션 원본: ${JSON.stringify(pos)}`);
            return parsed;
          }
        }
      }
      return null;
    } catch (err) {
      if (err.body && (err.body.label === 'POSITION_NOT_FOUND' || err.body.label === 'POSITION_EMPTY')) {
        return null;
      }
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
   * SL/TP 지정가 주문 세트 등록
   * Gate.io Price Triggered Order (Plan Order)
   *
   * @param contract 거래쌍
   * @param positionSize 현재 포지션 사이즈 (항상 양수)
   * @param direction 'long' 또는 'short'
   * @param sl 손절 가격
   * @param tp 익절 가격
   */
  async placeSLTP(contract, positionSize, direction, sl, tp) {
    const results = { slOrder: null, tpOrder: null };
    const absSize = Math.abs(positionSize);

    if (direction === 'long') {
      // Long 청산 = 매도 (음수 size)
      // SL: mark price <= sl 도달 시 청산 (rule=2)
      results.slOrder = await this._createTriggerOrder(contract, -absSize, sl, 2, 'close-long-order');
      // TP: mark price >= tp 도달 시 청산 (rule=1)
      results.tpOrder = await this._createTriggerOrder(contract, -absSize, tp, 1, 'close-long-order');
    } else {
      // Short 청산 = 매수 (양수 size)
      // SL: mark price >= sl 도달 시 청산 (rule=1)
      results.slOrder = await this._createTriggerOrder(contract, absSize, sl, 1, 'close-short-order');
      // TP: mark price <= tp 도달 시 청산 (rule=2)
      results.tpOrder = await this._createTriggerOrder(contract, absSize, tp, 2, 'close-short-order');
    }

    logger.info(`SL/TP 등록 완료: SL=${sl} TP=${tp}`);
    return results;
  },

  /**
   * Gate.io Price Triggered Order 생성
   * 지정가(GTC) + reduceOnly 방식으로 포지션 청산 전용
   */
  async _createTriggerOrder(contract, size, triggerPrice, rule, orderType) {
    try {
      const order = new GateApi.FuturesPriceTriggeredOrder();

      const initial = new GateApi.FuturesInitialOrder();
      initial.contract = contract;
      initial.size = size;                   // 청산 방향 (음수: 매도, 양수: 매수)
      initial.price = triggerPrice.toString(); // 지정가
      initial.tif = 'gtc';                   // Good Till Cancel
      initial.reduceOnly = true;             // 포지션 감소 전용

      const trigger = new GateApi.FuturesPriceTrigger();
      trigger.strategyType = 0;              // price trigger
      trigger.priceType = 1;                 // mark price
      trigger.price = triggerPrice.toString();
      trigger.rule = rule;                   // 1: >=, 2: <=

      order.initial = initial;
      order.trigger = trigger;
      order.orderType = orderType;

      const { body } = await futuresApi.createPriceTriggeredOrder(SETTLE, order);
      logger.info(`조건부 주문 등록: ${orderType} trigger=${triggerPrice} size=${size} id=${body.id}`);
      return body;
    } catch (err) {
      logger.error(`조건부 주문 실패 [${orderType}]: ${err.message}`);
      if (err.body) {
        logger.error(`상세: ${JSON.stringify(err.body)}`);
      }
      throw err;
    }
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
    }
  },
};

module.exports = gateClient;
