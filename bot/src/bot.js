require('dotenv').config();

const http   = require('http');
const cron   = require('node-cron');
const config = require('./config');
const gateClient  = require('./api/gateClient');
const IctStrategy = require('./strategies/ictStrategy');
const OrderManager = require('./services/orderManager');
const TelegramService = require('./services/telegram');
const indicators  = require('./utils/indicators');
const logger      = require('./utils/logger');

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

// ── HTTP API 서버 ─────────────────────────────────────────────────────────────

/**
 * ICT 분석 결과를 구조화된 JSON으로 반환
 * Telegram의 _analyzePairDetail()과 동일한 데이터, 앱 표시용
 */
async function analyzeContractJson(contract) {
  const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
    gateClient.getCandles(contract, config.timeframes.htf, 200),
    gateClient.getCandles(contract, config.timeframes.mtf, 200),
    gateClient.getCandles(contract, config.timeframes.ltf, 200),
  ]);

  const currentPrice = ltfCandles[ltfCandles.length - 1].close;
  const session = indicators.getActiveSession();

  // HTF
  const htfSH = indicators.findSwingHighs(htfCandles, config.ict.structureShiftBars);
  const htfSL = indicators.findSwingLows(htfCandles,  config.ict.structureShiftBars);
  let htfDirection = null, htfStructure = null;
  if (htfSH.length >= 2 && htfSL.length >= 2) {
    const lh = htfSH[htfSH.length - 1].price, ph = htfSH[htfSH.length - 2].price;
    const ll = htfSL[htfSL.length - 1].price, pl = htfSL[htfSL.length - 2].price;
    if (lh > ph && ll > pl)      { htfDirection = 'BULLISH'; htfStructure = 'HH+HL'; }
    else if (lh < ph && ll < pl) { htfDirection = 'BEARISH'; htfStructure = 'LH+LL'; }
    else                         { htfDirection = 'RANGING'; htfStructure = '횡보'; }
  }
  const pdhl    = indicators.calculatePDHL(htfCandles);
  const htfOBs  = indicators.findOrderBlocks(htfCandles);
  const htfFVGs = indicators.findFairValueGaps(htfCandles);
  const htfBullFVG = htfFVGs.bullish.filter(f => !f.isFilled);
  const htfBearFVG = htfFVGs.bearish.filter(f => !f.isFilled);
  const tol = 0.003;
  const inHtfOB  = [...htfOBs.bullish, ...htfOBs.bearish].some(ob => currentPrice >= ob.low * (1 - tol) && currentPrice <= ob.high * (1 + tol));
  const inHtfFVG = [...htfBullFVG, ...htfBearFVG].some(f => currentPrice >= f.bottom * (1 - tol) && currentPrice <= f.top * (1 + tol));

  // MTF
  const mtfSH = indicators.findSwingHighs(mtfCandles, config.ict.structureShiftBars);
  const mtfSL = indicators.findSwingLows(mtfCandles,  config.ict.structureShiftBars);
  const mtfMss = (mtfSH.length >= 2 && mtfSL.length >= 2)
    ? indicators.detectMarketStructureShift(mtfCandles, mtfSH, mtfSL)
    : null;
  const mtfOBs  = indicators.findOrderBlocks(mtfCandles);
  const mtfFVGs = indicators.findFairValueGaps(mtfCandles);
  const mtfBullFVG = mtfFVGs.bullish.filter(f => !f.isFilled);
  const mtfBearFVG = mtfFVGs.bearish.filter(f => !f.isFilled);

  // LTF
  const ltfFVGs    = indicators.findFairValueGaps(ltfCandles);
  const ltfBullCE  = ltfFVGs.bullish.filter(f => !f.isFilled && f.atCE);
  const ltfBearCE  = ltfFVGs.bearish.filter(f => !f.isFilled && f.atCE);
  const ltfBullFill = ltfFVGs.bullish.filter(f => !f.isFilled && f.inRange && f.fillPercent >= 50);
  const ltfBearFill = ltfFVGs.bearish.filter(f => !f.isFilled && f.inRange && f.fillPercent >= 50);
  const iofeds     = indicators.detectIOFED(ltfCandles);
  const recentIOFED = iofeds.filter(d => ltfCandles.length - d.index <= 5);

  // Session ranges
  const sRanges = indicators.calculateSessionRanges(ltfCandles);
  const sessions = Object.values(sRanges).map(sr => ({
    name:      sr.name,
    low:       parseFloat(sr.low.toFixed(2)),
    high:      parseFloat(sr.high.toFixed(2)),
    sweep:     !!(sr.highSweep || sr.lowSweep),
  }));

  // 종합 신호
  const signal = bot.strategy.analyze({ htf: htfCandles, mtf: mtfCandles, ltf: ltfCandles });

  const lastFvg = (arr) => arr.length > 0 ? {
    ce:      parseFloat(arr[arr.length - 1].ce.toFixed(2)),
    fillPct: arr[arr.length - 1].fillPercent,
  } : null;

  return {
    contract,
    currentPrice: parseFloat(currentPrice.toFixed(2)),
    session: { active: session.active, name: session.name ?? session.reason },
    htf: {
      timeframe:  config.timeframes.htf,
      direction:  htfDirection,
      structure:  htfStructure,
      swingHigh:  htfSH.length ? parseFloat(htfSH[htfSH.length - 1].price.toFixed(2)) : null,
      swingLow:   htfSL.length ? parseFloat(htfSL[htfSL.length - 1].price.toFixed(2)) : null,
      pdh:        pdhl ? parseFloat(pdhl.pdh.toFixed(2)) : null,
      pdl:        pdhl ? parseFloat(pdhl.pdl.toFixed(2)) : null,
      pdhSweep:   pdhl?.pdhSweep ?? false,
      pdlSweep:   pdhl?.pdlSweep ?? false,
      ob:         { bull: htfOBs.bullish.length, bear: htfOBs.bearish.length },
      fvg: {
        bull: htfBullFVG.length, bear: htfBearFVG.length,
        lastBull: lastFvg(htfBullFVG),
        lastBear: lastFvg(htfBearFVG),
      },
      inPOI:   inHtfOB || inHtfFVG,
      poiType: inHtfOB ? 'OB' : inHtfFVG ? 'FVG' : null,
    },
    mtf: {
      timeframe: config.timeframes.mtf,
      mss:       mtfMss ? { found: true, label: mtfMss.label, kind: mtfMss.kind } : { found: false },
      ob:        { bull: mtfOBs.bullish.length, bear: mtfOBs.bearish.length },
      fvg: {
        bull: mtfBullFVG.length, bear: mtfBearFVG.length,
        lastBull: lastFvg(mtfBullFVG),
        lastBear: lastFvg(mtfBearFVG),
      },
    },
    ltf: {
      timeframe: config.timeframes.ltf,
      fvgCE:   { bull: ltfBullCE.length,   bear: ltfBearCE.length },
      fvgFill: { bull: ltfBullFill.length, bear: ltfBearFill.length },
      iofed:   recentIOFED.map(d => ({ type: d.type, bars: d.consecutiveBars })),
    },
    sessions,
    summary: {
      signal:     signal.signal,
      reason:     signal.reason,
      confluence: signal.confluence ?? [],
      entry:      signal.entry ?? null,
      sl:         signal.sl    ?? null,
      tp:         signal.tp    ?? null,
      setupScore: signal.setupScore ?? null,
    },
  };
}

function startHttpServer(botInstance) {
  const PORT   = process.env.PORT ?? 3001;
  const SECRET = process.env.BOT_API_SECRET ?? '';

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Headers', 'x-bot-secret');

    if (req.method === 'OPTIONS') { res.writeHead(200).end('{}'); return; }

    // 시크릿 검증 (설정된 경우)
    if (SECRET && req.headers['x-bot-secret'] !== SECRET) {
      res.writeHead(401).end(JSON.stringify({ error: '인증 실패' }));
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    try {
      // GET /bot/status
      if (url.pathname === '/bot/status') {
        res.writeHead(200).end(JSON.stringify({
          running:         botInstance.isRunning,
          pairs:           botInstance.validPairs,
          activePositions: Object.fromEntries(botInstance.activePositions),
        }));
        return;
      }

      // GET /bot/analyze?contract=XBT_USDT
      if (url.pathname === '/bot/analyze') {
        const contract = url.searchParams.get('contract');
        if (!contract) {
          res.writeHead(400).end(JSON.stringify({ error: 'contract 파라미터 필요' }));
          return;
        }
        const result = await analyzeContractJson(contract.replace('/', '_'));
        res.writeHead(200).end(JSON.stringify(result));
        return;
      }

      // GET /bot/agents
      if (url.pathname === '/bot/agents') {
        res.writeHead(200).end(JSON.stringify([
          { id: 'ict-v2', name: 'ICT v2', description: 'HTF/MTF/LTF 멀티 타임프레임 ICT 자동매매', version: '2.0' },
        ]));
        return;
      }

      res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      logger.error(`[HTTP] ${req.url} 오류: ${err.message}`);
      res.writeHead(500).end(JSON.stringify({ error: err.message }));
    }
  });

  server.listen(PORT, () => {
    logger.info(`[HTTP] API 서버 시작 — 포트 ${PORT}`);
  });
}

// --- 실행 ---
const bot = new TradingBot();

bot.start().catch((err) => {
  logger.error(`봇 시작 실패: ${err.message}`);
  process.exit(1);
});

startHttpServer(bot);

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
