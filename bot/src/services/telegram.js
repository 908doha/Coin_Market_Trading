const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const gateClient = require('../api/gateClient');
const indicators = require('../utils/indicators');
const logger = require('../utils/logger');

/**
 * 텔레그램 봇 서비스 (멀티 페어)
 *
 * 명령어:
 *  /status            - 봇 상태 + 모든 활성 포지션 요약
 *  /pairs             - 현재 유효 페어 리스트
 *  /position          - 모든 활성 포지션 요약
 *  /position BTC      - 특정 페어 상세
 *  /balance           - 잔고 조회
 *  /pnl               - 오늘 손익 조회 (전체 + 페어별 Kelly 통계)
 *  /analyze           - 모든 페어 요약
 *  /analyze BTC       - 특정 페어 상세 분석
 *  /close BTC         - 특정 페어 청산
 *  /close all         - 모든 페어 청산
 *  /stop, /start, /help
 */
class TelegramService {
  constructor(tradingBot) {
    this.bot = null;
    this.tradingBot = tradingBot;
    this.enabled = false;
  }

  init() {
    if (!config.telegramToken || !config.telegramChatId) {
      logger.info('텔레그램 설정 없음 - 알림 비활성화');
      return;
    }

    this.bot = new TelegramBot(config.telegramToken, { polling: true });
    this.enabled = true;

    // 폴링 에러 rate-limited 핸들러 (B)
    // node-telegram-bot-api 가 자동 재시도하므로 로그 스팸만 막음
    this._lastPollErrorAt = 0;
    this.bot.on('polling_error', (err) => {
      const now = Date.now();
      if (now - this._lastPollErrorAt > 60000) {
        logger.warn(`텔레그램 폴링 에러 (자동 재시도): ${err.code || err.message}`);
        this._lastPollErrorAt = now;
      }
    });

    this._registerCommands();
    logger.info('텔레그램 봇 연결 완료');
    this.send('🟢 ICT Trading Bot 시작됨 (Multi-Pair)');
  }

  /**
   * 사용자가 입력한 심볼을 유효 페어로 해석
   *   예: "BTC" → "BTC_USDT", "btc_usdt" → "BTC_USDT"
   */
  _resolvePair(input) {
    if (!input) return null;
    const up = input.toUpperCase().trim();
    const pairs = this.tradingBot.validPairs;
    // 완전 일치
    if (pairs.includes(up)) return up;
    // 기본 심볼 매칭 (BTC → BTC_USDT)
    const withSuffix = up.includes('_') ? up : `${up}_USDT`;
    if (pairs.includes(withSuffix)) return withSuffix;
    return null;
  }

  /** 선물 표기용 디스플레이 이름: ETH_USDT → ETH.P */
  _displayName(pair) {
    return pair.split('_')[0] + '.P';
  }

  /**
   * SL/TP 표시용 값 해석
   *  - bot.activePositions.sl/tp 우선 (신규 진입 시 전략 계산값)
   *  - 없으면 orderManager.slPrices/tpPrices (Phase B/C 에서 감지/저장한 실제 값)
   *  - 둘 다 없으면 null (호출부에서 '(수동)' 등으로 표기)
   */
  _resolveSLTP(pair, active) {
    const om = this.tradingBot && this.tradingBot.orderManager;
    const activeSl = active && active.sl != null ? active.sl : null;
    const activeTp = active && active.tp != null ? active.tp : null;
    const storedSl = om ? om.slPrices.get(pair) : null;
    const storedTp = om ? om.tpPrices.get(pair) : null;
    return {
      sl: activeSl != null ? activeSl : (storedSl != null ? storedSl : null),
      tp: activeTp != null ? activeTp : (storedTp != null ? storedTp : null),
    };
  }

  _registerCommands() {
    const chatId = config.telegramChatId;

    const auth = (msg) => {
      if (msg.chat.id.toString() !== chatId) {
        this.bot.sendMessage(msg.chat.id, '⛔ 권한 없음');
        return false;
      }
      return true;
    };

    // /status - 봇 상태
    this.bot.onText(/^\/status/, async (msg) => {
      if (!auth(msg)) return;
      try {
        const running = this.tradingBot.isRunning ? '🟢 실행 중' : '🔴 정지됨';
        const activePositions = this.tradingBot.activePositions;

        const lines = [
          `━━━ 봇 상태 ━━━`,
          running,
          `거래 페어: ${this.tradingBot.validPairs.map((p) => this._displayName(p)).join(', ')}`,
          `레버리지: x${config.leverage}`,
          `타임프레임: ${config.timeframes.htf}/${config.timeframes.mtf}/${config.timeframes.ltf}`,
          `활성 포지션: ${activePositions.size}/${config.maxPositions}`,
        ];

        if (activePositions.size > 0) {
          for (const [pair, pos] of activePositions.entries()) {
            const { sl, tp } = this._resolveSLTP(pair, pos);
            const slTp = (sl != null && tp != null)
              ? `SL: ${sl} / TP: ${tp}`
              : '(수동 SL/TP 또는 미등록)';
            lines.push(`  • [${this._displayName(pair)}] ${pos.direction.toUpperCase()} ${slTp}`);
          }
        }

        await this.send(lines.join('\n'));
      } catch (err) {
        logger.error(`/status 핸들러 오류: ${err.message}`);
      }
    });

    // /pairs - 유효 페어 목록
    this.bot.onText(/^\/pairs/, async (msg) => {
      if (!auth(msg)) return;
      try {
        const lines = [`━━━ 거래 페어 ━━━`];
        for (const p of this.tradingBot.validPairs) {
          const active = this.tradingBot.activePositions.has(p);
          lines.push(`${active ? '🟢' : '⚪'} ${this._displayName(p)}`);
        }
        await this.send(lines.join('\n'));
      } catch (err) {
        logger.error(`/pairs 핸들러 오류: ${err.message}`);
      }
    });

    // /position - 포지션 (전체 요약 또는 특정 페어 상세)
    this.bot.onText(/^\/position(?:\s+(\S+))?/, async (msg, match) => {
      if (!auth(msg)) return;
      const arg = match && match[1];

      if (!arg) {
        // 전체 요약
        const activePositions = this.tradingBot.activePositions;
        if (activePositions.size === 0) {
          await this.bot.sendMessage(chatId, '📊 현재 열린 포지션 없음');
          return;
        }

        const lines = [`━━━ 활성 포지션 (${activePositions.size}) ━━━`];
        for (const [pair, active] of activePositions.entries()) {
          try {
            const pos = await gateClient.getPosition(pair);
            if (!pos || pos.size === 0) continue;
            const dirEmoji = pos.size > 0 ? '📈' : '📉';
            const dirText = pos.size > 0 ? 'LONG' : 'SHORT';
            const dn = this._displayName(pair);
            const contractInfo = await gateClient.getContract(pair);
            const baseCoin = pair.split('_')[0];
            const coinAmount = Math.abs(pos.size) * Math.abs(contractInfo.quantoMultiplier);
            const { sl, tp } = this._resolveSLTP(pair, active);
            const slText = sl != null ? sl : '(수동)';
            const tpText = tp != null ? tp : '(수동)';
            const pnlSign = pos.unrealisedPnl >= 0 ? '+' : '';

            lines.push('');
            lines.push(`${dirEmoji} [${dn}]`);
            lines.push(`  방향: ${dirText}`);
            lines.push(`  수량: ${coinAmount.toFixed(4)} ${baseCoin}`);
            lines.push(`  진입가: ${pos.entryPrice > 0 ? pos.entryPrice.toFixed(2) : '-'}`);
            lines.push(`  SL: ${slText} | TP: ${tpText}`);
            lines.push(`  PnL: ${pnlSign}${pos.unrealisedPnl.toFixed(2)} USDT`);
          } catch (err) {
            lines.push(`\n[${this._displayName(pair)}] ❌ ${err.message}`);
          }
        }
        await this.bot.sendMessage(chatId, lines.join('\n'));
        return;
      }

      // 특정 페어 상세
      const pair = this._resolvePair(arg);
      if (!pair) {
        await this.bot.sendMessage(chatId, `❌ 유효하지 않은 페어: ${arg}`);
        return;
      }

      try {
        const pos = await gateClient.getPosition(pair);
        if (!pos || pos.size === 0) {
          await this.bot.sendMessage(chatId, `📊 [${this._displayName(pair)}] 열린 포지션 없음`);
          return;
        }

        const dirEmoji = pos.size > 0 ? '📈' : '📉';
        const dirText = pos.size > 0 ? 'LONG' : 'SHORT';
        const dn = this._displayName(pair);
        const lev = pos.leverage || '-';
        const contractInfo = await gateClient.getContract(pair);
        const baseCoin = pair.split('_')[0];
        const coinAmount = Math.abs(pos.size) * Math.abs(contractInfo.quantoMultiplier);
        const active = this.tradingBot.activePositions.get(pair);
        const { sl, tp } = this._resolveSLTP(pair, active);
        const slText = sl != null ? sl : '(수동)';
        const tpText = tp != null ? tp : '(수동)';
        const pnlSign = pos.unrealisedPnl >= 0 ? '+' : '';

        await this.bot.sendMessage(chatId, [
          `━━━ [${dn}] 포지션 정보 ━━━`,
          `${dirEmoji} 방향: ${dirText}`,
          `수량: ${coinAmount.toFixed(4)} ${baseCoin}`,
          `진입가: ${pos.entryPrice > 0 ? pos.entryPrice.toFixed(2) : '-'}`,
          `현재가: ${pos.markPrice > 0 ? pos.markPrice.toFixed(2) : '-'}`,
          `SL: ${slText} | TP: ${tpText}`,
          `PnL: ${pnlSign}${pos.unrealisedPnl.toFixed(2)} USDT`,
          `레버리지: x${lev}`,
        ].join('\n'));
      } catch (err) {
        await this.bot.sendMessage(chatId, `❌ 포지션 조회 실패: ${err.message}`);
      }
    });

    // /balance
    this.bot.onText(/^\/balance/, async (msg) => {
      if (!auth(msg)) return;
      try {
        const bal = await gateClient.getBalance();
        const totalExposure = this.tradingBot.orderManager.getTotalOpenExposure();
        const maxTotal = bal.total * config.kelly.maxTotalExposure;
        await this.bot.sendMessage(chatId, [
          `━━━ 잔고 정보 ━━━`,
          `💰 총 잔고: ${bal.total.toFixed(2)} USDT`,
          `✅ 가용 잔고: ${bal.available.toFixed(2)} USDT`,
          `📊 미실현 PnL: ${bal.unrealisedPnl.toFixed(2)} USDT`,
          `📈 총 노출: ${totalExposure.toFixed(2)} / ${maxTotal.toFixed(2)} USDT (${((totalExposure / maxTotal) * 100 || 0).toFixed(1)}%)`,
        ].join('\n'));
      } catch (err) {
        await this.bot.sendMessage(chatId, `❌ 잔고 조회 실패: ${err.message}`);
      }
    });

    // /pnl
    this.bot.onText(/^\/pnl/, async (msg) => {
      if (!auth(msg)) return;
      try {
        const om = this.tradingBot.orderManager;
        const pnlEmoji = om.dailyPnl >= 0 ? '🟢' : '🔴';
        const limitPct = ((Math.abs(om.dailyPnl) / config.maxDailyLossUsdt) * 100).toFixed(1);

        const lines = [
          `━━━ 오늘 손익 ━━━`,
          `${pnlEmoji} 일일 PnL: ${om.dailyPnl.toFixed(2)} USDT`,
          `📊 일일 손실 한도: ${config.maxDailyLossUsdt} USDT`,
          `⚠️ 한도 사용: ${limitPct}%`,
          ``,
          `━━━ 페어별 Kelly 통계 ━━━`,
        ];

        for (const pair of this.tradingBot.validPairs) {
          const s = om._getStats(pair);
          const total = s.wins + s.losses;
          const f = om.calculateKellyFraction(pair);
          const winRate = total > 0 ? ((s.wins / total) * 100).toFixed(0) : '-';
          lines.push(
            `[${this._displayName(pair)}] W:${s.wins}/L:${s.losses} (승률 ${winRate}%) | f*=${(f * 100).toFixed(2)}%`
          );
        }

        await this.send(lines.join('\n'));
      } catch (err) {
        logger.error(`/pnl 핸들러 오류: ${err.message}`);
      }
    });

    // /close — 청산 (페어 필수, 또는 all)
    this.bot.onText(/^\/close(?:\s+(\S+))?/, async (msg, match) => {
      if (!auth(msg)) return;
      const arg = match && match[1];

      if (!arg) {
        await this.bot.sendMessage(chatId, [
          '❓ 청산할 페어를 지정해주세요',
          '예: /close BTC 또는 /close all',
          `현재 활성: ${[...this.tradingBot.activePositions.keys()].join(', ') || '없음'}`,
        ].join('\n'));
        return;
      }

      const targets = [];
      if (arg.toLowerCase() === 'all') {
        targets.push(...this.tradingBot.activePositions.keys());
        if (targets.length === 0) {
          await this.bot.sendMessage(chatId, '📊 청산할 활성 포지션 없음');
          return;
        }
      } else {
        const pair = this._resolvePair(arg);
        if (!pair) {
          await this.bot.sendMessage(chatId, `❌ 유효하지 않은 페어: ${arg}`);
          return;
        }
        targets.push(pair);
      }

      const results = [];
      for (const pair of targets) {
        try {
          const result = await this.tradingBot.orderManager.closeAndCleanup(pair);
          if (result) {
            this.tradingBot.activePositions.delete(pair);
            results.push(`✅ [${this._displayName(pair)}] 청산 완료`);
          } else {
            results.push(`📊 [${this._displayName(pair)}] 청산할 포지션 없음`);
          }
        } catch (err) {
          results.push(`❌ [${this._displayName(pair)}] 청산 실패: ${err.message}`);
        }
      }
      await this.bot.sendMessage(chatId, results.join('\n'));
    });

    // /stop
    this.bot.onText(/^\/stop/, async (msg) => {
      if (!auth(msg)) return;
      try {
        this.tradingBot.isRunning = false;
        await this.send('🔴 봇 정지됨 (포지션은 유지됨)');
      } catch (err) {
        logger.error(`/stop 핸들러 오류: ${err.message}`);
      }
    });

    // /start
    this.bot.onText(/^\/start/, async (msg) => {
      if (!auth(msg)) return;
      try {
        this.tradingBot.isRunning = true;
        await this.send('🟢 봇 재개됨');
      } catch (err) {
        logger.error(`/start 핸들러 오류: ${err.message}`);
      }
    });

    // /analyze - 전체 요약 또는 특정 페어 상세
    this.bot.onText(/^\/analyze(?:\s+(\S+))?/, async (msg, match) => {
      if (!auth(msg)) return;
      const arg = match && match[1];

      if (!arg) {
        // 전체 요약
        await this.bot.sendMessage(chatId, '🔍 모든 페어 분석 중...');
        const lines = [`━━━ ICT v2 전체 분석 ━━━`];
        for (const pair of this.tradingBot.validPairs) {
          try {
            const summary = await this._analyzePairSummary(pair);
            lines.push(summary);
          } catch (err) {
            lines.push(`[${this._displayName(pair)}] ❌ ${err.message}`);
          }
        }
        await this.bot.sendMessage(chatId, lines.join('\n'));
        return;
      }

      // 특정 페어 상세
      const pair = this._resolvePair(arg);
      if (!pair) {
        await this.bot.sendMessage(chatId, `❌ 유효하지 않은 페어: ${arg}`);
        return;
      }
      await this.bot.sendMessage(chatId, `🔍 [${this._displayName(pair)}] 분석 중...`);
      try {
        const detail = await this._analyzePairDetail(pair);
        await this.bot.sendMessage(chatId, detail);
      } catch (err) {
        await this.bot.sendMessage(chatId, `❌ 분석 실패: ${err.message}`);
        logger.error(`분석 실패: ${err.message}`);
      }
    });

    // /help
    this.bot.onText(/^\/help/, async (msg) => {
      if (!auth(msg)) return;
      try {
        await this.send([
          `━━━ 명령어 목록 ━━━`,
          `/status            - 봇 상태 + 활성 포지션`,
          `/pairs             - 거래 페어 목록`,
          `/position          - 모든 활성 포지션`,
          `/position BTC      - 특정 페어 상세`,
          `/balance           - 잔고 + 총 노출`,
          `/pnl               - 일일 손익 + 페어별 Kelly`,
          `/analyze           - 모든 페어 요약`,
          `/analyze BTC       - 특정 페어 상세 분석`,
          `/close BTC         - 특정 페어 청산`,
          `/close all         - 모든 페어 청산`,
          `/stop, /start, /help`,
        ].join('\n'));
      } catch (err) {
        logger.error(`/help 핸들러 오류: ${err.message}`);
      }
    });
  }

  /**
   * 페어 한 줄 요약 (전체 /analyze 용)
   */
  async _analyzePairSummary(pair) {
    const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
      gateClient.getCandles(pair, config.timeframes.htf, 200),
      gateClient.getCandles(pair, config.timeframes.mtf, 200),
      gateClient.getCandles(pair, config.timeframes.ltf, 200),
    ]);
    const currentPrice = ltfCandles[ltfCandles.length - 1].close;
    const signal = this.tradingBot.strategy.analyze({ htf: htfCandles, mtf: mtfCandles, ltf: ltfCandles });

    if (signal.signal) {
      const emoji = signal.signal === 'long' ? '📈' : '📉';
      const ss = signal.setupScore;
      const scoreTag = ss ? ` | ${ss.score}/100 ${ss.label}` : '';
      return `[${this._displayName(pair)}] ${emoji} ${signal.signal.toUpperCase()} @ ${currentPrice.toFixed(2)}${scoreTag}`;
    }
    return `[${this._displayName(pair)}] ⏸️ ${currentPrice.toFixed(2)} | ${signal.reason}`;
  }

  /**
   * 페어 상세 분석 (인자 있는 /analyze 용)
   */
  async _analyzePairDetail(pair) {
    const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
      gateClient.getCandles(pair, config.timeframes.htf, 200),
      gateClient.getCandles(pair, config.timeframes.mtf, 200),
      gateClient.getCandles(pair, config.timeframes.ltf, 200),
    ]);

    const currentPrice = ltfCandles[ltfCandles.length - 1].close;
    const lines = [];
    lines.push(`━━━ ICT v2 분석: ${this._displayName(pair)} ━━━`);
    lines.push(`💰 현재가: ${currentPrice.toFixed(2)}`);

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

    const pdhl = indicators.calculatePDHL(htfCandles);
    if (pdhl) {
      lines.push(`  PDH: ${pdhl.pdh.toFixed(2)} ${pdhl.pdhSweep ? '🔄 Sweep!' : ''}`);
      lines.push(`  PDL: ${pdhl.pdl.toFixed(2)} ${pdhl.pdlSweep ? '🔄 Sweep!' : ''}`);
    }

    const htfOBs = indicators.findOrderBlocks(htfCandles);
    lines.push(`  OB: Bull ${htfOBs.bullish.length}개 / Bear ${htfOBs.bearish.length}개`);

    const htfFVGs = indicators.findFairValueGaps(htfCandles);
    const htfBullUnfilled = htfFVGs.bullish.filter(f => !f.isFilled);
    const htfBearUnfilled = htfFVGs.bearish.filter(f => !f.isFilled);
    lines.push(`  FVG(미메움): Bull ${htfBullUnfilled.length}개 / Bear ${htfBearUnfilled.length}개`);
    if (htfBullUnfilled.length > 0) {
      const f = htfBullUnfilled[htfBullUnfilled.length - 1];
      lines.push(`    └ CE: ${f.ce.toFixed(2)} (${f.fillPercent}% filled)`);
    }
    if (htfBearUnfilled.length > 0) {
      const f = htfBearUnfilled[htfBearUnfilled.length - 1];
      lines.push(`    └ CE: ${f.ce.toFixed(2)} (${f.fillPercent}% filled)`);
    }

    const tol = 0.003;
    const inHtfOB = [...htfOBs.bullish, ...htfOBs.bearish].some(
      ob => currentPrice >= ob.low * (1 - tol) && currentPrice <= ob.high * (1 + tol)
    );
    const inHtfFVG = [...htfBullUnfilled, ...htfBearUnfilled].some(
      f => currentPrice >= f.bottom * (1 - tol) && currentPrice <= f.top * (1 + tol)
    );
    if (inHtfOB || inHtfFVG) {
      lines.push(`  ⭐ 현재가 HTF POI 진입 중${inHtfOB ? ' (OB)' : ''}${inHtfFVG ? ' (FVG)' : ''}`);
    }

    // HTF Liquidity Sweep (BSL/SSL)
    const htfSweeps = indicators.detectLiquiditySweep(htfCandles, htfSH, htfSL);
    if (htfSweeps.length > 0) {
      for (const sw of htfSweeps) {
        lines.push(`  ⚡ HTF ${sw.label} @ ${sw.level.toFixed(2)}`);
      }
    }
    lines.push('');

    // MTF
    lines.push(`📊 MTF (${config.timeframes.mtf})`);
    const mtfSH = indicators.findSwingHighs(mtfCandles, config.ict.structureShiftBars);
    const mtfSL = indicators.findSwingLows(mtfCandles, config.ict.structureShiftBars);
    const mtfMss = (mtfSH.length >= 2 && mtfSL.length >= 2)
      ? indicators.detectMarketStructureShift(mtfCandles, mtfSH, mtfSL)
      : null;
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

    // MTF Liquidity Sweep (BSL/SSL)
    if (mtfSH.length >= 2 && mtfSL.length >= 2) {
      const mtfSweeps = indicators.detectLiquiditySweep(mtfCandles, mtfSH, mtfSL);
      if (mtfSweeps.length > 0) {
        for (const sw of mtfSweeps) {
          lines.push(`  ⚡ MTF ${sw.label} @ ${sw.level.toFixed(2)}`);
        }
      }
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

    const sRanges = indicators.calculateSessionRanges(ltfCandles);
    if (Object.keys(sRanges).length > 0) {
      lines.push('');
      lines.push('📏 Session Range');
      for (const [, sr] of Object.entries(sRanges)) {
        lines.push(`  ${sr.name}: ${sr.low.toFixed(2)} ~ ${sr.high.toFixed(2)} ${sr.highSweep || sr.lowSweep ? '🔄 Sweep!' : ''}`);
      }
    }

    lines.push('');
    lines.push('📋 종합 판단');
    const signal = this.tradingBot.strategy.analyze({ htf: htfCandles, mtf: mtfCandles, ltf: ltfCandles });
    if (signal.signal) {
      const emoji = signal.signal === 'long' ? '📈' : '📉';
      const ss = signal.setupScore;
      lines.push(`  ${emoji} ${signal.signal.toUpperCase()} 신호!`);
      lines.push(`  진입: ${signal.entry} | SL: ${signal.sl} | TP: ${signal.tp}`);
      lines.push(`  R:R: 1:${signal.rr}`);
      if (ss) {
        lines.push(`  📊 Setup: ${ss.score}/100 — ${ss.label}`);
      }
      lines.push(`  컨플루언스 ${signal.confluence.length}개:`);
      const breakdownMap = new Map();
      if (ss && ss.breakdown) {
        for (const b of ss.breakdown) breakdownMap.set(b.text, b.points);
      }
      signal.confluence.forEach((c) => {
        const pts = breakdownMap.get(c);
        lines.push(pts ? `    • ${c} [+${pts}]` : `    • ${c}`);
      });
      const rrBonusItem = ss && ss.breakdown ? ss.breakdown.find((b) => b.text.startsWith('R:R')) : null;
      if (rrBonusItem) {
        lines.push(`    • R:R ${signal.rr} 보너스 [+${rrBonusItem.points}]`);
      }
    } else {
      lines.push(`  ⏸️ ${signal.reason}`);
      if (signal.confluence && signal.confluence.length > 0) {
        signal.confluence.forEach(c => lines.push(`    • ${c}`));
      }
    }

    return lines.join('\n');
  }

  /**
   * 메시지 발송 (A: 재시도 로직)
   *   네트워크 일시 불안정(EFATAL AggregateError) 대응
   *   최대 3회 재시도, 지수 백오프 (1s → 3s → 종료)
   */
  async send(message) {
    if (!this.enabled) return;
    const delays = [0, 1000, 3000]; // attempt 1: 즉시, 2: 1s, 3: 3s
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
        await this.bot.sendMessage(config.telegramChatId, message);
        return; // 성공
      } catch (err) {
        // 400 Bad Request (메시지 형식/길이 오류)는 재시도해도 실패하므로 즉시 abort
        const status = err && err.response && err.response.statusCode;
        if (status === 400 || status === 403) {
          logger.error(`텔레그램 전송 중단 (${status}, 재시도 불가): ${err.message}`);
          return;
        }
        if (attempt === 2) {
          logger.error(`텔레그램 전송 실패 (3회 시도): ${err.message}`);
        }
      }
    }
  }

  /**
   * 포지션 진입 알림 (pair 지정)
   */
  async notifyEntry(pair, signal, result) {
    const emoji = signal.signal === 'long' ? '📈' : '📉';
    let qtyText = `${result.size} 계약`;
    try {
      const contractInfo = await gateClient.getContract(pair);
      const baseCoin = pair.split('_')[0];
      const coinAmount = Math.abs(result.size) * Math.abs(contractInfo.quantoMultiplier);
      qtyText = `${coinAmount.toFixed(4)} ${baseCoin}`;
    } catch (err) {
      logger.error(`[${pair}] 수량 변환 실패: ${err.message}`);
    }
    // Setup Score breakdown (항목별 점수 표시)
    const ss = signal.setupScore;
    const breakdownMap = new Map();
    if (ss && ss.breakdown) {
      for (const b of ss.breakdown) breakdownMap.set(b.text, b.points);
    }

    const confluenceLines = signal.confluence.map((c) => {
      const pts = breakdownMap.get(c);
      return pts ? `  • ${c} [+${pts}]` : `  • ${c}`;
    });

    // R:R 보너스가 있으면 별도 표시
    const rrBonusItem = ss && ss.breakdown ? ss.breakdown.find((b) => b.text.startsWith('R:R')) : null;
    if (rrBonusItem) {
      confluenceLines.push(`  • R:R ${signal.rr} 보너스 [+${rrBonusItem.points}]`);
    }

    const scoreLabel = ss ? `📊 Setup: ${ss.score}/100 — ${ss.label}` : '';

    await this.send([
      `${emoji} ━━━ [${this._displayName(pair)}] 포지션 진입 ━━━`,
      `방향: ${signal.signal.toUpperCase()}`,
      `진입가: ${signal.entry}`,
      `손절(SL): ${signal.sl}`,
      `익절(TP): ${signal.tp}`,
      `R:R: 1:${signal.rr || '?'}`,
      `수량: ${qtyText}`,
      scoreLabel,
      ``,
      `📋 컨플루언스:`,
      ...confluenceLines,
      ``,
      `💡 ${signal.reason}`,
    ].join('\n'));
  }

  /**
   * 포지션 청산 알림 (pair 지정)
   *
   * action:
   *   - 'closed'           : PnL 확인됨 (부호로 익절/손절 판단)
   *   - 'closed (unknown)' : PnL 조회 실패 — "청산됨 (PnL 미확인)" 으로 표기
   */
  async notifyClose(pair, action, pnl, price) {
    if (action === 'closed (unknown)') {
      await this.send([
        `⚪ ━━━ [${this._displayName(pair)}] 청산 감지 ━━━`,
        `청산가: ${price}`,
        `PnL: 미확인 (거래 이력 조회 실패)`,
      ].join('\n'));
      return;
    }

    const isProfit = pnl >= 0;
    const emoji = isProfit ? '🎯' : '🛑';
    const label = isProfit ? '익절' : '손절';
    const pnlSign = isProfit ? '+' : '';

    await this.send([
      `${emoji} ━━━ [${this._displayName(pair)}] ${label} 청산 ━━━`,
      `청산가: ${price}`,
      `PnL: ${pnlSign}${pnl.toFixed(2)} USDT`,
    ].join('\n'));
  }

  async notifyDailyLossLimit(dailyPnl) {
    await this.send([
      `🚨 ━━━ 일일 손실 한도 도달 ━━━`,
      `일일 PnL: ${dailyPnl.toFixed(2)} USDT`,
      `한도: -${config.maxDailyLossUsdt} USDT`,
      `⚠️ 오늘 매매가 자동 중단됩니다.`,
    ].join('\n'));
  }

  /**
   * 주말 전 포지션 강제 청산 성공 알림 (weekend flatten).
   *   ICT 정통: 유동성 공백/갭 리스크 회피를 위한 정책 기반 청산.
   *   pnl=0 은 Gate.io eventual consistency 로 PnL 미확인인 경우
   *   (closePosition Case 3) — "미확인" 으로 표기.
   */
  async notifyWeekendFlatten(pair, pnl, reason) {
    const pnlLine = pnl === 0
      ? `PnL: 미확인 (거래 이력 조회 실패)`
      : `PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`;
    await this.send([
      `🔔 ━━━ [${this._displayName(pair)}] 주말 전 강제 청산 ━━━`,
      pnlLine,
      `사유: ${reason}`,
      ``,
      `ICT 정통 — 주말 홀딩 금지`,
    ].join('\n'));
  }

  /**
   * 주말 청산 실패 경고.
   *   level='warn'   : 3회 누적 실패 (버퍼 기간 내, 🟡)
   *   level='urgent' : 버퍼 종료 후 연장 기간 진입 (🟠)
   */
  async notifyWeekendFlattenFailed(pair, level, attempts) {
    const isWarn = level === 'warn';
    const emoji  = isWarn ? '🟡' : '🟠';
    const header = isWarn ? '주말 청산 경고' : '주말 청산 긴급';
    const statusLine1 = isWarn ? '상태: 연장 기간 진입 전' : '상태: 버퍼 종료, 연장 기간 진입';
    const statusLine2 = isWarn ? '다음 tick 재시도 예정' : '연장 30분 내 성공 못 하면 주말 홀딩';
    const suggestion  = isWarn ? '수동 개입 준비 필요' : 'Gate.io UI 확인 권장';

    await this.send([
      `${emoji} ━━━ [${this._displayName(pair)}] ${header} ━━━`,
      `시도 횟수: ${attempts}회 실패`,
      statusLine1,
      statusLine2,
      ``,
      suggestion,
    ].join('\n'));
  }

  /**
   * 주말 청산 최종 실패 (연장 기간도 초과) — 수동 개입 필수.
   */
  async notifyWeekendFlattenHolding(pair) {
    await this.send([
      `🚨 ━━━ [${this._displayName(pair)}] 주말 청산 최종 실패 ━━━`,
      `연장 기간 (30분) 내 청산 실패`,
      `주말 홀딩 수용`,
      ``,
      `🆘 수동 청산 필수`,
      `  Gate.io UI 또는 /close 명령 사용`,
    ].join('\n'));
  }

  async notifyError(error) {
    await this.send(`❌ 오류 발생: ${error}`);
  }

  async shutdown() {
    if (!this.enabled) return;
    await this.send('🔴 ICT Trading Bot 종료됨');
    this.bot.stopPolling();
  }
}

module.exports = TelegramService;
