const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const gateClient = require('../api/gateClient');
const logger = require('../utils/logger');

/**
 * 텔레그램 봇 서비스
 *
 * 알림 기능:
 *  - 포지션 진입/청산 알림
 *  - SL/TP 도달 알림
 *  - 일일 손실 한도 알림
 *  - 에러 알림
 *
 * 명령어:
 *  /status   - 봇 상태 조회
 *  /position - 현재 포지션 조회
 *  /balance  - 잔고 조회
 *  /pnl      - 오늘 손익 조회
 *  /close    - 현재 포지션 청산
 *  /stop     - 봇 정지
 *  /start    - 봇 재개
 *  /help     - 명령어 목록
 */
class TelegramService {
  constructor(tradingBot) {
    this.bot = null;
    this.tradingBot = tradingBot;
    this.enabled = false;
  }

  /**
   * 텔레그램 봇 초기화
   */
  init() {
    if (!config.telegramToken || !config.telegramChatId) {
      logger.info('텔레그램 설정 없음 - 알림 비활성화');
      return;
    }

    this.bot = new TelegramBot(config.telegramToken, { polling: true });
    this.enabled = true;
    this._registerCommands();
    logger.info('텔레그램 봇 연결 완료');
    this.send('🟢 ICT Trading Bot 시작됨');
  }

  /**
   * 명령어 등록
   */
  _registerCommands() {
    const chatId = config.telegramChatId;

    // 인증 체크 (등록된 chat ID만 허용)
    const auth = (msg) => {
      if (msg.chat.id.toString() !== chatId) {
        this.bot.sendMessage(msg.chat.id, '⛔ 권한 없음');
        return false;
      }
      return true;
    };

    // /status - 봇 상태
    this.bot.onText(/\/status/, async (msg) => {
      if (!auth(msg)) return;
      const running = this.tradingBot.isRunning ? '🟢 실행 중' : '🔴 정지됨';
      const pos = this.tradingBot.activePosition;
      const posText = pos
        ? `📊 ${pos.direction.toUpperCase()} | SL: ${pos.sl} | TP: ${pos.tp}`
        : '📊 포지션 없음';

      await this.bot.sendMessage(chatId, [
        `━━━ 봇 상태 ━━━`,
        running,
        `거래쌍: ${config.tradePair}`,
        `레버리지: x${config.leverage}`,
        `타임프레임: ${config.timeframes.htf}/${config.timeframes.mtf}/${config.timeframes.ltf}`,
        posText,
      ].join('\n'));
    });

    // /position - 포지션 상세
    this.bot.onText(/\/position/, async (msg) => {
      if (!auth(msg)) return;
      try {
        const pos = await gateClient.getPosition(config.tradePair);
        if (!pos || pos.size === 0) {
          await this.bot.sendMessage(chatId, '📊 현재 열린 포지션 없음');
          return;
        }

        const direction = pos.size > 0 ? 'LONG 📈' : 'SHORT 📉';
        const pnlEmoji = pos.unrealisedPnl >= 0 ? '🟢' : '🔴';

        await this.bot.sendMessage(chatId, [
          `━━━ 포지션 정보 ━━━`,
          `방향: ${direction}`,
          `수량: ${Math.abs(pos.size)} 계약`,
          `진입가: ${pos.entryPrice}`,
          `현재가: ${pos.markPrice}`,
          `${pnlEmoji} 미실현 PnL: ${pos.unrealisedPnl.toFixed(2)} USDT`,
          `레버리지: x${pos.leverage}`,
        ].join('\n'));
      } catch (err) {
        await this.bot.sendMessage(chatId, `❌ 포지션 조회 실패: ${err.message}`);
      }
    });

    // /balance - 잔고 조회
    this.bot.onText(/\/balance/, async (msg) => {
      if (!auth(msg)) return;
      try {
        const bal = await gateClient.getBalance();
        await this.bot.sendMessage(chatId, [
          `━━━ 잔고 정보 ━━━`,
          `💰 총 잔고: ${bal.total.toFixed(2)} USDT`,
          `✅ 가용 잔고: ${bal.available.toFixed(2)} USDT`,
          `📊 미실현 PnL: ${bal.unrealisedPnl.toFixed(2)} USDT`,
        ].join('\n'));
      } catch (err) {
        await this.bot.sendMessage(chatId, `❌ 잔고 조회 실패: ${err.message}`);
      }
    });

    // /pnl - 오늘 손익
    this.bot.onText(/\/pnl/, async (msg) => {
      if (!auth(msg)) return;
      const om = this.tradingBot.orderManager;
      const pnlEmoji = om.dailyPnl >= 0 ? '🟢' : '🔴';
      const limitPct = ((Math.abs(om.dailyPnl) / config.maxDailyLossUsdt) * 100).toFixed(1);

      await this.bot.sendMessage(chatId, [
        `━━━ 오늘 손익 ━━━`,
        `${pnlEmoji} 일일 PnL: ${om.dailyPnl.toFixed(2)} USDT`,
        `📊 일일 손실 한도: ${config.maxDailyLossUsdt} USDT`,
        `⚠️ 한도 사용: ${limitPct}%`,
      ].join('\n'));
    });

    // /close - 포지션 청산
    this.bot.onText(/\/close/, async (msg) => {
      if (!auth(msg)) return;
      try {
        const result = await gateClient.closePosition(config.tradePair);
        if (result) {
          this.tradingBot.activePosition = null;
          await this.bot.sendMessage(chatId, '✅ 포지션 청산 완료');
        } else {
          await this.bot.sendMessage(chatId, '📊 청산할 포지션 없음');
        }
      } catch (err) {
        await this.bot.sendMessage(chatId, `❌ 청산 실패: ${err.message}`);
      }
    });

    // /stop - 봇 정지
    this.bot.onText(/\/stop/, async (msg) => {
      if (!auth(msg)) return;
      this.tradingBot.isRunning = false;
      await this.bot.sendMessage(chatId, '🔴 봇 정지됨 (포지션은 유지됨)');
    });

    // /start - 봇 재개
    this.bot.onText(/\/start/, async (msg) => {
      if (!auth(msg)) return;
      this.tradingBot.isRunning = true;
      await this.bot.sendMessage(chatId, '🟢 봇 재개됨');
    });

    // /help - 명령어 목록
    this.bot.onText(/\/help/, async (msg) => {
      if (!auth(msg)) return;
      await this.bot.sendMessage(chatId, [
        `━━━ 명령어 목록 ━━━`,
        `/status   - 봇 상태 조회`,
        `/position - 현재 포지션 상세`,
        `/balance  - 잔고 조회`,
        `/pnl      - 오늘 손익 조회`,
        `/close    - 현재 포지션 청산`,
        `/stop     - 봇 정지`,
        `/start    - 봇 재개`,
        `/help     - 명령어 목록`,
      ].join('\n'));
    });
  }

  /**
   * 메시지 발송
   */
  async send(message) {
    if (!this.enabled) return;
    try {
      await this.bot.sendMessage(config.telegramChatId, message);
    } catch (err) {
      logger.error(`텔레그램 전송 실패: ${err.message}`);
    }
  }

  /**
   * 포지션 진입 알림
   */
  async notifyEntry(signal, result) {
    const emoji = signal.signal === 'long' ? '📈' : '📉';
    await this.send([
      `${emoji} ━━━ 포지션 진입 ━━━`,
      `방향: ${signal.signal.toUpperCase()}`,
      `진입가: ${signal.entry}`,
      `손절(SL): ${signal.sl}`,
      `익절(TP): ${signal.tp}`,
      `수량: ${result.size} 계약`,
      ``,
      `📋 컨플루언스:`,
      ...signal.confluence.map((c) => `  • ${c}`),
      ``,
      `💡 ${signal.reason}`,
    ].join('\n'));
  }

  /**
   * 포지션 청산 알림
   */
  async notifyClose(action, pnl, price) {
    const emoji = action === 'tp_hit' ? '🎯' : '🛑';
    const label = action === 'tp_hit' ? '익절' : '손절';
    const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';

    await this.send([
      `${emoji} ━━━ ${label} 청산 ━━━`,
      `청산가: ${price}`,
      `${pnlEmoji} PnL: ${pnl.toFixed(2)} USDT`,
    ].join('\n'));
  }

  /**
   * 일일 손실 한도 알림
   */
  async notifyDailyLossLimit(dailyPnl) {
    await this.send([
      `🚨 ━━━ 일일 손실 한도 도달 ━━━`,
      `일일 PnL: ${dailyPnl.toFixed(2)} USDT`,
      `한도: -${config.maxDailyLossUsdt} USDT`,
      `⚠️ 오늘 매매가 자동 중단됩니다.`,
    ].join('\n'));
  }

  /**
   * 에러 알림
   */
  async notifyError(error) {
    await this.send(`❌ 오류 발생: ${error}`);
  }

  /**
   * 봇 종료 시 정리
   */
  async shutdown() {
    if (!this.enabled) return;
    await this.send('🔴 ICT Trading Bot 종료됨');
    this.bot.stopPolling();
  }
}

module.exports = TelegramService;
