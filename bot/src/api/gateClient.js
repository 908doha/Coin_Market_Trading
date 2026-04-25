const GateApi = require('gate-api');
const logger = require('../utils/logger');

const SETTLE = 'usdt'; // USDT 마진 선물

/**
 * Gate.io 선물 API 클라이언트 (멀티 계좌 지원)
 *
 * 이전: 싱글톤 객체 (const gateClient = { ... }; module.exports = gateClient;)
 * 현재: 클래스 — 계좌별 인스턴스 생성, bot.js 에서 DI
 *
 * 모든 기존 메서드 시그니처/동작은 그대로 유지. 내부 futuresApi 참조만
 * this.futuresApi 로 변경. 로그는 label 이 'default' 가 아닐 때만 prefix 표시.
 */
class GateClient {
  constructor(apiKey, apiSecret, label = 'default') {
    this.label = label;
    this.client = new GateApi.ApiClient();
    this.client.setApiKeySecret(apiKey, apiSecret);
    this.futuresApi = new GateApi.FuturesApi(this.client);
  }

  /** 계좌 라벨을 로그 메시지 앞에 붙여주는 헬퍼 (싱글 계좌면 그대로) */
  _lg(msg) {
    return this.label === 'default' ? msg : `[${this.label}] ${msg}`;
  }

  /**
   * 캔들(K선) 데이터 조회
   */
  async getCandles(contract, interval, limit = 200) {
    try {
      const opts = { interval, limit };
      const { body } = await this.futuresApi.listFuturesCandlesticks(SETTLE, contract, opts);
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
  }

  /**
   * 현재가 조회
   */
  async getTicker(contract) {
    try {
      const { body } = await this.futuresApi.listFuturesTickers(SETTLE, { contract });
      if (!Array.isArray(body) || body.length === 0 || !body[0]) {
        throw new Error(`티커 응답 없음: ${contract}`);
      }
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
  }

  /**
   * 선물 계약 정보 조회
   */
  async getContract(contract) {
    try {
      const { body } = await this.futuresApi.getFuturesContract(SETTLE, contract);
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
  }

  /**
   * 레버리지 설정
   * 여러 방식으로 시도하여 호환성 확보
   */
  async setLeverage(contract, leverage) {
    const levStr = leverage.toString();

    // 방법 1: 싱글 모드 (leverage를 문자열로)
    try {
      await this.futuresApi.updatePositionLeverage(SETTLE, contract, levStr);
      logger.info(`레버리지 설정 완료: ${contract} x${leverage}`);
      return;
    } catch (err) {
      logger.debug(`싱글 모드 레버리지 실패: ${err.message}`);
    }

    // 방법 2: 듀얼 모드
    try {
      await this.futuresApi.updateDualModePositionLeverage(SETTLE, contract, levStr);
      logger.info(`레버리지 설정 완료 (듀얼): ${contract} x${leverage}`);
      return;
    } catch (err) {
      logger.debug(`듀얼 모드 레버리지 실패: ${err.message}`);
    }

    // 방법 3: 크로스 레버리지
    try {
      await this.futuresApi.updatePositionLeverage(SETTLE, contract, '0', {
        crossLeverageLimit: levStr,
      });
      logger.info(`레버리지 설정 완료 (크로스): ${contract} x${leverage}`);
      return;
    } catch (err) {
      logger.debug(`크로스 레버리지 실패: ${err.message}`);
    }

    // 모든 방법 실패 시 경고만 (주문은 계속 진행)
    logger.warn(`레버리지 설정 실패 - 거래소 기본 레버리지로 진행: ${contract}`);
  }

  /**
   * 선물 주문 (시장가).
   *
   * @param {string} contract - 페어 (e.g. 'BTC_USDT')
   * @param {number} size - 계약 수량 (절댓값, 부호는 side 로 결정). autoSize 사용 시 무시됨
   * @param {string} side - 'buy' | 'sell' (로그 및 autoSize=null 일 때 size 부호 결정)
   * @param {Object} [opts]
   * @param {boolean} [opts.reduceOnly=false] - reduce-only 주문 (Hedge Mode 청산 필수)
   * @param {'close_long'|'close_short'|null} [opts.autoSize=null] - size=0 + auto_size 청산 방식
   * @returns {Promise<Object>} Gate.io order response
   */
  async createOrder(contract, size, side, opts = {}) {
    const { reduceOnly = false, autoSize = null } = opts;
    try {
      const order = new GateApi.FuturesOrder();
      order.contract = contract;

      if (autoSize) {
        // Hedge Mode 청산: size=0 + auto_size (거래소가 전체 청산 처리)
        order.size = 0;
        order.autoSize = autoSize;
      } else {
        order.size = side === 'buy' ? Math.abs(size) : -Math.abs(size);
      }

      order.price = '0'; // 시장가
      order.tif = 'ioc'; // Immediate or Cancel

      if (reduceOnly) {
        order.reduceOnly = true;
      }

      const { body } = await this.futuresApi.createFuturesOrder(SETTLE, order);
      const sizeLabel = autoSize ? autoSize : `size=${size}`;
      const reduceLabel = reduceOnly ? ' [reduce_only]' : '';
      logger.info(`주문 체결: ${side} ${contract} ${sizeLabel}${reduceLabel} id=${body.id}`);
      return body;
    } catch (err) {
      logger.error(`주문 실패: ${err.message}`);
      throw err;
    }
  }

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

      const { body } = await this.futuresApi.createFuturesOrder(SETTLE, order);
      logger.info(`지정가 주문: ${side} ${contract} @ ${price} size=${size} id=${body.id}`);
      return body;
    } catch (err) {
      logger.error(`지정가 주문 실패: ${err.message}`);
      throw err;
    }
  }

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
      const { body } = await this.futuresApi.getPosition(SETTLE, contract);
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
      const { body } = await this.futuresApi.getDualModePosition(SETTLE, contract);
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
  }

  /**
   * 포지션 시장가 청산 (Hedge Mode 안전).
   *
   * size=0 + auto_size + reduce_only 방식으로 Hedge Mode 에서
   * 신규 반대 포지션이 생성되지 않도록 보장한다.
   */
  async closePosition(contract) {
    try {
      const position = await this.getPosition(contract);
      if (!position || position.size === 0) {
        logger.info(`청산할 포지션 없음: ${contract}`);
        return null;
      }
      const autoSize = position.size > 0 ? 'close_long' : 'close_short';
      const closeSide = position.size > 0 ? 'sell' : 'buy';
      return await this.createOrder(contract, 0, closeSide, {
        reduceOnly: true,
        autoSize,
      });
    } catch (err) {
      logger.error(`포지션 청산 실패: ${err.message}`);
      throw err;
    }
  }

  /**
   * 최근 청산 이력 조회 (실현 PnL 확인용)
   *
   * Gate.io FuturesApi.listPositionClose(settle, { contract, limit })
   *   → PositionClose[] : { time, pnl, contract, side, textSize, accumSize,
   *                          firstOpenTime, longPrice, shortPrice, text, maxSize }
   *   pnl 필드가 해당 청산의 실현 손익 (USDT).
   *   time 은 초 단위(epoch seconds) 숫자.
   *
   * 이전엔 getMyTrades 를 썼으나 FuturesMyTrade 에는 pnl 필드가 없어 실효성 없음.
   *
   * @returns {Array<{ time, pnl, contract, side, accumSize, firstOpenTime, text, maxSize }>}
   */
  async getRecentClosedPositions(contract, limit = 20) {
    try {
      const { body } = await this.futuresApi.listPositionClose(SETTLE, { contract, limit });
      if (!Array.isArray(body)) return [];
      return body.map((p) => ({
        time:          p.time != null ? Number(p.time) : null,
        pnl:           p.pnl != null ? parseFloat(p.pnl) : null,
        contract:      p.contract,
        side:          p.side,
        accumSize:     p.accumSize != null ? Number(p.accumSize)
                       : (p.accum_size != null ? Number(p.accum_size) : null),
        firstOpenTime: p.firstOpenTime != null ? Number(p.firstOpenTime)
                       : (p.first_open_time != null ? Number(p.first_open_time) : null),
        text:          p.text,
        maxSize:       p.maxSize != null ? Number(p.maxSize)
                       : (p.max_size != null ? Number(p.max_size) : null),
      }));
    } catch (err) {
      logger.debug(`청산 이력 조회 실패 [${contract}]: ${err.message}`);
      return [];
    }
  }

  /**
   * 잔고 조회
   */
  async getBalance() {
    try {
      const { body } = await this.futuresApi.listFuturesAccounts(SETTLE);
      return {
        total: parseFloat(body.total),
        available: parseFloat(body.available),
        unrealisedPnl: parseFloat(body.unrealisedPnl),
      };
    } catch (err) {
      logger.error(`잔고 조회 실패: ${err.message}`);
      throw err;
    }
  }

  /**
   * 미체결 주문 전체 취소
   */
  async cancelAllOrders(contract) {
    try {
      await this.futuresApi.cancelFuturesOrders(SETTLE, contract, { side: 'ask' });
      await this.futuresApi.cancelFuturesOrders(SETTLE, contract, { side: 'bid' });
      logger.info(`미체결 주문 전체 취소: ${contract}`);
    } catch (err) {
      logger.error(`주문 취소 실패: ${err.message}`);
      throw err;
    }
  }

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

    // long:  SL rule=2 (<=), TP rule=1 (>=)
    // short: SL rule=1 (>=), TP rule=2 (<=)
    const slRule = direction === 'long' ? 2 : 1;
    const tpRule = direction === 'long' ? 1 : 2;

    // 1) SL 먼저 등록
    results.slOrder = await this._createTriggerOrder(contract, slRounded, slRule, orderType, modeOpts);

    // 2) TP 등록 시도 — 실패 시 이미 등록된 SL 을 롤백해 orphan 방지 (원자성 보장)
    try {
      results.tpOrder = await this._createTriggerOrder(contract, tpRounded, tpRule, orderType, modeOpts);
    } catch (tpErr) {
      if (results.slOrder && results.slOrder.id) {
        logger.warn(
          `[${contract}] TP 등록 실패 → 이미 등록된 SL 롤백 시도 (id=${results.slOrder.id}): ${tpErr.message}`
        );
        const rollback = await this.cancelTriggerOrder(results.slOrder.id);
        if (rollback) {
          logger.info(`[${contract}] SL 롤백 완료 (orphan 방지)`);
          results.slOrder = null;
        } else {
          logger.error(
            `[${contract}] SL 롤백 실패 — orphan SL 수동 정리 필요 (id=${results.slOrder.id})`
          );
        }
      }
      throw tpErr;
    }

    logger.info(`SL/TP 등록 완료: SL=${slRounded} TP=${tpRounded} (mode=${isDual ? 'dual' : 'single'})`);
    return results;
  }

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

      const { body } = await this.futuresApi.createPriceTriggeredOrder(SETTLE, order);
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
  }

  /**
   * 조건부 주문 목록 조회 (특정 페어 / 상태별)
   *
   * SDK: listPriceTriggeredOrders(settle, status, { contract })
   * 반환된 결과에서 한 번 더 contract 일치 여부를 필터하여 서버 측 필터가
   * 제대로 동작하지 않아도 다른 페어가 섞이지 않도록 방어.
   *
   * @param {string} contract  거래 페어 (예: "BTC_USDT")
   * @param {string} status    'open' | 'finished'
   * @returns {Array} 트리거 주문 목록 (실패/없음 시 빈 배열)
   */
  async listTriggerOrders(contract, status = 'open') {
    try {
      const { body } = await this.futuresApi.listPriceTriggeredOrders(SETTLE, status, { contract });
      if (!Array.isArray(body)) return [];
      return body.filter((o) => o && o.initial && o.initial.contract === contract);
    } catch (err) {
      logger.error(`조건부 주문 목록 조회 실패 [${contract}]: ${err.message}`);
      return [];
    }
  }

  /**
   * 조건부 주문 개별 취소 (주문 ID 지정)
   *
   * SDK: cancelPriceTriggeredOrder(settle, orderId)
   * 이미 체결/취소된 주문은 경고 없이 true 반환 (idempotent).
   */
  async cancelTriggerOrder(orderId) {
    if (orderId == null) return false;
    try {
      await this.futuresApi.cancelPriceTriggeredOrder(SETTLE, String(orderId));
      return true;
    } catch (err) {
      const label = err && err.body && err.body.label;
      if (label === 'ORDER_NOT_FOUND' || label === 'ORDER_FINISHED' || label === 'AUTO_ORDER_NOT_FOUND') {
        logger.debug(`조건부 주문 이미 종료됨 [${orderId}]: ${label}`);
        return true;
      }
      logger.error(`조건부 주문 취소 실패 [${orderId}]: ${err.message}`);
      return false;
    }
  }

  /**
   * 페어별 조건부 주문 전체 취소 (안전 버전)
   *
   * ⚠️ 배경: Gate.io SDK의 cancelPriceTriggeredOrderList(settle, contract) 는
   *   DELETE /futures/{settle}/price_orders 로 매핑되는데, 이 엔드포인트는
   *   contract 쿼리 파라미터가 optional 이어서 직렬화 누락 시 **계정 전체**
   *   trigger order 가 삭제되는 치명적 위험이 있다.
   *   (2026-04-15 20:49:03 KST 사고 재발 방지)
   *
   * 안전 절차:
   *   1) listTriggerOrders 로 해당 페어의 open trigger 만 조회
   *   2) 각 주문의 order.initial.contract 재검증
   *   3) cancelPriceTriggeredOrder(orderId) 로 개별 취소
   *   → 다른 페어에는 절대 영향 없음.
   */
  async cancelAllTriggerOrders(contract) {
    if (!contract) {
      logger.error('cancelAllTriggerOrders: contract 인자 필수 (안전장치)');
      return;
    }
    try {
      const orders = await this.listTriggerOrders(contract, 'open');
      if (orders.length === 0) {
        logger.debug(`조건부 주문 취소: ${contract} - 대상 없음`);
        return;
      }
      let ok = 0;
      for (const order of orders) {
        if (!order.initial || order.initial.contract !== contract) {
          logger.warn(
            `조건부 주문 skip (contract 불일치): expected=${contract} actual=${order.initial && order.initial.contract}`
          );
          continue;
        }
        const success = await this.cancelTriggerOrder(order.id);
        if (success) ok++;
      }
      logger.info(`조건부 주문 취소 완료: ${contract} (${ok}/${orders.length}건)`);
    } catch (err) {
      logger.error(`조건부 주문 취소 실패 [${contract}]: ${err.message}`);
    }
  }
}

module.exports = GateClient;
