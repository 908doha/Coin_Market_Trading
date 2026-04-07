/**
 * BotManager
 * 계좌별 봇 인스턴스를 생성·관리한다.
 * 각 인스턴스는 독립된 cron + Gate.io API 키를 갖는다.
 */

const cron       = require('node-cron');
const logger     = require('../utils/logger');
const { registry } = require('../strategies');

// ── 계좌별 Gate.io 클라이언트 팩토리 ─────────────────────────────
function makeGateClient(apiKey, apiSecret) {
  const GateApi = require('gate-api');
  const client  = new GateApi.ApiClient();
  client.setApiKeySecret(apiKey, apiSecret);
  return {
    futures: new GateApi.FuturesApi(client),
    spot:    new GateApi.SpotApi(client),
    _raw:    client,
  };
}

// ── 단일 계좌 봇 인스턴스 ────────────────────────────────────────
class BotInstance {
  constructor({ accountId, apiKey, apiSecret, exchange, agentId, StrategyClass }) {
    this.accountId  = accountId;
    this.agentId    = agentId;
    this.exchange   = exchange;
    this.gate       = makeGateClient(apiKey, apiSecret);
    this.strategy   = new StrategyClass();
    this.cronJob    = null;
    this.running    = false;
    this.startedAt  = null;
    this.lastTick   = null;
    this.lastSignal = null;
    this.errorCount = 0;
  }

  async start() {
    // 잔고 확인 (API 키 유효성 검증)
    const bal = await this.gate.futures.listFuturesAccounts('usdt');
    logger.info(`[Bot:${this.accountId}] 시작 — 잔고 ${bal.body.available} USDT`);

    this.running   = true;
    this.startedAt = new Date().toISOString();

    // 1분마다 실행
    this.cronJob = cron.schedule('*/1 * * * *', () => this._tick());
    // 즉시 1회
    await this._tick();
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
      const GateApi = require('gate-api');
      const client  = new GateApi.ApiClient();
      // candle 조회용 별도 클라이언트 (인증 불필요)
      const futuresApi = new GateApi.FuturesApi(client);

      const settle  = 'usdt';
      const contract = 'BTC_USDT'; // TODO: 전략 내부 설정으로 이동

      const [htf, mtf, ltf] = await Promise.all([
        futuresApi.listFuturesCandlesticks(settle, contract, { interval: '4h',  limit: 200 }),
        futuresApi.listFuturesCandlesticks(settle, contract, { interval: '15m', limit: 200 }),
        futuresApi.listFuturesCandlesticks(settle, contract, { interval: '5m',  limit: 200 }),
      ]);

      const toCandles = (raw) => raw.body.map((c) => ({
        time:  c.t,
        open:  parseFloat(c.o),
        high:  parseFloat(c.h),
        low:   parseFloat(c.l),
        close: parseFloat(c.c),
        volume: parseFloat(c.v),
      }));

      const signal = this.strategy.analyze({
        htf: toCandles(htf),
        mtf: toCandles(mtf),
        ltf: toCandles(ltf),
      });

      this.lastSignal = signal;

      if (!signal?.signal) {
        logger.debug(`[Bot:${this.accountId}] 신호 없음: ${signal?.reason ?? ''}`);
        return;
      }

      // ── 주문 실행 ──────────────────────────────────────────────
      logger.info(`[Bot:${this.accountId}] 신호: ${signal.direction} entry=${signal.entry} sl=${signal.sl} tp=${signal.tp}`);

      const GateApiOrder = require('gate-api');
      const orderClient  = new GateApiOrder.ApiClient();
      orderClient.setApiKeySecret(this.gate._raw.authentications.apiv4.apiKey, this.gate._raw.authentications.apiv4.apiSecret);
      const orderApi = new GateApiOrder.FuturesApi(orderClient);

      const size = signal.direction === 'Long' ? 1 : -1; // 최소 1 계약

      await orderApi.createFuturesOrder(settle, {
        contract,
        size,
        price:  '0',     // 시장가
        tif:    'ioc',
        text:   `osprey_${this.agentId}`,
      });

      this.errorCount = 0;
      logger.info(`[Bot:${this.accountId}] 주문 완료`);

    } catch (err) {
      this.errorCount++;
      logger.error(`[Bot:${this.accountId}] tick 오류 (${this.errorCount}): ${err.message}`);
    }
  }

  getStatus() {
    return {
      accountId:  this.accountId,
      agentId:    this.agentId,
      running:    this.running,
      startedAt:  this.startedAt,
      lastTick:   this.lastTick,
      lastSignal: this.lastSignal ? { direction: this.lastSignal.direction, reason: this.lastSignal.reason } : null,
      errorCount: this.errorCount,
    };
  }
}

// ── BotManager (싱글톤) ──────────────────────────────────────────
class BotManager {
  constructor() {
    this.bots = new Map(); // accountId → BotInstance
  }

  async start({ accountId, apiKey, apiSecret, exchange, agentId }) {
    // 이미 실행 중이면 재시작
    if (this.bots.has(accountId)) {
      logger.info(`[BotManager] ${accountId} 재시작`);
      await this.stop(accountId);
    }

    const StrategyClass = registry.get(agentId);
    if (!StrategyClass) {
      throw new Error(`등록되지 않은 에이전트: ${agentId}`);
    }

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
    // 전체
    const all = {};
    for (const [id, bot] of this.bots) all[id] = bot.getStatus();
    return all;
  }

  isRunning(accountId) {
    return this.bots.has(accountId) && this.bots.get(accountId).running;
  }
}

// 싱글톤 export
module.exports = new BotManager();
