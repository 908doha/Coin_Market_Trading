require('dotenv').config();

const cron = require('node-cron');
const config = require('./config');
const gateClient = require('./api/gateClient');
const IctStrategy = require('./strategies/ictStrategy');
const OrderManager = require('./services/orderManager');
const TelegramService = require('./services/telegram');
const logger = require('./utils/logger');

class TradingBot {
  constructor() {
    this.strategy = new IctStrategy();
    this.orderManager = new OrderManager();
    this.telegram = new TelegramService(this);
    this.activePositions = new Map(); // pair → { direction, sl, tp }
    this.validPairs = [];
    this.isRunning = false;
  }

  /**
   * 봇 시작
   */
  async start() {
    logger.info('='.repeat(60));
    logger.info('Gate.io ICT Trading Bot 시작 (Multi-Pair)');
    logger.info(`거래 페어 (설정): ${config.tradePairs.join(', ')}`);
    logger.info(`레버리지: x${config.leverage}`);
    logger.info(
      `포지션 사이징: Kelly 페어별 (Half=${config.kelly.fraction}, Max=${(config.kelly.maxFraction * 100).toFixed(0)}%, Default=${(config.kelly.defaultFraction * 100).toFixed(1)}%, MinTrades=${config.kelly.minTrades})`
    );
    logger.info(`총 노출 상한: ${(config.kelly.maxTotalExposure * 100).toFixed(0)}% (전 페어 합산 leveraged notional)`);
    logger.info(`타임프레임: HTF=${config.timeframes.htf} MTF=${config.timeframes.mtf} LTF=${config.timeframes.ltf}`);
    logger.info(`스케줄: ${config.cronSchedule}`);
    logger.info('='.repeat(60));

    // API 키 확인
    if (!config.apiKey || !config.apiSecret) {
      logger.error('.env 파일에 GATEIO_API_KEY, GATEIO_API_SECRET 설정 필요');
      process.exit(1);
    }

    // 초기 잔고 확인
    try {
      const balance = await gateClient.getBalance();
      logger.info(`계좌 잔고: ${balance.total.toFixed(2)} USDT (가용: ${balance.available.toFixed(2)} USDT)`);
    } catch (err) {
      logger.error(`API 연결 실패: ${err.message}`);
      process.exit(1);
    }

    // 페어 검증 (Gate.io 선물에 실제 존재하는지)
    for (const pair of config.tradePairs) {
      try {
        const contract = await gateClient.getContract(pair);
        this.validPairs.push(pair);
        logger.info(`[${pair}] 검증 OK (multiplier=${contract.quantoMultiplier})`);
      } catch (err) {
        logger.error(`[${pair}] 페어 검증 실패 - Gate.io 선물에 없음: ${err.message} (스킵)`);
      }
    }

    if (this.validPairs.length === 0) {
      logger.error('유효한 거래 페어가 없습니다. 종료.');
      process.exit(1);
    }

    logger.info(`거래 페어 (유효): ${this.validPairs.join(', ')}`);

    // 기존 포지션 감지 (유효한 페어별로)
    for (const pair of this.validPairs) {
      try {
        const position = await gateClient.getPosition(pair);
        if (position && position.size !== 0) {
          const direction = position.size > 0 ? 'long' : 'short';
          this.activePositions.set(pair, {
            direction,
            sl: null, // 수동 SL/TP일 수 있으므로 null
            tp: null,
            existing: true,
          });
          await this.orderManager.registerExistingPosition(pair, position);
          logger.info(`[${pair}] 기존 포지션 감지: ${direction.toUpperCase()} size=${position.size} entry=${position.entryPrice}`);
        }
      } catch {
        // 포지션 없음
      }
    }

    if (this.activePositions.size > 0) {
      logger.info(`기존 활성 포지션 ${this.activePositions.size}개 자동 모니터링 시작`);
    }

    // 텔레그램 봇 초기화
    this.telegram.init();

    // 크론 스케줄 실행
    this.isRunning = true;
    cron.schedule(config.cronSchedule, () => this._tick());
    logger.info('봇 스케줄러 등록 완료. 대기 중...');

    // 즉시 1회 실행
    await this._tick();
  }

  /**
   * 메인 루프 (매 주기마다 실행) - 모든 유효 페어 순회
   */
  async _tick() {
    if (!this.isRunning) return;

    for (const pair of this.validPairs) {
      try {
        await this._tickPair(pair);
      } catch (err) {
        logger.error(`[${pair}] tick 에러: ${err.message}`);
      }
    }
  }

  /**
   * 페어 단위 틱 처리
   */
  async _tickPair(pair) {
    // 1. 기존 포지션 모니터링
    const active = this.activePositions.get(pair);
    if (active) {
      const result = await this.orderManager.monitorPosition(
        pair,
        active.sl,
        active.tp,
        active.direction
      );

      if (result.action === 'sl_hit' || result.action === 'tp_hit') {
        logger.info(`[${pair}] 포지션 종료: ${result.action} | PnL: ${result.pnl.toFixed(2)} USDT`);
        await this.telegram.notifyClose(pair, result.action, result.pnl, result.price);
        this.activePositions.delete(pair);
      } else if (result.action === 'holding') {
        return; // 포지션 유지 중 - 새 진입 안 함
      } else {
        // failed 등
        this.activePositions.delete(pair);
      }
    }

    // 2. 동시 포지션 상한 체크
    if (this.activePositions.size >= config.maxPositions) {
      logger.debug(`[${pair}] 동시 포지션 상한 도달 (${this.activePositions.size}/${config.maxPositions}) - 새 진입 스킵`);
      return;
    }

    // 3. 멀티 타임프레임 캔들 데이터 조회
    const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
      gateClient.getCandles(pair, config.timeframes.htf, 200),
      gateClient.getCandles(pair, config.timeframes.mtf, 200),
      gateClient.getCandles(pair, config.timeframes.ltf, 200),
    ]);

    if (!htfCandles || htfCandles.length < 50 ||
        !mtfCandles || mtfCandles.length < 50 ||
        !ltfCandles || ltfCandles.length < 50) {
      logger.warn(`[${pair}] 캔들 데이터 부족`);
      return;
    }

    // 4. ICT 멀티 타임프레임 전략 분석
    const signal = this.strategy.analyze({
      htf: htfCandles,
      mtf: mtfCandles,
      ltf: ltfCandles,
    });

    if (!signal.signal) {
      logger.debug(`[${pair}] 신호 없음: ${signal.reason}`);
      return;
    }

    // 5. 주문 실행
    const result = await this.orderManager.executeSignal(signal, pair);

    if (result.executed) {
      this.activePositions.set(pair, {
        direction: result.direction,
        sl: result.sl,
        tp: result.tp,
      });
      logger.info(`[${pair}] 포지션 진입 완료: ${result.direction} | SL: ${result.sl} | TP: ${result.tp}`);
      await this.telegram.notifyEntry(pair, signal, result);
    } else {
      logger.debug(`[${pair}] 주문 미실행: ${result.reason}`);
      if (result.reason === '일일 최대 손실 한도 도달') {
        await this.telegram.notifyDailyLossLimit(this.orderManager.dailyPnl);
      }
    }
  }

  /**
   * 봇 정지
   */
  async stop() {
    this.isRunning = false;
    logger.info('봇 정지 중...');

    if (this.activePositions.size > 0) {
      logger.warn(`활성 포지션 ${this.activePositions.size}개 존재 - 수동 청산 필요 가능`);
      for (const [pair, pos] of this.activePositions.entries()) {
        logger.warn(`  [${pair}] ${pos.direction}`);
      }
    }

    logger.info('봇 정지 완료');
  }
}

// --- 실행 ---
const bot = new TradingBot();

bot.start().catch((err) => {
  logger.error(`봇 시작 실패: ${err.message}`);
  process.exit(1);
});

// 프로세스 종료 시 정리
process.on('SIGINT', async () => {
  logger.info('SIGINT 수신 - 봇 종료');
  await bot.telegram.shutdown();
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM 수신 - 봇 종료');
  await bot.telegram.shutdown();
  await bot.stop();
  process.exit(0);
});

module.exports = TradingBot;
