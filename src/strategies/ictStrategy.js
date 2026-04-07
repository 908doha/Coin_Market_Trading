const indicators = require('../utils/indicators');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * ICT (Inner Circle Trading) 멀티 타임프레임 전략
 *
 * 3단계 분석:
 *  HTF (4h) - 전체 방향 판단 (트렌드 바이어스)
 *  MTF (1h) - 구조 확인 (MSS, OB, FVG)
 *  LTF (15m) - 정밀 진입 타이밍 (OTE, Liquidity Sweep)
 *
 * 진입 조건 (Long):
 *  1. HTF: Bullish 트렌드 (Higher High, Higher Low)
 *  2. MTF: Bullish MSS + Bullish OB 또는 FVG 존재
 *  3. LTF: Kill Zone 내 + OTE 구간 진입 또는 Liquidity Sweep
 *
 * 진입 조건 (Short):
 *  1. HTF: Bearish 트렌드 (Lower High, Lower Low)
 *  2. MTF: Bearish MSS + Bearish OB 또는 FVG 존재
 *  3. LTF: Kill Zone 내 + OTE 구간 진입 또는 Liquidity Sweep
 */
class IctStrategy {
  constructor() {
    this.name = 'ICT Multi-Timeframe Strategy';
  }

  /**
   * 멀티 타임프레임 분석
   * @param {Object} candleData - { htf: [], mtf: [], ltf: [] }
   */
  analyze(candleData) {
    const { htf, mtf, ltf } = candleData;

    if (!htf || !mtf || !ltf) {
      return { signal: null, reason: '멀티 타임프레임 데이터 부족' };
    }

    if (htf.length < config.ict.orderBlockLookback ||
        mtf.length < config.ict.orderBlockLookback ||
        ltf.length < config.ict.orderBlockLookback) {
      return { signal: null, reason: '캔들 데이터 부족' };
    }

    const currentPrice = ltf[ltf.length - 1].close;
    const confluence = [];

    // ========== STEP 1: HTF (4h) 방향 판단 ==========
    const htfBias = this._analyzeHTF(htf);
    if (!htfBias.direction) {
      return { signal: null, reason: `HTF 방향 불명확: ${htfBias.reason}` };
    }
    confluence.push(`HTF(${config.timeframes.htf}) ${htfBias.direction.toUpperCase()} 바이어스`);
    logger.debug(`[HTF] ${htfBias.direction} - ${htfBias.reason}`);

    // ========== STEP 2: MTF (1h) 구조 확인 ==========
    const mtfStructure = this._analyzeMTF(mtf, htfBias.direction);
    if (!mtfStructure.confirmed) {
      return { signal: null, reason: `MTF 구조 미확인: ${mtfStructure.reason}`, confluence };
    }
    confluence.push(...mtfStructure.confluence);
    logger.debug(`[MTF] 구조 확인됨 - ${mtfStructure.confluence.join(', ')}`);

    // ========== STEP 3: LTF (15m) 진입 타이밍 ==========
    const ltfEntry = this._analyzeLTF(ltf, htfBias.direction, currentPrice);
    if (!ltfEntry.ready) {
      return { signal: null, reason: `LTF 진입 조건 미충족: ${ltfEntry.reason}`, confluence };
    }
    confluence.push(...ltfEntry.confluence);
    logger.debug(`[LTF] 진입 준비 - ${ltfEntry.confluence.join(', ')}`);

    // ========== 최종 신호 생성 ==========
    const direction = htfBias.direction; // 'bullish' or 'bearish'
    const signal = direction === 'bullish' ? 'long' : 'short';

    // SL/TP 계산
    const { sl, tp } = this._calculateSLTP(
      currentPrice, direction, mtfStructure, ltfEntry
    );

    logger.info(`[MTF 신호] ${signal.toUpperCase()} | ${confluence.length}개 컨플루언스`);

    return {
      signal,
      reason: `ICT MTF ${signal.toUpperCase()} - HTF→MTF→LTF ${confluence.length}개 컨플루언스`,
      entry: currentPrice,
      sl: parseFloat(sl.toFixed(2)),
      tp: parseFloat(tp.toFixed(2)),
      confluence,
    };
  }

  /**
   * HTF (4h): 전체 트렌드 방향 판단
   * - Higher High + Higher Low = Bullish
   * - Lower High + Lower Low = Bearish
   */
  _analyzeHTF(candles) {
    const swingHighs = indicators.findSwingHighs(candles, config.ict.structureShiftBars);
    const swingLows = indicators.findSwingLows(candles, config.ict.structureShiftBars);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { direction: null, reason: 'HTF 스윙 포인트 부족' };
    }

    const lastHigh = swingHighs[swingHighs.length - 1].price;
    const prevHigh = swingHighs[swingHighs.length - 2].price;
    const lastLow = swingLows[swingLows.length - 1].price;
    const prevLow = swingLows[swingLows.length - 2].price;

    const higherHigh = lastHigh > prevHigh;
    const higherLow = lastLow > prevLow;
    const lowerHigh = lastHigh < prevHigh;
    const lowerLow = lastLow < prevLow;

    if (higherHigh && higherLow) {
      return { direction: 'bullish', reason: 'HH + HL (상승 구조)', swingHighs, swingLows };
    }
    if (lowerHigh && lowerLow) {
      return { direction: 'bearish', reason: 'LH + LL (하락 구조)', swingHighs, swingLows };
    }

    // 단일 조건이라도 MSS로 판단
    const mss = indicators.detectMarketStructureShift(candles, swingHighs, swingLows);
    if (mss === 'bullish') {
      return { direction: 'bullish', reason: 'HTF Bullish MSS', swingHighs, swingLows };
    }
    if (mss === 'bearish') {
      return { direction: 'bearish', reason: 'HTF Bearish MSS', swingHighs, swingLows };
    }

    return { direction: null, reason: '트렌드 불명확 (횡보 구간)' };
  }

  /**
   * MTF (1h): 구조 확인
   * HTF 방향과 일치하는 MSS + OB 또는 FVG 존재 여부
   */
  _analyzeMTF(candles, htfDirection) {
    const confluence = [];
    const swingHighs = indicators.findSwingHighs(candles, config.ict.structureShiftBars);
    const swingLows = indicators.findSwingLows(candles, config.ict.structureShiftBars);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { confirmed: false, reason: 'MTF 스윙 포인트 부족' };
    }

    // MSS 확인
    const mss = indicators.detectMarketStructureShift(candles, swingHighs, swingLows);
    const mssAligned = mss === htfDirection;

    if (mssAligned) {
      confluence.push(`MTF(${config.timeframes.mtf}) ${htfDirection} MSS 확인`);
    }

    // Order Block 탐색
    const orderBlocks = indicators.findOrderBlocks(candles);
    const relevantOBs = htfDirection === 'bullish' ? orderBlocks.bullish : orderBlocks.bearish;
    if (relevantOBs.length > 0) {
      const latestOB = relevantOBs[relevantOBs.length - 1];
      confluence.push(`MTF OB [${latestOB.low.toFixed(2)} - ${latestOB.high.toFixed(2)}]`);
    }

    // FVG 탐색
    const fvgs = indicators.findFairValueGaps(candles);
    const relevantFVGs = htfDirection === 'bullish' ? fvgs.bullish : fvgs.bearish;
    if (relevantFVGs.length > 0) {
      const latestFVG = relevantFVGs[relevantFVGs.length - 1];
      confluence.push(`MTF FVG [${latestFVG.bottom.toFixed(2)} - ${latestFVG.top.toFixed(2)}]`);
    }

    // MSS + (OB 또는 FVG) 필요
    const hasStructure = mssAligned || relevantOBs.length > 0;
    const hasPOI = relevantOBs.length > 0 || relevantFVGs.length > 0; // Point of Interest

    return {
      confirmed: hasStructure && hasPOI,
      reason: hasStructure && hasPOI ? '구조 확인됨' : 'MSS 또는 POI 부족',
      confluence,
      orderBlocks: relevantOBs,
      fvgs: relevantFVGs,
      swingHighs,
      swingLows,
    };
  }

  /**
   * LTF (15m): 정밀 진입 타이밍
   * Kill Zone + OTE 구간 또는 Liquidity Sweep
   */
  _analyzeLTF(candles, htfDirection, currentPrice) {
    const confluence = [];

    // Kill Zone 확인
    const killZone = indicators.isInKillZone();
    if (!killZone.active) {
      return { ready: false, reason: 'Kill Zone 외 시간대' };
    }
    confluence.push(`Kill Zone: ${killZone.zone}`);

    const swingHighs = indicators.findSwingHighs(candles, config.ict.structureShiftBars);
    const swingLows = indicators.findSwingLows(candles, config.ict.structureShiftBars);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { ready: false, reason: 'LTF 스윙 포인트 부족' };
    }

    let entryConfirmed = false;

    // Liquidity Sweep 확인
    const sweeps = indicators.detectLiquiditySweep(candles, swingHighs, swingLows);
    const relevantSweep = sweeps.find((s) => s.type === htfDirection);
    if (relevantSweep) {
      confluence.push(`LTF(${config.timeframes.ltf}) ${htfDirection} Liquidity Sweep @ ${relevantSweep.level.toFixed(2)}`);
      entryConfirmed = true;
    }

    // OTE 구간 확인
    const recentHigh = swingHighs[swingHighs.length - 1].price;
    const recentLow = swingLows[swingLows.length - 1].price;
    const ote = indicators.calculateOTE(recentHigh, recentLow);

    if (htfDirection === 'bullish') {
      if (currentPrice >= ote.bullish.lower && currentPrice <= ote.bullish.upper) {
        confluence.push(`LTF OTE [${ote.bullish.lower.toFixed(2)} - ${ote.bullish.upper.toFixed(2)}]`);
        entryConfirmed = true;
      }
    } else {
      if (currentPrice >= ote.bearish.lower && currentPrice <= ote.bearish.upper) {
        confluence.push(`LTF OTE [${ote.bearish.lower.toFixed(2)} - ${ote.bearish.upper.toFixed(2)}]`);
        entryConfirmed = true;
      }
    }

    // LTF MSS 확인 (추가 컨플루언스)
    const ltfMss = indicators.detectMarketStructureShift(candles, swingHighs, swingLows);
    if (ltfMss === htfDirection) {
      confluence.push(`LTF ${htfDirection} MSS`);
      entryConfirmed = true;
    }

    // LTF FVG 확인
    const ltfFvgs = indicators.findFairValueGaps(candles);
    const relevantFVGs = htfDirection === 'bullish' ? ltfFvgs.bullish : ltfFvgs.bearish;
    const inFVG = relevantFVGs.find((fvg) =>
      currentPrice >= fvg.bottom && currentPrice <= fvg.top
    );
    if (inFVG) {
      confluence.push(`LTF FVG [${inFVG.bottom.toFixed(2)} - ${inFVG.top.toFixed(2)}]`);
      entryConfirmed = true;
    }

    return {
      ready: entryConfirmed,
      reason: entryConfirmed ? '진입 조건 충족' : 'OTE/Sweep/MSS 미충족',
      confluence,
      ote,
      swingHighs,
      swingLows,
    };
  }

  /**
   * SL/TP 계산
   * SL: MTF OB/FVG 기반, TP: R:R = 1:3
   */
  _calculateSLTP(price, direction, mtfStructure, ltfEntry) {
    let sl, tp;

    if (direction === 'bullish') {
      // SL: MTF OB 하단 또는 LTF 스윙 로우 아래
      if (mtfStructure.orderBlocks.length > 0) {
        const ob = mtfStructure.orderBlocks[mtfStructure.orderBlocks.length - 1];
        sl = ob.low * (1 - config.stopLossPercent / 100 * 0.3);
      } else if (ltfEntry.swingLows && ltfEntry.swingLows.length > 0) {
        sl = ltfEntry.swingLows[ltfEntry.swingLows.length - 1].price * (1 - 0.001);
      } else {
        sl = price * (1 - config.stopLossPercent / 100);
      }
      const risk = price - sl;
      tp = price + risk * 3; // R:R = 1:3
    } else {
      // SL: MTF OB 상단 또는 LTF 스윙 하이 위
      if (mtfStructure.orderBlocks.length > 0) {
        const ob = mtfStructure.orderBlocks[mtfStructure.orderBlocks.length - 1];
        sl = ob.high * (1 + config.stopLossPercent / 100 * 0.3);
      } else if (ltfEntry.swingHighs && ltfEntry.swingHighs.length > 0) {
        sl = ltfEntry.swingHighs[ltfEntry.swingHighs.length - 1].price * (1 + 0.001);
      } else {
        sl = price * (1 + config.stopLossPercent / 100);
      }
      const risk = sl - price;
      tp = price - risk * 3; // R:R = 1:3
    }

    return { sl, tp };
  }
}

module.exports = IctStrategy;

// 앱에서 이 전략에 매핑되는 에이전트 정의
IctStrategy.AGENT_DEFINITIONS = [
  {
    id:          'ict-strategy-1-indicators',
    name:        'ICT 전략 — 지표',
    description: 'HTF/MTF/LTF 멀티 타임프레임 + 스윙 구조 지표 기반 ICT 자동매매',
    version:     '1.0',
  },
  {
    id:          'ict-strategy-2-sessions-liquidity',
    name:        'ICT 전략 — 세션/유동성',
    description: '킬존(런던·뉴욕) + 유동성 스윕 중심의 ICT 진입 전략',
    version:     '1.0',
  },
  {
    id:          'ict-strategy-3-entry-sltp',
    name:        'ICT 전략 — OTE 진입/SL·TP',
    description: 'OTE 구간 정밀 진입 + MSS 기반 손절·익절 자동 설정',
    version:     '1.0',
  },
];

// AGENT_IDS는 registry 호환용 (AGENT_DEFINITIONS에서 자동 파생)
IctStrategy.AGENT_IDS = IctStrategy.AGENT_DEFINITIONS.map((d) => d.id);
