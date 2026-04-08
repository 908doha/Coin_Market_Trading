const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const gateClient = require('../api/gateClient');
const indicators = require('../utils/indicators');
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
        const lev = pos.leverage || '-';

        const contractInfo = await gateClient.getContract(config.tradePair);
        const baseCoin = config.tradePair.split('_')[0];
        const coinAmount = Math.abs(pos.size) * Math.abs(contractInfo.quantoMultiplier);

        await this.bot.sendMessage(chatId, [
          `━━━ 포지션 정보 ━━━`,
          `방향: ${direction}`,
          `수량: ${coinAmount.toFixed(4)} ${baseCoin}`,
          `진입가: ${pos.entryPrice > 0 ? pos.entryPrice.toFixed(2) : '조회 중...'}`,
          `현재가: ${pos.markPrice > 0 ? pos.markPrice.toFixed(2) : '조회 중...'}`,
          `${pnlEmoji} 미실현 PnL: ${pos.unrealisedPnl.toFixed(2)} USDT`,
          `레버리지: x${lev}`,
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

    // /close - 포지션 청산 (SL/TP 조건부 주문도 함께 취소)
    this.bot.onText(/\/close/, async (msg) => {
      if (!auth(msg)) return;
      try {
        const result = await this.tradingBot.orderManager.closeAndCleanup(config.tradePair);
        if (result) {
          this.tradingBot.activePosition = null;
          await this.bot.sendMessage(chatId, '✅ 포지션 청산 + SL/TP 주문 취소 완료');
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

    // /analyze - ICT 전략 실시간 분석
    this.bot.onText(/\/analyze/, async (msg) => {
      if (!auth(msg)) return;
      await this.bot.sendMessage(chatId, '🔍 ICT v2 분석 중...');

      try {
        const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
          gateClient.getCandles(config.tradePair, config.timeframes.htf, 200),
          gateClient.getCandles(config.tradePair, config.timeframes.mtf, 200),
          gateClient.getCandles(config.tradePair, config.timeframes.ltf, 200),
        ]);

        const currentPrice = ltfCandles[ltfCandles.length - 1].close;
        const lines = [];
        lines.push(`━━━ ICT v2 분석: ${config.tradePair} ━━━`);
        lines.push(`💰 현재가: ${currentPrice.toFixed(2)}`);

        // 세션 상태
        const session = indicators.getActiveSession();
        lines.push(`⏰ ${session.active ? `✅ ${session.name}` : `❌ ${session.reason}`}`);
        lines.push('');

        // HTF
        lines.push(`📊 HTF (${config.timeframes.htf})`);
        const htfSH = indicators.findSwingHighs(htfCandles, config.ict.structureShiftBars);
        const htfSL = indicators.findSwingLows(htfCandles, config.ict.structureShiftBars);
        if (htfSH.length >= 2 && htfSL.length >= 2) {
          const lh = htfSH[htfSH.length - 1].price, ph = htfSH[htfSH.length - 2].price;
          const ll = htfSL[htfSL.length - 1].price, pl = htfSL[htfSL.length - 2].price;
          if (lh > ph && ll > pl) lines.push(`  ✅ BULLISH (HH+HL)`);
          else if (lh < ph && ll < pl) lines.push(`  ✅ BEARISH (LH+LL)`);
          else lines.push(`  ⚠️ 횡보`);
          lines.push(`  SH: ${lh.toFixed(2)} | SL: ${ll.toFixed(2)}`);
        }

        // PDH/PDL
        const pdhl = indicators.calculatePDHL(htfCandles);
        if (pdhl) {
          lines.push(`  PDH: ${pdhl.pdh.toFixed(2)} ${pdhl.pdhSweep ? '🔄 Sweep!' : ''}`);
          lines.push(`  PDL: ${pdhl.pdl.toFixed(2)} ${pdhl.pdlSweep ? '🔄 Sweep!' : ''}`);
        }
        lines.push('');

        // MTF
        lines.push(`📊 MTF (${config.timeframes.mtf})`);
        const mtfMss = (() => {
          const sh = indicators.findSwingHighs(mtfCandles, config.ict.structureShiftBars);
          const sl = indicators.findSwingLows(mtfCandles, config.ict.structureShiftBars);
          return (sh.length >= 2 && sl.length >= 2) ? indicators.detectMarketStructureShift(mtfCandles, sh, sl) : null;
        })();
        lines.push(`  MSS: ${mtfMss ? `✅ ${mtfMss.label.toUpperCase()}` : '❌ 없음'}`);

        const mtfOBs = indicators.findOrderBlocks(mtfCandles);
        lines.push(`  OB: Bull ${mtfOBs.bullish.length}개 / Bear ${mtfOBs.bearish.length}개`);

        const mtfFVGs = indicators.findFairValueGaps(mtfCandles);
        const mtfBullUnfilled = mtfFVGs.bullish.filter(f => !f.isFilled);
        const mtfBearUnfilled = mtfFVGs.bearish.filter(f => !f.isFilled);
        lines.push(`  FVG(미메움): Bull ${mtfBullUnfilled.length}개 / Bear ${mtfBearUnfilled.length}개`);
        if (mtfBullUnfilled.length > 0) {
          const f = mtfBullUnfilled[mtfBullUnfilled.length - 1];
          lines.push(`    └ CE: ${f.ce.toFixed(2)} (${f.fillPercent}% filled)`);
        }
        if (mtfBearUnfilled.length > 0) {
          const f = mtfBearUnfilled[mtfBearUnfilled.length - 1];
          lines.push(`    └ CE: ${f.ce.toFixed(2)} (${f.fillPercent}% filled)`);
        }
        lines.push('');

        // LTF
        lines.push(`📊 LTF (${config.timeframes.ltf})`);
        const ltfFVGs = indicators.findFairValueGaps(ltfCandles);
        const ltfBullCE = ltfFVGs.bullish.filter(f => !f.isFilled && f.atCE);
        const ltfBearCE = ltfFVGs.bearish.filter(f => !f.isFilled && f.atCE);
        lines.push(`  FVG CE 진입: Bull ${ltfBullCE.length}개 / Bear ${ltfBearCE.length}개`);

        const ltfBullFill = ltfFVGs.bullish.filter(f => !f.isFilled && f.inRange && f.fillPercent >= 50);
        const ltfBearFill = ltfFVGs.bearish.filter(f => !f.isFilled && f.inRange && f.fillPercent >= 50);
        lines.push(`  FVG Fill 진입: Bull ${ltfBullFill.length}개 / Bear ${ltfBearFill.length}개`);

        const iofeds = indicators.detectIOFED(ltfCandles);
        const recentIOFED = iofeds.filter(d => ltfCandles.length - d.index <= 5);
        lines.push(`  IOFED: ${recentIOFED.length > 0 ? `✅ ${recentIOFED.map(d => `${d.type}(${d.consecutiveBars}봉)`).join(', ')}` : '❌ 없음'}`);

        // Session Range
        const sRanges = indicators.calculateSessionRanges(ltfCandles);
        if (Object.keys(sRanges).length > 0) {
          lines.push('');
          lines.push('📏 Session Range');
          for (const [, sr] of Object.entries(sRanges)) {
            lines.push(`  ${sr.name}: ${sr.low.toFixed(2)} ~ ${sr.high.toFixed(2)} ${sr.highSweep || sr.lowSweep ? '🔄 Sweep!' : ''}`);
          }
        }

        lines.push('');

        // 종합 판단
        lines.push('📋 종합 판단');
        const signal = this.tradingBot.strategy.analyze({ htf: htfCandles, mtf: mtfCandles, ltf: ltfCandles });
        if (signal.signal) {
          const emoji = signal.signal === 'long' ? '📈' : '📉';
          lines.push(`  ${emoji} ${signal.signal.toUpperCase()} 신호!`);
          lines.push(`  진입: ${signal.entry} | SL: ${signal.sl} | TP: ${signal.tp}`);
          lines.push(`  컨플루언스 ${signal.confluence.length}개:`);
          signal.confluence.forEach(c => lines.push(`    • ${c}`));
        } else {
          lines.push(`  ⏸️ ${signal.reason}`);
          if (signal.confluence && signal.confluence.length > 0) {
            signal.confluence.forEach(c => lines.push(`    • ${c}`));
          }
        }

        await this.bot.sendMessage(chatId, lines.join('\n'));
      } catch (err) {
        await this.bot.sendMessage(chatId, `❌ 분석 실패: ${err.message}`);
        logger.error(`분석 실패: ${err.message}`);
      }
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
        `/analyze  - ICT 실시간 분석`,
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
    let qtyText = `${result.size} 계약`;
    try {
      const contractInfo = await gateClient.getContract(config.tradePair);
      const baseCoin = config.tradePair.split('_')[0];
      const coinAmount = Math.abs(result.size) * Math.abs(contractInfo.quantoMultiplier);
      qtyText = `${coinAmount.toFixed(4)} ${baseCoin}`;
    } catch (err) {
      logger.error(`수량 변환 실패: ${err.message}`);
    }
    await this.send([
      `${emoji} ━━━ 포지션 진입 ━━━`,
      `방향: ${signal.signal.toUpperCase()}`,
      `진입가: ${signal.entry}`,
      `손절(SL): ${signal.sl}`,
      `익절(TP): ${signal.tp}`,
      `수량: ${qtyText}`,
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
