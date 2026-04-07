/**
 * BotManager
 * 계좌별 봇 인스턴스를 생성·관리한다.
 * 각 인스턴스는 독립된 cron + Gate.io API 키를 갖는다.
 */

const cron       = require('node-cron');
const logger     = require('../utils/logger');
const config     = require('../config');
const { registry } = require('../strategies');

const SETTLE   = 'usdt';
const CONTRACT = 'BTC_USDT';

// ── Gate.io 클라이언트 팩토리 ─────────────────────────────────────
function makeGateClient(apiKey, apiSecret) {
  const GateApi  = require('gate-api');
  const client   = new GateApi.ApiClient();
  client.setApiKeySecret(apiKey, apiSecret);
  return {
    futures: new GateApi.FuturesApi(client),
    spot:    new GateApi.SpotApi(client),
  };
}

// 공개 클라이언트 (캔들 조회용, 인증 불필요)
function makePublicClient() {
  const GateApi = require('gate-api');
  return new GateApi.FuturesApi(new GateApi.ApiClient());
}

// ── 단일 계좌 봇 인스턴스 ────────────────────────────────────────
class BotInstance {
  constructor({ accountId, apiKey, apiSecret, exchange, agentId, StrategyClass }) {
    this.accountId  = accountId;
    this.agentId    = agentId;
    this.exchange   = exchange;
    this.apiKey     = apiKey;      // 직접 저장
    this.apiSecret  = apiSecret;   // 직접 저장
    this.gate       = makeGateClient(apiKey, apiSecret);
    this.pubApi     = makePublicClient();
    this.strategy   = new StrategyClass();
    this.cronJob    = null;
    this.running    = false;
    this.startedAt  = null;
    this.lastTick   = null;
    this.lastSignal = null;
    this.errorCount = 0;
    this.lastOrderAt = null;
  }

  async start() {
    // API 키 유효성 검증 — 잔고 조회
    const bal = await this.gate.futures.listFuturesAccounts(SETTLE);
    logger.info(`[Bot:${this.accountId}] 시작 — 잔고 ${bal.body.available} USDT`);

    // 레버리지 설정
    try {
      await this.gate.futures.updatePositionLeverage(SETTLE, CONTRACT, String(config.leverage), {});
      logger.info(`[Bot:${this.accountId}] 레버리지 ${config.leverage}x 설정 완료`);
    } catch (e) {
      logger.warn(`[Bot:${this.accountId}] 레버리지 설정 실패 (무시): ${e.message}`);
    }

    this.running   = true;
    this.startedAt = new Date().toISOString();

    this.cronJob = cron.schedule(config.cronSchedule, () => this._tick());
    await this._tick(); // 즉시 1회 실행
  }

  async stop() {
    this.running = false;
    if (this.cronJob) { this.cronJob.stop(); this.cronJob = null; }
    logger.info(`[Bot:${this.accountId}] 중지`);
  }

  async _tick() {
    if (!this.running) return;
    this.lastTick = new Date().toISOString();

    try {
      // ── 1. 캔들 데이터 조회 (공개 API) ──────────────────────────
      const [htfRaw, mtfRaw, ltfRaw] = await Promise.all([
        this.pubApi.listFuturesCandlesticks(SETTLE, CONTRACT, { interval: config.timeframes.htf, limit: 200 }),
        this.pubApi.listFuturesCandlesticks(SETTLE, CONTRACT, { interval: config.timeframes.mtf, limit: 200 }),
        this.pubApi.listFuturesCandlesticks(SETTLE, CONTRACT, { interval: config.timeframes.ltf, limit: 200 }),
      ]);

      const toCandles = (raw) => raw.body.map((c) => ({
        time:   c.t,
        open:   parseFloat(c.o),
        high:   parseFloat(c.h),
        low:    parseFloat(c.l),
        close:  parseFloat(c.c),
        volume: parseFloat(c.v),
      }));

      // ── 2. 전략 분석 ─────────────────────────────────────────────
      const signal = this.strategy.analyze({
        htf: toCandles(htfRaw),
        mtf: toCandles(mtfRaw),
        ltf: toCandles(ltfRaw),
      });

      this.lastSignal = signal;

      if (!signal?.signal) {
        logger.debug(`[Bot:${this.accountId}] 신호 없음: ${signal?.reason ?? ''}`);
        return;
      }

      // ── 3. 이미 열린 포지션 확인 ─────────────────────────────────
      const posRes = await this.gate.futures.getPosition(SETTLE, CONTRACT).catch(() => null);
      const openSize = posRes ? parseFloat(posRes.body?.size ?? '0') : 0;
      if (openSize !== 0) {
        logger.debug(`[Bot:${this.accountId}] 이미 포지션 있음 (size=${openSize}), 신규 진입 건너뜀`);
        return;
      }

      // ── 4. 쿨다운 체크 (1분) ─────────────────────────────────────
      if (this.lastOrderAt) {
        const elapsedSec = (Date.now() - new Date(this.lastOrderAt).getTime()) / 1000;
        if (elapsedSec < 60) {
          logger.debug(`[Bot:${this.accountId}] 쿨다운 중 (${Math.round(elapsedSec)}초)`);
          return;
        }
      }

      // ── 5. 주문 수량 계산 ─────────────────────────────────────────
      const direction = signal.signal; // 'long' | 'short'
      const balRes    = await this.gate.futures.listFuturesAccounts(SETTLE);
      const available = parseFloat(balRes.body.available ?? '0');
      const budget    = Math.min(config.positionSizeUsdt, available * 0.9);

      if (budget < 1) {
        logger.warn(`[Bot:${this.accountId}] 잔고 부족 (${available} USDT)`);
        return;
      }

      // Gate.io 선물 계약 크기 조회
      const contractInfo = await this.pubApi.getFuturesContract(SETTLE, CONTRACT);
      const quantoMultiplier = parseFloat(contractInfo.body?.quanto_multiplier ?? '0.0001');
      const markPrice = parseFloat(contractInfo.body?.mark_price ?? signal.entry);

      // 계약 수 = 예산 / (mark_price * quanto_multiplier)
      const contracts = Math.max(1, Math.floor((budget * config.leverage) / (markPrice * quantoMultiplier)));
      const size      = direction === 'long' ? contracts : -contracts;

      logger.info(
        `[Bot:${this.accountId}] 신호: ${direction.toUpperCase()} | ` +
        `entry=${signal.entry} sl=${signal.sl} tp=${signal.tp} | ` +
        `계약수=${contracts} (${budget} USDT × ${config.leverage}x)`,
      );

      // ── 6. 진입 주문 (시장가 IOC) ────────────────────────────────
      await this.gate.futures.createFuturesOrder(SETTLE, {
        contract: CONTRACT,
        size,
        price:    '0',
        tif:      'ioc',
        text:     `t_osprey_${this.agentId}`,
      });

      this.lastOrderAt = new Date().toISOString();
      logger.info(`[Bot:${this.accountId}] 진입 주문 완료 (size=${size})`);

      // ── 7. SL / TP 주문 (잠시 후 포지션 확인 후 설정) ───────────
      setTimeout(() => this._placeSlTp(direction, signal.sl, signal.tp).catch((e) => {
        logger.error(`[Bot:${this.accountId}] SL/TP 설정 실패: ${e.message}`);
      }), 3000);

      this.errorCount = 0;

    } catch (err) {
      this.errorCount++;
      logger.error(`[Bot:${this.accountId}] tick 오류 (${this.errorCount}): ${err.message}`);
      if (err.body) logger.error(`[Bot:${this.accountId}] 응답 body: ${JSON.stringify(err.body)}`);
    }
  }

  async _placeSlTp(direction, sl, tp) {
    // 포지션이 실제로 열렸는지 확인
    const posRes  = await this.gate.futures.getPosition(SETTLE, CONTRACT).catch(() => null);
    const openSize = posRes ? parseFloat(posRes.body?.size ?? '0') : 0;
    if (openSize === 0) {
      logger.warn(`[Bot:${this.accountId}] SL/TP 설정 건너뜀 — 포지션 없음 (IOC 미체결 가능성)`);
      return;
    }

    const absSize  = Math.abs(openSize);
    const closeSz  = direction === 'long' ? -absSize : absSize;

    // Gate.io price-triggered order (stop-market)
    // rule: 1 = trigger when price >= stop_price, 2 = trigger when price <= stop_price
    const slRule = direction === 'long' ? 2 : 1; // Long SL: price drops to sl
    const tpRule = direction === 'long' ? 1 : 2; // Long TP: price rises to tp

    const makeTriggered = (stopPrice, rule, label) => ({
      initial: {
        contract: CONTRACT,
        size:     closeSz,
        price:    '0',   // 시장가
        tif:      'ioc',
        text:     `t_osprey_${label}_${this.agentId}`,
        reduce_only: true,
      },
      trigger: {
        strategy_type: 0,        // by price
        price_type:    0,        // last price
        price:         String(stopPrice),
        rule,
        expiration:    86400,    // 24시간 유효
      },
    });

    await this.gate.futures.createPriceTriggerOrder(SETTLE, makeTriggered(sl, slRule, 'sl'))
      .catch((e) => logger.warn(`[Bot:${this.accountId}] SL 주문 실패: ${e.message}`));

    await this.gate.futures.createPriceTriggerOrder(SETTLE, makeTriggered(tp, tpRule, 'tp'))
      .catch((e) => logger.warn(`[Bot:${this.accountId}] TP 주문 실패: ${e.message}`));

    logger.info(`[Bot:${this.accountId}] SL(${sl}) / TP(${tp}) 설정 완료`);
  }

  getStatus() {
    return {
      accountId:   this.accountId,
      agentId:     this.agentId,
      running:     this.running,
      startedAt:   this.startedAt,
      lastTick:    this.lastTick,
      lastOrderAt: this.lastOrderAt,
      lastSignal:  this.lastSignal
        ? {
            signal:     this.lastSignal.signal,
            reason:     this.lastSignal.reason,
            entry:      this.lastSignal.entry,
            sl:         this.lastSignal.sl,
            tp:         this.lastSignal.tp,
            confluence: this.lastSignal.confluence,
          }
        : null,
      errorCount:  this.errorCount,
    };
  }
}

// ── BotManager (싱글톤) ──────────────────────────────────────────
class BotManager {
  constructor() {
    this.bots = new Map(); // accountId → BotInstance
  }

  async start({ accountId, apiKey, apiSecret, exchange, agentId }) {
    if (this.bots.has(accountId)) {
      logger.info(`[BotManager] ${accountId} 재시작`);
      await this.stop(accountId);
    }

    const StrategyClass = registry.get(agentId);
    if (!StrategyClass) throw new Error(`등록되지 않은 에이전트: ${agentId}`);

    const bot = new BotInstance({ accountId, apiKey, apiSecret, exchange, agentId, StrategyClass });
    await bot.start();
    this.bots.set(accountId, bot);
    logger.info(`[BotManager] ${accountId} → ${agentId} 시작 완료`);
  }

  async stop(accountId) {
    const bot = this.bots.get(accountId);
    if (!bot) return;
    await bot.stop();
    this.bots.delete(accountId);
  }

  async stopAll() {
    for (const id of this.bots.keys()) await this.stop(id);
  }

  getStatus(accountId) {
    if (accountId) return this.bots.get(accountId)?.getStatus() ?? null;
    const all = {};
    for (const [id, bot] of this.bots) all[id] = bot.getStatus();
    return all;
  }

  isRunning(accountId) {
    return this.bots.has(accountId) && this.bots.get(accountId).running;
  }
}

module.exports = new BotManager();
