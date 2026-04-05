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
      await this.bot.sendMessage(chatId, '🔍 ICT 분석 중...');

      try {
        // 3개 타임프레임 캔들 조회
        const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
          gateClient.getCandles(config.tradePair, config.timeframes.htf, 200),
          gateClient.getCandles(config.tradePair, config.timeframes.mtf, 200),
          gateClient.getCandles(config.tradePair, config.timeframes.ltf, 200),
        ]);

        const currentPrice = ltfCandles[ltfCandles.length - 1].close;
        const lines = [];
        lines.push(`━━━ ICT 분석: ${config.tradePair} ━━━`);
        lines.push(`💰 현재가: ${currentPrice.toFixed(2)}`);
        lines.push('');

        // ========== HTF 분석 ==========
        const htfSwingHighs = indicators.findSwingHighs(htfCandles, config.ict.structureShiftBars);
        const htfSwingLows = indicators.findSwingLows(htfCandles, config.ict.structureShiftBars);
        let htfDirection = null;

        lines.push(`📊 HTF (${config.timeframes.htf}) 방향 판단`);

        if (htfSwingHighs.length >= 2 && htfSwingLows.length >= 2) {
          const lastHigh = htfSwingHighs[htfSwingHighs.length - 1].price;
          const prevHigh = htfSwingHighs[htfSwingHighs.length - 2].price;
          const lastLow = htfSwingLows[htfSwingLows.length - 1].price;
          const prevLow = htfSwingLows[htfSwingLows.length - 2].price;

          const hh = lastHigh > prevHigh;
          const hl = lastLow > prevLow;
          const lh = lastHigh < prevHigh;
          const ll = lastLow < prevLow;

          if (hh && hl) {
            htfDirection = 'bullish';
            lines.push(`  ✅ BULLISH (HH + HL)`);
          } else if (lh && ll) {
            htfDirection = 'bearish';
            lines.push(`  ✅ BEARISH (LH + LL)`);
          } else {
            const mss = indicators.detectMarketStructureShift(htfCandles, htfSwingHighs, htfSwingLows);
            if (mss) {
              htfDirection = mss;
              lines.push(`  ✅ ${mss.toUpperCase()} (MSS 감지)`);
            } else {
              lines.push(`  ⚠️ 방향 불명확 (횡보)`);
            }
          }

          lines.push(`  스윙 하이: ${lastHigh.toFixed(2)} (이전: ${prevHigh.toFixed(2)})`);
          lines.push(`  스윙 로우: ${lastLow.toFixed(2)} (이전: ${prevLow.toFixed(2)})`);
        } else {
          lines.push(`  ⚠️ 스윙 포인트 부족`);
        }

        lines.push('');

        // ========== MTF 분석 ==========
        lines.push(`📊 MTF (${config.timeframes.mtf}) 구조 확인`);

        const mtfSwingHighs = indicators.findSwingHighs(mtfCandles, config.ict.structureShiftBars);
        const mtfSwingLows = indicators.findSwingLows(mtfCandles, config.ict.structureShiftBars);

        // MSS
        const mtfMss = (mtfSwingHighs.length >= 2 && mtfSwingLows.length >= 2)
          ? indicators.detectMarketStructureShift(mtfCandles, mtfSwingHighs, mtfSwingLows)
          : null;
        lines.push(`  MSS: ${mtfMss ? `✅ ${mtfMss.toUpperCase()}` : '❌ 없음'}`);

        // Order Block
        const mtfOBs = indicators.findOrderBlocks(mtfCandles);
        lines.push(`  Bullish OB: ${mtfOBs.bullish.length}개`);
        if (mtfOBs.bullish.length > 0) {
          const ob = mtfOBs.bullish[mtfOBs.bullish.length - 1];
          lines.push(`    └ 최근: ${ob.low.toFixed(2)} ~ ${ob.high.toFixed(2)}`);
        }
        lines.push(`  Bearish OB: ${mtfOBs.bearish.length}개`);
        if (mtfOBs.bearish.length > 0) {
          const ob = mtfOBs.bearish[mtfOBs.bearish.length - 1];
          lines.push(`    └ 최근: ${ob.low.toFixed(2)} ~ ${ob.high.toFixed(2)}`);
        }

        // FVG
        const mtfFVGs = indicators.findFairValueGaps(mtfCandles);
        lines.push(`  Bullish FVG: ${mtfFVGs.bullish.length}개`);
        if (mtfFVGs.bullish.length > 0) {
          const fvg = mtfFVGs.bullish[mtfFVGs.bullish.length - 1];
          lines.push(`    └ 최근: ${fvg.bottom.toFixed(2)} ~ ${fvg.top.toFixed(2)}`);
        }
        lines.push(`  Bearish FVG: ${mtfFVGs.bearish.length}개`);
        if (mtfFVGs.bearish.length > 0) {
          const fvg = mtfFVGs.bearish[mtfFVGs.bearish.length - 1];
          lines.push(`    └ 최근: ${fvg.bottom.toFixed(2)} ~ ${fvg.top.toFixed(2)}`);
        }

        lines.push('');

        // ========== LTF 분석 ==========
        lines.push(`📊 LTF (${config.timeframes.ltf}) 진입 조건`);

        // Kill Zone
        const killZone = indicators.isInKillZone();
        lines.push(`  Kill Zone: ${killZone.active ? `✅ ${killZone.zone}` : '❌ 비활성'}`);

        // LTF 스윙
        const ltfSwingHighs = indicators.findSwingHighs(ltfCandles, config.ict.structureShiftBars);
        const ltfSwingLows = indicators.findSwingLows(ltfCandles, config.ict.structureShiftBars);

        // Liquidity Sweep
        const sweeps = (ltfSwingHighs.length >= 1 && ltfSwingLows.length >= 1)
          ? indicators.detectLiquiditySweep(ltfCandles, ltfSwingHighs, ltfSwingLows)
          : [];
        lines.push(`  Liquidity Sweep: ${sweeps.length > 0 ? `✅ ${sweeps.map(s => `${s.type} @ ${s.level.toFixed(2)}`).join(', ')}` : '❌ 없음'}`);

        // OTE
        if (ltfSwingHighs.length >= 1 && ltfSwingLows.length >= 1) {
          const recentHigh = ltfSwingHighs[ltfSwingHighs.length - 1].price;
          const recentLow = ltfSwingLows[ltfSwingLows.length - 1].price;
          const ote = indicators.calculateOTE(recentHigh, recentLow);

          const inBullishOTE = currentPrice >= ote.bullish.lower && currentPrice <= ote.bullish.upper;
          const inBearishOTE = currentPrice >= ote.bearish.lower && currentPrice <= ote.bearish.upper;

          lines.push(`  Bullish OTE: ${ote.bullish.lower.toFixed(2)} ~ ${ote.bullish.upper.toFixed(2)} ${inBullishOTE ? '✅ 구간 내' : ''}`);
          lines.push(`  Bearish OTE: ${ote.bearish.lower.toFixed(2)} ~ ${ote.bearish.upper.toFixed(2)} ${inBearishOTE ? '✅ 구간 내' : ''}`);
        }

        // LTF MSS
        const ltfMss = (ltfSwingHighs.length >= 2 && ltfSwingLows.length >= 2)
          ? indicators.detectMarketStructureShift(ltfCandles, ltfSwingHighs, ltfSwingLows)
          : null;
        lines.push(`  LTF MSS: ${ltfMss ? `✅ ${ltfMss.toUpperCase()}` : '❌ 없음'}`);

        // LTF FVG
        const ltfFVGs = indicators.findFairValueGaps(ltfCandles);
        const inBullishFVG = ltfFVGs.bullish.find(f => currentPrice >= f.bottom && currentPrice <= f.top);
        const inBearishFVG = ltfFVGs.bearish.find(f => currentPrice >= f.bottom && currentPrice <= f.top);
        lines.push(`  LTF FVG: Bullish ${ltfFVGs.bullish.length}개${inBullishFVG ? ' ✅ 구간 내' : ''} / Bearish ${ltfFVGs.bearish.length}개${inBearishFVG ? ' ✅ 구간 내' : ''}`);

        lines.push('');

        // ========== 종합 판단 ==========
        lines.push('📋 종합 판단');
        const signal = this.tradingBot.strategy.analyze({ htf: htfCandles, mtf: mtfCandles, ltf: ltfCandles });

        if (signal.signal) {
          const emoji = signal.signal === 'long' ? '📈' : '📉';
          lines.push(`  ${emoji} ${signal.signal.toUpperCase()} 신호 발생!`);
          lines.push(`  진입가: ${signal.entry}`);
          lines.push(`  SL: ${signal.sl} | TP: ${signal.tp}`);
          lines.push(`  컨플루언스: ${signal.confluence.length}개`);
          signal.confluence.forEach(c => lines.push(`    • ${c}`));
        } else {
          lines.push(`  ⏸️ 신호 없음`);
          lines.push(`  사유: ${signal.reason}`);
          if (signal.confluence && signal.confluence.length > 0) {
            lines.push(`  충족된 조건:`);
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
