const indicators = require('../utils/indicators');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * ICT (Inner Circle Trading) 전략 v2
 *
 * 변경사항:
 *  - 타임프레임: 4h → 15m → 5m
 *  - 진입 근거: FVG CE, FVG Fill, IOFED
 *  - 세션: Asian / London / NY (점심시간 제외, 주말 제외)
 *  - PDH/PDL 유동성
 *  - Session Range 유동성
 *
 * 3단계 분석:
 *  HTF (4h)  - 방향 판단 + PDH/PDL 유동성 레벨
 *  MTF (15m) - 구조 확인 (MSS + OB/FVG)
 *  LTF (5m)  - 정밀 진입 (FVG CE / FVG Fill / IOFED)
 */
class IctStrategy {
  constructor() {
    this.name = 'ICT Strategy v2';
  }

  /**
   * 멀티 타임프레임 분석
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

    // ========== 세션 체크 (주말 + 점심 제외) ==========
    const session = indicators.getActiveSession();
    if (!session.active) {
      return { signal: null, reason: session.reason || '세션 외 시간' };
    }
    confluence.push(`세션: ${session.name}`);

    // ========== STEP 1: HTF (4h) 방향 + PDH/PDL ==========
    const htfBias = this._analyzeHTF(htf);
    if (!htfBias.direction) {
      return { signal: null, reason: `HTF 방향 불명확: ${htfBias.reason}` };
    }
    confluence.push(`HTF(${config.timeframes.htf}) ${htfBias.direction.toUpperCase()}`);

    // PDH/PDL
    if (htfBias.pdhl) {
      if (htfBias.pdhl.pdhSweep) confluence.push(`PDH Sweep (${htfBias.pdhl.pdh.toFixed(2)})`);
      if (htfBias.pdhl.pdlSweep) confluence.push(`PDL Sweep (${htfBias.pdhl.pdl.toFixed(2)})`);
    }

    // ========== STEP 2: MTF (15m) 구조 확인 ==========
    const mtfStructure = this._analyzeMTF(mtf, htfBias.direction);
    if (!mtfStructure.confirmed) {
      return { signal: null, reason: `MTF 구조 미확인: ${mtfStructure.reason}`, confluence };
    }
    confluence.push(...mtfStructure.confluence);

    // ========== STEP 3: LTF (5m) 정밀 진입 ==========
    const ltfEntry = this._analyzeLTF(ltf, htfBias.direction, currentPrice, session);
    if (!ltfEntry.ready) {
      return { signal: null, reason: `LTF 진입 미충족: ${ltfEntry.reason}`, confluence };
    }
    confluence.push(...ltfEntry.confluence);

    // ========== 최종 신호 ==========
    const direction = htfBias.direction;
    const signal = direction === 'bullish' ? 'long' : 'short';

    const { sl, tp } = this._calculateSLTP(
      currentPrice, direction, mtfStructure, ltfEntry, htfBias
    );

    logger.info(`[ICT v2] ${signal.toUpperCase()} | ${confluence.length}개 컨플루언스`);

    return {
      signal,
      reason: `ICT v2 ${signal.toUpperCase()} - ${confluence.length}개 컨플루언스`,
      entry: currentPrice,
      sl: parseFloat(sl.toFixed(2)),
      tp: parseFloat(tp.toFixed(2)),
      confluence,
    };
  }

  /**
   * HTF (4h): 방향 판단 + PDH/PDL
   */
  _analyzeHTF(candles) {
    const swingHighs = indicators.findSwingHighs(candles, config.ict.structureShiftBars);
    const swingLows = indicators.findSwingLows(candles, config.ict.structureShiftBars);
    const pdhl = indicators.calculatePDHL(candles);

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

    let direction = null;
    let reason = '';

    if (higherHigh && higherLow) {
      direction = 'bullish';
      reason = 'HH + HL';
    } else if (lowerHigh && lowerLow) {
      direction = 'bearish';
      reason = 'LH + LL';
    } else {
      const mss = indicators.detectMarketStructureShift(candles, swingHighs, swingLows);
      if (mss) {
        direction = mss;
        reason = `HTF ${mss} MSS`;
      }
    }

    // PDH/PDL sweep으로 방향 보강
    if (!direction && pdhl) {
      if (pdhl.pdlSweep) { direction = 'bullish'; reason = 'PDL Sweep 반전'; }
      if (pdhl.pdhSweep) { direction = 'bearish'; reason = 'PDH Sweep 반전'; }
    }

    return {
      direction,
      reason: direction ? reason : '트렌드 불명확',
      swingHighs,
      swingLows,
      pdhl,
    };
  }

  /**
   * MTF (15m): 구조 확인
   */
  _analyzeMTF(candles, htfDirection) {
    const confluence = [];
    const swingHighs = indicators.findSwingHighs(candles, config.ict.structureShiftBars);
    const swingLows = indicators.findSwingLows(candles, config.ict.structureShiftBars);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { confirmed: false, reason: 'MTF 스윙 포인트 부족' };
    }

    const mss = indicators.detectMarketStructureShift(candles, swingHighs, swingLows);
    const mssAligned = mss === htfDirection;

    if (mssAligned) {
      confluence.push(`MTF(${config.timeframes.mtf}) ${htfDirection} MSS`);
    }

    const orderBlocks = indicators.findOrderBlocks(candles);
    const relevantOBs = htfDirection === 'bullish' ? orderBlocks.bullish : orderBlocks.bearish;
    if (relevantOBs.length > 0) {
      const ob = relevantOBs[relevantOBs.length - 1];
      confluence.push(`MTF OB [${ob.low.toFixed(2)}-${ob.high.toFixed(2)}]`);
    }

    const fvgs = indicators.findFairValueGaps(candles);
    const relevantFVGs = htfDirection === 'bullish' ? fvgs.bullish : fvgs.bearish;
    // 미메움 FVG만 필터
    const unfilled = relevantFVGs.filter(f => !f.isFilled);
    if (unfilled.length > 0) {
      const fvg = unfilled[unfilled.length - 1];
      confluence.push(`MTF FVG [${fvg.bottom.toFixed(2)}-${fvg.top.toFixed(2)}] CE:${fvg.ce.toFixed(2)}`);
    }

    const hasStructure = mssAligned || relevantOBs.length > 0;
    const hasPOI = relevantOBs.length > 0 || unfilled.length > 0;

    return {
      confirmed: hasStructure && hasPOI,
      reason: hasStructure && hasPOI ? '구조 확인됨' : 'MSS 또는 POI 부족',
      confluence,
      orderBlocks: relevantOBs,
      fvgs: unfilled,
      swingHighs,
      swingLows,
    };
  }

  /**
   * LTF (5m): 정밀 진입
   * 진입 근거: FVG CE, FVG Fill, IOFED
   */
  _analyzeLTF(candles, htfDirection, currentPrice, session) {
    const confluence = [];
    let entryConfirmed = false;
    let entryType = null;

    const swingHighs = indicators.findSwingHighs(candles, config.ict.structureShiftBars);
    const swingLows = indicators.findSwingLows(candles, config.ict.structureShiftBars);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { ready: false, reason: 'LTF 스윙 포인트 부족' };
    }

    // Session Range 확인
    const sessionRanges = indicators.calculateSessionRanges(candles);
    if (sessionRanges[session.session]) {
      const sr = sessionRanges[session.session];
      if (sr.highSweep || sr.lowSweep) {
        confluence.push(`${sr.name} Range Sweep`);
      }
    }

    // ===== 진입 근거 1: FVG CE (Consequent Encroachment) =====
    const fvgs = indicators.findFairValueGaps(candles);
    const relevantFVGs = htfDirection === 'bullish' ? fvgs.bullish : fvgs.bearish;
    const unfilledFVGs = relevantFVGs.filter(f => !f.isFilled);

    for (const fvg of unfilledFVGs) {
      if (fvg.atCE) {
        confluence.push(`LTF FVG CE @ ${fvg.ce.toFixed(2)} (${fvg.fillPercent}% filled)`);
        entryConfirmed = true;
        entryType = 'FVG_CE';
        break;
      }
    }

    // ===== 진입 근거 2: FVG Fill =====
    if (!entryConfirmed) {
      for (const fvg of unfilledFVGs) {
        if (fvg.inRange && fvg.fillPercent >= 50 && fvg.fillPercent < 100) {
          confluence.push(`LTF FVG Fill @ ${fvg.fillPercent}% [${fvg.bottom.toFixed(2)}-${fvg.top.toFixed(2)}]`);
          entryConfirmed = true;
          entryType = 'FVG_FILL';
          break;
        }
      }
    }

    // ===== 진입 근거 3: IOFED =====
    if (!entryConfirmed) {
      const iofeds = indicators.detectIOFED(candles);
      const relevantIOFED = iofeds.filter(d => d.type === htfDirection);

      if (relevantIOFED.length > 0) {
        const latest = relevantIOFED[relevantIOFED.length - 1];
        // 최근 5봉 내의 IOFED만 유효
        if (candles.length - latest.index <= 5) {
          confluence.push(`IOFED ${latest.type} (${latest.consecutiveBars}연속봉 후 반전)`);
          entryConfirmed = true;
          entryType = 'IOFED';
        }
      }
    }

    // Liquidity Sweep 추가 컨플루언스
    const sweeps = indicators.detectLiquiditySweep(candles, swingHighs, swingLows);
    const relevantSweep = sweeps.find(s => s.type === htfDirection);
    if (relevantSweep) {
      confluence.push(`LTF Sweep @ ${relevantSweep.level.toFixed(2)}`);
      if (!entryConfirmed) {
        entryConfirmed = true;
        entryType = 'SWEEP';
      }
    }

    // LTF MSS 추가 컨플루언스
    const ltfMss = indicators.detectMarketStructureShift(candles, swingHighs, swingLows);
    if (ltfMss === htfDirection) {
      confluence.push(`LTF ${htfDirection} MSS`);
    }

    return {
      ready: entryConfirmed,
      reason: entryConfirmed ? `${entryType} 진입` : 'FVG CE/Fill/IOFED 미충족',
      confluence,
      entryType,
      swingHighs,
      swingLows,
      sessionRanges,
    };
  }

  /**
   * SL/TP 계산
   */
  _calculateSLTP(price, direction, mtfStructure, ltfEntry, htfBias) {
    let sl, tp;

    if (direction === 'bullish') {
      // SL 우선순위: MTF OB 하단 → LTF 스윙 로우 → PDL → 고정 비율
      if (mtfStructure.orderBlocks.length > 0) {
        const ob = mtfStructure.orderBlocks[mtfStructure.orderBlocks.length - 1];
        sl = ob.low * (1 - config.stopLossPercent / 100 * 0.3);
      } else if (ltfEntry.swingLows && ltfEntry.swingLows.length > 0) {
        sl = ltfEntry.swingLows[ltfEntry.swingLows.length - 1].price * (1 - 0.001);
      } else if (htfBias.pdhl) {
        sl = htfBias.pdhl.pdl * (1 - 0.001);
      } else {
        sl = price * (1 - config.stopLossPercent / 100);
      }
      const risk = price - sl;
      tp = price + risk * 3;
    } else {
      if (mtfStructure.orderBlocks.length > 0) {
        const ob = mtfStructure.orderBlocks[mtfStructure.orderBlocks.length - 1];
        sl = ob.high * (1 + config.stopLossPercent / 100 * 0.3);
      } else if (ltfEntry.swingHighs && ltfEntry.swingHighs.length > 0) {
        sl = ltfEntry.swingHighs[ltfEntry.swingHighs.length - 1].price * (1 + 0.001);
      } else if (htfBias.pdhl) {
        sl = htfBias.pdhl.pdh * (1 + 0.001);
      } else {
        sl = price * (1 + config.stopLossPercent / 100);
      }
      const risk = sl - price;
      tp = price - risk * 3;
    }

    return { sl, tp };
  }
}

IctStrategy.AGENT_INFO = {
  id: 'ict-strategy',
  name: 'ICT 전략 v2',
  description: '멀티 타임프레임(4h/15m/5m) FVG · OB · IOFED 기반 ICT 자동매매',
  version: '2.0',
};

module.exports = IctStrategy;
