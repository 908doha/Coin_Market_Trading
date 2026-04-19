require('dotenv').config();

const http   = require('http');
const cron   = require('node-cron');
const config = require('./config');
const GateClient  = require('./api/gateClient');
const IctStrategy = require('./strategies/ictStrategy');
const OrderManager = require('./services/orderManager');
const TelegramService = require('./services/telegram');
const indicators  = require('./utils/indicators');
const logger      = require('./utils/logger');

/** 공정성 — Fisher-Yates 셔플. 매 tick 계좌 순서 랜덤화 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class TradingBot {
  constructor() {
    this.strategy = new IctStrategy();
    this.telegram = new TelegramService(this);
    this.validPairs = [];
    this.isRunning = false;

    // 멀티 계좌: accounts Map — accId → { client, orderManager, activePositions }
    this.accounts = new Map();

    // 시장 데이터 조회용 공용 클라이언트 (첫 번째 계좌 재사용, API 콜 절약)
    this.marketClient = null;

    this._initAccounts();

    // 하위호환: 싱글 계좌 코드에서 this.orderManager / this.activePositions 참조
    //   (HTTP API, 기타 legacy 참조) — 첫 계좌 값을 그대로 노출
    const first = this.accounts.values().next().value;
    this.orderManager = first ? first.orderManager : null;
    this.activePositions = first ? first.activePositions : new Map();
  }

  /** 계좌별 GateClient + OrderManager 초기화 (Kelly 통계는 첫 계좌가 load, 나머지는 공유) */
  _initAccounts() {
    if (config.accounts.length === 0) {
      logger.error('유효한 Gate.io 계좌 없음 — .env 확인 필요');
      return;
    }

    let sharedKelly = null;
    for (let i = 0; i < config.accounts.length; i++) {
      const acc = config.accounts[i];
      const client = new GateClient(acc.apiKey, acc.apiSecret, acc.id);
      const om = new OrderManager(client, acc.id, sharedKelly);

      // 첫 계좌 OM 이 Kelly 통계 파일 load 한 직후, 그 Map 을 공유 객체로 포장
      if (i === 0) {
        sharedKelly = { tradeStatsByPair: om.tradeStatsByPair };
      }

      this.accounts.set(acc.id, {
        client,
        orderManager: om,
        activePositions: new Map(),
      });
    }

    this.marketClient = this.accounts.values().next().value.client;
    logger.info(`계좌 ${this.accounts.size}개 초기화: ${[...this.accounts.keys()].join(', ')}`);
  }

  /**
   * 봇 시작
   */
  async start() {
    logger.info('='.repeat(60));
    logger.info('Gate.io ICT Trading Bot 시작 (Multi-Pair, Multi-Account)');
    logger.info(`계좌: ${[...this.accounts.keys()].join(', ')} (${this.accounts.size}개)`);
    logger.info(`거래 페어 (설정): ${config.tradePairs.join(', ')}`);
    logger.info(`레버리지: x${config.leverage}`);
    logger.info(
      `포지션 사이징: Kelly 페어별 (Half=${config.kelly.fraction}, Max=${(config.kelly.maxFraction * 100).toFixed(0)}%, Default=${(config.kelly.defaultFraction * 100).toFixed(1)}%, MinTrades=${config.kelly.minTrades})`
    );
    logger.info(`총 노출 상한: ${(config.kelly.maxTotalExposure * 100).toFixed(0)}% (전 페어 합산 leveraged notional)`);
    logger.info(`타임프레임: HTF=${config.timeframes.htf} MTF=${config.timeframes.mtf} LTF=${config.timeframes.ltf}`);
    logger.info(`스케줄: ${config.cronSchedule}`);
    if (config.ict.weekendFlatten && config.ict.weekendFlatten.enabled) {
      const wf = config.ict.weekendFlatten;
      logger.info(
        `주말 전 강제 청산: ${wf.fridayOnly ? '금요일만' : 'Mon~Fri 매일'} ` +
        `NY PM 마감 ${wf.bufferMinutes}분 전 (연장 ${wf.extendMinutes}분)`
      );
    }
    logger.info('='.repeat(60));

    // 계좌 유효성 확인
    if (this.accounts.size === 0) {
      logger.error('.env 파일에 유효한 API 키 설정 필요');
      process.exit(1);
    }

    // 계좌별 초기 잔고 확인 — 하나라도 실패 시 종료
    for (const [accId, acc] of this.accounts) {
      try {
        const balance = await acc.client.getBalance();
        logger.info(`[${accId}] 잔고: ${balance.total.toFixed(2)} USDT (가용: ${balance.available.toFixed(2)} USDT)`);
      } catch (err) {
        logger.error(`[${accId}] API 연결 실패: ${err.message}`);
        process.exit(1);
      }
    }

    // 페어 검증 (공용 marketClient 로 1회만 — Gate.io 선물 계약 정보는 계좌 무관)
    for (const pair of config.tradePairs) {
      try {
        const contract = await this.marketClient.getContract(pair);
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

    // 계좌별 기존 포지션 감지 (각자 독립)
    for (const [accId, acc] of this.accounts) {
      for (const pair of this.validPairs) {
        try {
          const position = await acc.client.getPosition(pair);
          if (position && position.size !== 0) {
            const direction = position.size > 0 ? 'long' : 'short';
            acc.activePositions.set(pair, {
              direction,
              sl: null,
              tp: null,
              existing: true,
            });
            await acc.orderManager.registerExistingPosition(pair, position);
            logger.info(`[${accId}][${pair}] 기존 포지션 감지: ${direction.toUpperCase()} size=${position.size} entry=${position.entryPrice}`);
          }
        } catch {
          // 포지션 없음
        }
      }
      if (acc.activePositions.size > 0) {
        logger.info(`[${accId}] 기존 활성 포지션 ${acc.activePositions.size}개 자동 모니터링 시작`);
      }
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
   * 기존 활성 포지션 모니터링 (계좌별) — SL/TP 체크 + 분기 처리.
   *
   * 멀티 계좌: (accId, acc) 를 명시적으로 받아 해당 계좌 범위에서만 조작.
   * weekend flatten 의 buffer/extend phase 에서도 공유.
   *
   * 분기별 반환:
   *   - active 없음            : { handled: false }
   *   - closed / closed(unknown): notify + delete 후 handled:false
   *   - holding                : { handled: true }
   *   - holding_check          : { handled: true }
   *   - failed 등              : delete 후 handled:false
   *
   * @param {string} accId
   * @param {{orderManager: OrderManager, activePositions: Map}} acc
   * @param {string} pair
   */
  async _monitorActive(accId, acc, pair) {
    const active = acc.activePositions.get(pair);
    if (!active) return { handled: false };

    const result = await acc.orderManager.monitorPosition(
      pair,
      active.sl,
      active.tp,
      active.direction
    );

    if (result.action === 'closed' || result.action === 'closed (unknown)') {
      const pnlTag = result.action === 'closed (unknown)'
        ? 'N/A'
        : `${result.pnl.toFixed(2)} USDT`;
      logger.info(`[${accId}][${pair}] 포지션 종료: ${result.action} | PnL: ${pnlTag}`);
      // fire-and-forget: 알림 실패가 거래 로직을 블로킹하지 못하게
      this.telegram.notifyClose(pair, result.action, result.pnl, result.price, accId)
        .catch((err) => logger.error(`notifyClose 실패: ${err.message}`));
      acc.activePositions.delete(pair);
      return { handled: false, action: result.action, result };
    }
    if (result.action === 'holding') {
      return { handled: true, action: 'holding', result };
    }
    if (result.action === 'holding_check') {
      return { handled: true, action: 'holding_check', result };
    }
    // failed 등
    acc.activePositions.delete(pair);
    return { handled: false, action: result.action, result };
  }

  /**
   * 페어 단위 틱 처리 — 캔들/신호 1회, 계좌별 병렬 실행.
   *
   * 흐름:
   *   1. 공용 marketClient 로 캔들 조회 (1회)
   *   2. 전략 분석 (1회, 공유 signal)
   *   3. 계좌 배열 Fisher-Yates 셔플 (공정성)
   *   4. Promise.allSettled 로 각 계좌에 대해 monitor/execute 병렬 실행
   *      — 각 작업을 try/catch 로 감싸 다른 계좌로 에러 전파 차단
   */
  async _tickPair(pair) {
    // 1. 캔들 데이터 (공용 1회)
    const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
      this.marketClient.getCandles(pair, config.timeframes.htf, 200),
      this.marketClient.getCandles(pair, config.timeframes.mtf, 200),
      this.marketClient.getCandles(pair, config.timeframes.ltf, 200),
    ]);

    if (!htfCandles || htfCandles.length < 50 ||
        !mtfCandles || mtfCandles.length < 50 ||
        !ltfCandles || ltfCandles.length < 50) {
      logger.warn(`[${pair}] 캔들 데이터 부족`);
      return;
    }

    // 2. 전략 분석 (1회, 공유)
    const signal = this.strategy.analyze({
      htf: htfCandles,
      mtf: mtfCandles,
      ltf: ltfCandles,
    });

    // 3. 계좌 셔플 → 4. 병렬 실행 (공정성 + 에러 격리)
    const accountsList = shuffleArray([...this.accounts.entries()]);

    await Promise.allSettled(
      accountsList.map(async ([accId, acc]) => {
        try {
          await this._tickPairForAccount(accId, acc, pair, signal);
        } catch (err) {
          logger.error(`[${accId}][${pair}] 계좌 tick 에러 (다른 계좌 계속): ${err.message}`);
        }
      })
    );
  }

  /**
   * (계좌 단위) weekend flatten + monitor + execute.
   * _tickPair 의 핵심 로직을 계좌별로 실행. 기존 로직 바이트 단위 보존.
   */
  async _tickPairForAccount(accId, acc, pair, signal) {
    // 0. 주말 전 포지션 강제 청산 (ICT 정통 — 주말 홀딩 금지)
    //
    //   순서 / 정책은 원래 로직과 동일. this.orderManager/this.activePositions 참조를
    //   계좌별 acc.orderManager/acc.activePositions 로 교체. notify 에 accId 전달.
    const wf = config.ict.weekendFlatten;
    if (wf && wf.enabled) {
      const window = indicators.isInWeekendFlattenWindow(new Date(), wf);

      if (window.phase === 'none') {
        if (acc.activePositions.has(pair)) {
          const notified = acc.orderManager.closeNotified.get(pair);
          if (notified && notified.has('urgent') && !notified.has('final')) {
            this.telegram.notifyWeekendFlattenHolding(pair, accId)
              .catch((err) => logger.error(`notifyWeekendFlattenHolding 실패: ${err.message}`));
            acc.orderManager.markNotified(pair, 'final');
          }
        }
        // fall-through
      } else {
        // phase='buffer' or 'extend' — 신규 진입 차단
        if (!acc.activePositions.has(pair)) return;

        if (window.phase === 'buffer') {
          const monitor = await this._monitorActive(accId, acc, pair);
          if (monitor.action !== 'holding') return;

          const result = await acc.orderManager.closePosition(pair, window.reason);
          if (result.closed) {
            this.telegram.notifyWeekendFlatten(pair, result.pnl, window.reason, accId)
              .catch((err) => logger.error(`notifyWeekendFlatten 실패: ${err.message}`));
            acc.activePositions.delete(pair);
          } else if (result.attempts >= 3) {
            const notified = acc.orderManager.closeNotified.get(pair);
            if (!notified || !notified.has('warn')) {
              this.telegram.notifyWeekendFlattenFailed(pair, 'warn', result.attempts, accId)
                .catch((err) => logger.error(`notifyWeekendFlattenFailed 실패: ${err.message}`));
              acc.orderManager.markNotified(pair, 'warn');
            }
          }
          return;
        }

        if (window.phase === 'extend') {
          const notified = acc.orderManager.closeNotified.get(pair);
          if (!notified || !notified.has('urgent')) {
            const attemptsSoFar = acc.orderManager.closeAttempts.get(pair) || 0;
            this.telegram.notifyWeekendFlattenFailed(pair, 'urgent', attemptsSoFar, accId)
              .catch((err) => logger.error(`notifyWeekendFlattenFailed 실패: ${err.message}`));
            acc.orderManager.markNotified(pair, 'urgent');
          }

          const monitor = await this._monitorActive(accId, acc, pair);
          if (monitor.action !== 'holding') return;

          const result = await acc.orderManager.closePosition(pair, window.reason);
          if (result.closed) {
            this.telegram.notifyWeekendFlatten(pair, result.pnl, window.reason, accId)
              .catch((err) => logger.error(`notifyWeekendFlatten 실패: ${err.message}`));
            acc.activePositions.delete(pair);
          }
          return;
        }
      }
    }

    // 1. 기존 포지션 모니터링
    const monitor = await this._monitorActive(accId, acc, pair);
    if (monitor.handled) return;

    // 2. 동시 포지션 상한 (계좌별)
    if (acc.activePositions.size >= config.maxPositions) {
      logger.debug(`[${accId}][${pair}] 동시 포지션 상한 (${acc.activePositions.size}/${config.maxPositions})`);
      return;
    }

    // 3. 신호 없으면 스킵 (캔들/분석은 상위 함수에서 이미 수행)
    if (!signal.signal) {
      logger.debug(`[${accId}][${pair}] 신호 없음: ${signal.reason}`);
      return;
    }

    // 4. 주문 실행
    const result = await acc.orderManager.executeSignal(signal, pair);

    if (result.executed) {
      acc.activePositions.set(pair, {
        direction: result.direction,
        sl: result.sl,
        tp: result.tp,
      });
      logger.info(`[${accId}][${pair}] 포지션 진입 완료: ${result.direction} | SL: ${result.sl} | TP: ${result.tp}`);
      this.telegram.notifyEntry(pair, signal, result, accId)
        .catch((err) => logger.error(`notifyEntry 실패: ${err.message}`));
    } else {
      logger.debug(`[${accId}][${pair}] 주문 미실행: ${result.reason}`);
      if (result.reason === '일일 최대 손실 한도 도달') {
        this.telegram.notifyDailyLossLimit(acc.orderManager.dailyPnl, accId)
          .catch((err) => logger.error(`notifyDailyLossLimit 실패: ${err.message}`));
      }
    }
  }

  /**
   * 봇 정지
   */
  async stop() {
    this.isRunning = false;
    logger.info('봇 정지 중...');

    for (const [accId, acc] of this.accounts) {
      if (acc.activePositions.size > 0) {
        logger.warn(`[${accId}] 활성 포지션 ${acc.activePositions.size}개 — 수동 청산 필요 가능`);
        for (const [pair, pos] of acc.activePositions.entries()) {
          logger.warn(`  [${pair}] ${pos.direction}`);
        }
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
  const mc = bot.marketClient;
  const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
    mc.getCandles(contract, config.timeframes.htf, 200),
    mc.getCandles(contract, config.timeframes.mtf, 200),
    mc.getCandles(contract, config.timeframes.ltf, 200),
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
    },
  };
}

function startHttpServer(botInstance) {
  const PORT   = process.env.PORT ?? 3001;
  const SECRET = process.env.BOT_API_SECRET ?? '';

  // BOT_API_SECRET 미설정 시 HTTP 서버 자체를 시작하지 않는다.
  //   과거에는 SECRET=''이면 `if (SECRET && ...)` 이 false로 평가돼
  //   모든 요청이 인증 없이 통과하던 보안 취약점이 있었다.
  //   봇 본체(cron, 텔레그램) 는 정상 동작하며, 외부 HTTP API 만 비활성화.
  if (!SECRET) {
    logger.warn('[HTTP] BOT_API_SECRET 미설정 — 외부 HTTP API 비활성화 (봇/텔레그램은 정상 동작)');
    return;
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Headers', 'x-bot-secret');

    if (req.method === 'OPTIONS') { res.writeHead(200).end('{}'); return; }

    // 시크릿 검증 (항상 강제)
    if (req.headers['x-bot-secret'] !== SECRET) {
      res.writeHead(401).end(JSON.stringify({ error: '인증 실패' }));
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    try {
      // GET /bot/status — 하위호환: activePositions = 첫 계좌 / 신규: accounts 필드
      if (url.pathname === '/bot/status') {
        const firstAcc = botInstance.accounts.values().next().value;
        const accountsObj = {};
        for (const [accId, acc] of botInstance.accounts) {
          accountsObj[accId] = Object.fromEntries(acc.activePositions);
        }
        res.writeHead(200).end(JSON.stringify({
          running:         botInstance.isRunning,
          pairs:           botInstance.validPairs,
          activePositions: firstAcc ? Object.fromEntries(firstAcc.activePositions) : {},
          accounts:        accountsObj,
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
