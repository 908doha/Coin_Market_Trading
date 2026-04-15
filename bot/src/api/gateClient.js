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
        orderPriceRound: parseFloat(body.orderPriceRound), // tick size (가격 최소 단위)
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
    let singleParsed = null;
    try {
      const { body } = await futuresApi.getPosition(SETTLE, contract);
      logger.debug(`포지션 원본(single): ${JSON.stringify(body)}`);
      singleParsed = parsePosition(body);
      if (singleParsed.size !== 0) return singleParsed;
      // size=0이어도 dual 모드 확인을 시도한다 (듀얼 모드 계정 대응)
    } catch (err) {
      if (err.body && (err.body.label === 'POSITION_NOT_FOUND' || err.body.label === 'POSITION_EMPTY')) {
        // single 없음 → dual 시도
      } else {
        logger.debug(`single 포지션 조회 에러: ${err.message}`);
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
    } catch (err) {
      if (!(err.body && (err.body.label === 'POSITION_NOT_FOUND' || err.body.label === 'POSITION_EMPTY'))) {
        logger.debug(`dual 포지션 없음 (${err.message})`);
      }
    }

    // 둘 다 size=0 이면 빈 포지션 (single 모드 기준 구조라도 반환)
    return singleParsed && singleParsed.size === 0 ? null : null;
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
   * Single/Dual 모드 자동 대응
   *
   * @param contract 거래쌍
   * @param positionSize 현재 포지션 사이즈 (항상 양수) - 사용 안 함 (close 자동)
   * @param direction 'long' 또는 'short'
   * @param sl 손절 가격
   * @param tp 익절 가격
   */
  async placeSLTP(contract, positionSize, direction, sl, tp) {
    const results = { slOrder: null, tpOrder: null };

    // 포지션 모드 감지 (single vs dual)
    let isDual = false;
    try {
      const pos = await this.getPosition(contract);
      const mode = (pos && pos.mode) || 'single';
      isDual = mode === 'dual_long' || mode === 'dual_short' || mode === 'dual';
      logger.debug(`[${contract}] 포지션 mode=${mode} isDual=${isDual}`);
    } catch (err) {
      logger.warn(`[${contract}] 포지션 mode 확인 실패, single 가정: ${err.message}`);
    }

    // tick size (orderPriceRound) 로 SL/TP 가격 반올림
    //   Gate.io는 trigger.price가 tick의 정수 배수가 아니면 400 (AUTO_INVALID_PARAM_TRIGGER_PRICE) 반환
    let tick = 0.01; // 폴백
    try {
      const info = await this.getContract(contract);
      if (info.orderPriceRound && info.orderPriceRound > 0) {
        tick = info.orderPriceRound;
      }
    } catch (err) {
      logger.warn(`[${contract}] tick size 조회 실패, 폴백 ${tick} 사용: ${err.message}`);
    }

    const decimals = (tick.toString().split('.')[1] || '').length;
    const roundToTick = (price) => parseFloat((Math.round(price / tick) * tick).toFixed(decimals));
    const slRounded = roundToTick(sl);
    const tpRounded = roundToTick(tp);

    if (slRounded !== sl || tpRounded !== tp) {
      logger.info(`[${contract}] tick=${tick} | SL ${sl} → ${slRounded} | TP ${tp} → ${tpRounded}`);
    }

    // Dual 모드: close-long-position / close-short-position
    // Single 모드: close-long-order / close-short-order
    const suffix = isDual ? 'position' : 'order';
    const orderType = direction === 'long' ? `close-long-${suffix}` : `close-short-${suffix}`;
    const autoSize = direction === 'long' ? 'close_long' : 'close_short';
    const modeOpts = { isDual, autoSize };

    if (direction === 'long') {
      // SL: mark price <= sl 도달 시 청산 (rule=2)
      results.slOrder = await this._createTriggerOrder(contract, slRounded, 2, orderType, modeOpts);
      // TP: mark price >= tp 도달 시 청산 (rule=1)
      results.tpOrder = await this._createTriggerOrder(contract, tpRounded, 1, orderType, modeOpts);
    } else {
      // SL: mark price >= sl 도달 시 청산 (rule=1)
      results.slOrder = await this._createTriggerOrder(contract, slRounded, 1, orderType, modeOpts);
      // TP: mark price <= tp 도달 시 청산 (rule=2)
      results.tpOrder = await this._createTriggerOrder(contract, tpRounded, 2, orderType, modeOpts);
    }

    logger.info(`SL/TP 등록 완료: SL=${slRounded} TP=${tpRounded} (mode=${isDual ? 'dual' : 'single'})`);
    return results;
  },

  /**
   * Gate.io Price Triggered Order 생성
   * 트리거 발동 시 시장가 전량 청산
   *   - Single 모드: close: true
   *   - Dual 모드  : autoSize: 'close_long'|'close_short' + reduceOnly
   *                 (dual 모드는 close: true 금지 - AUTO_INVALID_PARAM_CLOSE)
   */
  async _createTriggerOrder(contract, triggerPrice, rule, orderType, modeOpts = {}) {
    try {
      const order = new GateApi.FuturesPriceTriggeredOrder();

      const initial = new GateApi.FuturesInitialOrder();
      initial.contract = contract;
      initial.size = 0;                      // close/autoSize 시 0
      initial.price = '0';                   // 0 = 시장가 체결
      initial.tif = 'ioc';                   // market order IOC

      if (modeOpts.isDual) {
        // Dual 모드: autoSize + reduceOnly (close 금지)
        initial.autoSize = modeOpts.autoSize; // 'close_long' | 'close_short'
        initial.reduceOnly = true;
      } else {
        // Single 모드: close=true (포지션 전량 청산)
        initial.close = true;
      }

      const trigger = new GateApi.FuturesPriceTrigger();
      trigger.strategyType = 0;              // price trigger
      trigger.priceType = 1;                 // mark price
      trigger.price = triggerPrice.toString();
      trigger.rule = rule;                   // 1: >=, 2: <=
      trigger.expiration = 0;                // 만료 없음

      order.initial = initial;
      order.trigger = trigger;
      order.orderType = orderType;

      const { body } = await futuresApi.createPriceTriggeredOrder(SETTLE, order);
      logger.info(`조건부 주문 등록: ${orderType} trigger=${triggerPrice} id=${body.id}`);
      return body;
    } catch (err) {
      // Gate.io SDK 에러 안전 추출 (순환 참조 피함)
      let detailStr = '(없음)';
      try {
        const detail =
          err.body ||
          (err.response && err.response.data) ||
          (err.response && err.response.body) ||
          null;
        if (detail) {
          detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
        } else if (err.response) {
          detailStr = `status=${err.response.status || err.response.statusCode || '?'} statusText=${err.response.statusText || '-'}`;
        }
      } catch (logErr) {
        detailStr = `(추출 실패: ${logErr.message})`;
      }
      logger.error(`조건부 주문 실패 [${orderType}]: ${err.message} | 상세: ${detailStr}`);
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
