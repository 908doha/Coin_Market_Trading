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
    this.activePosition = null; // { direction, sl, tp }
    this.isRunning = false;
  }

  /**
   * 봇 시작
   */
  async start() {
    logger.info('='.repeat(60));
    logger.info('Gate.io ICT Trading Bot 시작');
    logger.info(`거래쌍: ${config.tradePair}`);
    logger.info(`레버리지: x${config.leverage}`);
    logger.info(
      `포지션 사이징: Kelly (Half=${config.kelly.fraction}, Max=${(config.kelly.maxFraction * 100).toFixed(0)}%, Default=${(config.kelly.defaultFraction * 100).toFixed(1)}%, MinTrades=${config.kelly.minTrades})`
    );
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

    // 기존 포지션 확인
    try {
      const position = await gateClient.getPosition(config.tradePair);
      if (position && position.size !== 0) {
        logger.info(`기존 포지션 감지: size=${position.size} entry=${position.entryPrice}`);
      }
    } catch {
      // 포지션 없음
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
   * 메인 루프 (매 주기마다 실행)
   */
  async _tick() {
    if (!this.isRunning) return;

    try {
      // 1. 기존 포지션 모니터링
      if (this.activePosition) {
        const result = await this.orderManager.monitorPosition(
          config.tradePair,
          this.activePosition.sl,
          this.activePosition.tp,
          this.activePosition.direction
        );

        if (result.action === 'sl_hit' || result.action === 'tp_hit') {
          logger.info(`포지션 종료: ${result.action} | PnL: ${result.pnl.toFixed(2)} USDT`);
          await this.telegram.notifyClose(result.action, result.pnl, result.price);
          this.activePosition = null;
        } else if (result.action === 'holding') {
          // 포지션 유지 중 - 새 진입 불가
          return;
        } else {
          // 포지션 없음으로 변경
          this.activePosition = null;
        }
      }

      // 2. 멀티 타임프레임 캔들 데이터 조회 (HTF, MTF, LTF 동시)
      const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
        gateClient.getCandles(config.tradePair, config.timeframes.htf, 200),
        gateClient.getCandles(config.tradePair, config.timeframes.mtf, 200),
        gateClient.getCandles(config.tradePair, config.timeframes.ltf, 200),
      ]);

      if (!htfCandles || htfCandles.length < 50 ||
          !mtfCandles || mtfCandles.length < 50 ||
          !ltfCandles || ltfCandles.length < 50) {
        logger.warn('캔들 데이터 부족');
        return;
      }

      // 3. ICT 멀티 타임프레임 전략 분석
      const signal = this.strategy.analyze({
        htf: htfCandles,
        mtf: mtfCandles,
        ltf: ltfCandles,
      });

      if (!signal.signal) {
        logger.debug(`신호 없음: ${signal.reason}`);
        return;
      }

      // 4. 주문 실행
      const result = await this.orderManager.executeSignal(signal);

      if (result.executed) {
        this.activePosition = {
          direction: result.direction,
          sl: result.sl,
          tp: result.tp,
        };
        logger.info(`포지션 진입 완료: ${result.direction} | SL: ${result.sl} | TP: ${result.tp}`);
        await this.telegram.notifyEntry(signal, result);
      } else {
        logger.debug(`주문 미실행: ${result.reason}`);
        if (result.reason === '일일 최대 손실 한도 도달') {
          await this.telegram.notifyDailyLossLimit(this.orderManager.dailyPnl);
        }
      }
    } catch (err) {
      logger.error(`틱 오류: ${err.message}`);
      await this.telegram.notifyError(err.message);
    }
  }

  /**
   * 봇 정지
   */
  async stop() {
    this.isRunning = false;
    logger.info('봇 정지 중...');

    // 포지션 청산 여부는 사용자 판단에 맡김
    if (this.activePosition) {
      logger.warn(`활성 포지션이 있습니다: ${this.activePosition.direction}`);
      logger.warn('수동으로 청산이 필요할 수 있습니다.');
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
