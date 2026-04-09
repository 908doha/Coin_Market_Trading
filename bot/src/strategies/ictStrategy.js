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

    // HTF POI — 현재가가 HTF OB/FVG 내부 또는 ±0.3% 근접 시 가점
    const hasHtfPoi = (htfBias.activeOBs && htfBias.activeOBs.length > 0)
                   || (htfBias.activeFVGs && htfBias.activeFVGs.length > 0);
    if (htfBias.activeOBs && htfBias.activeOBs.length > 0) {
      const ob = htfBias.activeOBs[htfBias.activeOBs.length - 1];
      confluence.push(`★ HTF OB 진입 [${ob.low.toFixed(2)}-${ob.high.toFixed(2)}]`);
    }
    if (htfBias.activeFVGs && htfBias.activeFVGs.length > 0) {
      const fvg = htfBias.activeFVGs[htfBias.activeFVGs.length - 1];
      confluence.push(`★ HTF FVG 진입 [${fvg.bottom.toFixed(2)}-${fvg.top.toFixed(2)}] CE:${fvg.ce.toFixed(2)}`);
    }

    // HTF Liquidity Sweep (BSL/SSL) — 방향과 일치하는 스윕만
    if (htfBias.htfActiveSweep) {
      const sw = htfBias.htfActiveSweep;
      confluence.push(`★ HTF ${sw.label} @ ${sw.level.toFixed(2)}`);
    }

    // ========== STEP 2: MTF (15m) 구조 확인 ==========
    const mtfStructure = this._analyzeMTF(mtf, htfBias.direction, htfBias);
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
      hasHtfPoi,
      hasHtfSweep: !!htfBias.htfActiveSweep,
    };
  }

  /**
   * HTF (4h): 방향 판단 + PDH/PDL + HTF POI (OB/FVG)
   *
   * ICT 탑다운 원칙: HTF POI가 가장 강하다.
   *  - 방향에 맞고 현재가 기준 지지/저항 위치에 있는 OB/FVG를 모두 수집
   *  - 현재가가 POI 내부 또는 ±0.3% 근접한 것(active)만 별도로 표시
   */
  _analyzeHTF(candles) {
    const swingHighs = indicators.findSwingHighs(candles, config.ict.structureShiftBars);
    const swingLows = indicators.findSwingLows(candles, config.ict.structureShiftBars);
    const pdhl = indicators.calculatePDHL(candles);
    const currentPrice = candles[candles.length - 1].close;

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
        direction = mss.direction;
        reason = `HTF ${mss.label}`;
      }
    }

    // PDH/PDL sweep으로 방향 보강
    if (!direction && pdhl) {
      if (pdhl.pdlSweep) { direction = 'bullish'; reason = 'PDL Sweep 반전'; }
      if (pdhl.pdhSweep) { direction = 'bearish'; reason = 'PDH Sweep 반전'; }
    }

    // ===== HTF POI 탐색 (OB + FVG) =====
    const htfPoiTolerance = 0.003; // ±0.3%
    const orderBlocks = indicators.findOrderBlocks(candles);
    const fvgs = indicators.findFairValueGaps(candles);

    let relevantOBs = [];
    let relevantFVGs = [];
    let activeOBs = [];
    let activeFVGs = [];

    if (direction) {
      const rawOBs = direction === 'bullish' ? orderBlocks.bullish : orderBlocks.bearish;
      relevantOBs = rawOBs.filter((ob) => {
        if (direction === 'bullish') return ob.high < currentPrice; // 지지 (아래)
        return ob.low > currentPrice;                                // 저항 (위)
      });

      const rawFVGs = direction === 'bullish' ? fvgs.bullish : fvgs.bearish;
      relevantFVGs = rawFVGs.filter((f) => {
        if (f.isFilled) return false;
        if (direction === 'bullish') return f.top <= currentPrice;
        return f.bottom >= currentPrice;
      });

      // 현재가가 POI 내부 또는 ±0.3% 근접한 것 = "진입 중"
      activeOBs = relevantOBs.filter(
        (ob) =>
          currentPrice >= ob.low * (1 - htfPoiTolerance) &&
          currentPrice <= ob.high * (1 + htfPoiTolerance)
      );
      activeFVGs = relevantFVGs.filter(
        (f) =>
          currentPrice >= f.bottom * (1 - htfPoiTolerance) &&
          currentPrice <= f.top * (1 + htfPoiTolerance)
      );
    }

    // ===== HTF Liquidity Sweep (BSL/SSL) =====
    // HTF swing high/low 스윕은 기관 stop hunt 이후 반전 신호 (ICT 핵심)
    const htfSweeps = indicators.detectLiquiditySweep(candles, swingHighs, swingLows);
    // 방향이 결정된 경우 그 방향과 일치하는 sweep만 유효 (bullish 방향 → SSL sweep)
    const htfActiveSweep = direction ? htfSweeps.find((s) => s.type === direction) : null;

    return {
      direction,
      reason: direction ? reason : '트렌드 불명확',
      swingHighs,
      swingLows,
      pdhl,
      orderBlocks: relevantOBs,
      fvgs: relevantFVGs,
      activeOBs,
      activeFVGs,
      htfSweeps,
      htfActiveSweep,
    };
  }

  /**
   * MTF (15m): 구조 확인
   * HTF 방향에 맞고 현재가 기준 올바른 위치에 있는 OB/FVG만 사용
   *   - Bullish: 진입가보다 아래 (지지 역할)
   *   - Bearish: 진입가보다 위 (저항 역할)
   *
   * MTF POI가 HTF POI와 겹치면 ICT 탑다운 원칙상 훨씬 강한 셋업이므로 가점.
   */
  _analyzeMTF(candles, htfDirection, htfBias) {
    const confluence = [];
    const currentPrice = candles[candles.length - 1].close;
    const swingHighs = indicators.findSwingHighs(candles, config.ict.structureShiftBars);
    const swingLows = indicators.findSwingLows(candles, config.ict.structureShiftBars);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { confirmed: false, reason: 'MTF 스윙 포인트 부족' };
    }

    const mss = indicators.detectMarketStructureShift(candles, swingHighs, swingLows);
    const mssAligned = mss && mss.direction === htfDirection;

    if (mssAligned) {
      confluence.push(`MTF(${config.timeframes.mtf}) ${mss.label}`);
    }

    // Order Block - 위치 검증
    const orderBlocks = indicators.findOrderBlocks(candles);
    const rawOBs = htfDirection === 'bullish' ? orderBlocks.bullish : orderBlocks.bearish;
    const relevantOBs = rawOBs.filter((ob) => {
      if (htfDirection === 'bullish') {
        // Bullish OB는 현재가보다 아래 (지지)
        return ob.high < currentPrice;
      } else {
        // Bearish OB는 현재가보다 위 (저항)
        return ob.low > currentPrice;
      }
    });
    if (relevantOBs.length > 0) {
      const ob = relevantOBs[relevantOBs.length - 1];
      confluence.push(`MTF OB [${ob.low.toFixed(2)}-${ob.high.toFixed(2)}]`);
    }

    // FVG - 위치 검증
    const fvgs = indicators.findFairValueGaps(candles);
    const rawFVGs = htfDirection === 'bullish' ? fvgs.bullish : fvgs.bearish;
    const unfilled = rawFVGs.filter((f) => {
      if (f.isFilled) return false;
      if (htfDirection === 'bullish') {
        return f.top <= currentPrice; // 현재가 아래의 Bullish FVG
      } else {
        return f.bottom >= currentPrice; // 현재가 위의 Bearish FVG
      }
    });
    if (unfilled.length > 0) {
      const fvg = unfilled[unfilled.length - 1];
      confluence.push(`MTF FVG [${fvg.bottom.toFixed(2)}-${fvg.top.toFixed(2)}] CE:${fvg.ce.toFixed(2)}`);
    }

    // HTF POI와 겹침 검사 (ICT 탑다운 컨플루언스)
    const rangesOverlap = (aLow, aHigh, bLow, bHigh) => aLow <= bHigh && aHigh >= bLow;

    if (htfBias && htfBias.orderBlocks && htfBias.orderBlocks.length > 0 && relevantOBs.length > 0) {
      outer: for (const mOB of relevantOBs) {
        for (const hOB of htfBias.orderBlocks) {
          if (rangesOverlap(mOB.low, mOB.high, hOB.low, hOB.high)) {
            const lo = Math.max(mOB.low, hOB.low);
            const hi = Math.min(mOB.high, hOB.high);
            confluence.push(`★ HTF+MTF OB 겹침 [${lo.toFixed(2)}-${hi.toFixed(2)}]`);
            break outer;
          }
        }
      }
    }

    if (htfBias && htfBias.fvgs && htfBias.fvgs.length > 0 && unfilled.length > 0) {
      outer: for (const mFVG of unfilled) {
        for (const hFVG of htfBias.fvgs) {
          if (rangesOverlap(mFVG.bottom, mFVG.top, hFVG.bottom, hFVG.top)) {
            const lo = Math.max(mFVG.bottom, hFVG.bottom);
            const hi = Math.min(mFVG.top, hFVG.top);
            confluence.push(`★ HTF+MTF FVG 겹침 [${lo.toFixed(2)}-${hi.toFixed(2)}]`);
            break outer;
          }
        }
      }
    }

    // MTF Liquidity Sweep (BSL/SSL) — HTF 방향과 일치하는 스윕만 가점
    const mtfSweeps = indicators.detectLiquiditySweep(candles, swingHighs, swingLows);
    const mtfActiveSweep = mtfSweeps.find((s) => s.type === htfDirection);
    if (mtfActiveSweep) {
      confluence.push(`★ MTF ${mtfActiveSweep.label} @ ${mtfActiveSweep.level.toFixed(2)}`);
    }

    const hasStructure = mssAligned || relevantOBs.length > 0;
    const hasPOI = relevantOBs.length > 0 || unfilled.length > 0;

    return {
      confirmed: hasStructure && hasPOI,
      reason: hasStructure && hasPOI ? '구조 확인됨' : 'MSS 또는 POI 부족 (위치 검증 후)',
      confluence,
      orderBlocks: relevantOBs,
      fvgs: unfilled,
      swingHighs,
      swingLows,
      mtfActiveSweep,
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

    // LTF FVG - 위치 검증 (방향에 맞는 FVG만)
    const fvgs = indicators.findFairValueGaps(candles);
    const rawFVGs = htfDirection === 'bullish' ? fvgs.bullish : fvgs.bearish;
    const unfilledFVGs = rawFVGs.filter((f) => {
      if (f.isFilled) return false;
      if (htfDirection === 'bullish') {
        // Bullish FVG는 현재가가 FVG 위 또는 FVG 내부여야 함 (되돌림 매수)
        return f.bottom <= currentPrice;
      } else {
        // Bearish FVG는 현재가가 FVG 아래 또는 FVG 내부여야 함 (되돌림 매도)
        return f.top >= currentPrice;
      }
    });

    // ===== 진입 근거 1: FVG CE (정확히 CE 근처) =====
    // CE = FVG 중간값. 현재가가 CE에서 fvgCeThreshold(0.15%) 이내일 때만
    for (const fvg of unfilledFVGs) {
      if (fvg.atCE) {
        confluence.push(`LTF FVG CE @ ${fvg.ce.toFixed(2)} (진입가 ${currentPrice.toFixed(2)})`);
        entryConfirmed = true;
        entryType = 'FVG_CE';
        break;
      }
    }

    // ===== 진입 근거 2: FVG Fill (50% 이상 채워졌을 때) =====
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

    // Liquidity Sweep 추가 컨플루언스 (BSL/SSL 라벨링)
    const sweeps = indicators.detectLiquiditySweep(candles, swingHighs, swingLows);
    const relevantSweep = sweeps.find(s => s.type === htfDirection);
    if (relevantSweep) {
      confluence.push(`LTF ${relevantSweep.label} @ ${relevantSweep.level.toFixed(2)}`);
      if (!entryConfirmed) {
        entryConfirmed = true;
        entryType = relevantSweep.liquidity; // 'BSL' | 'SSL'
      }
    }

    // LTF MSS 추가 컨플루언스 (BOS/CHoCH 라벨링)
    const ltfMss = indicators.detectMarketStructureShift(candles, swingHighs, swingLows);
    if (ltfMss && ltfMss.direction === htfDirection) {
      confluence.push(`LTF ${ltfMss.label}`);
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
   *
   * SL 후보 우선순위 (정통 ICT 탑다운):
   *   1순위: HTF OB 경계 (최대 리스크 3% 이내일 때만)
   *   2순위: MTF OB 경계
   *   3순위: LTF 스윙 로우/하이
   *   4순위: PDL/PDH
   *   5순위: 고정 비율 폴백
   *
   * HTF OB는 멀어서 리스크가 maxRiskPct(3%)를 초과하면 안전장치로 MTF OB에 폴백.
   */
  _calculateSLTP(price, direction, mtfStructure, ltfEntry, htfBias) {
    let sl, tp;
    const slPct = config.stopLossPercent / 100;
    const maxRiskPct = 0.03; // HTF OB SL 최대 허용 리스크 (3%)

    if (direction === 'bullish') {
      // Long: SL은 반드시 진입가보다 낮아야 함
      const candidates = [];

      // 1순위: HTF OB 하단 (진입가보다 아래 + 리스크 ≤ 3%)
      if (htfBias && htfBias.orderBlocks) {
        for (let i = htfBias.orderBlocks.length - 1; i >= 0; i--) {
          const ob = htfBias.orderBlocks[i];
          if (ob.low < price) {
            const candidate = ob.low * (1 - 0.001);
            const risk = (price - candidate) / price;
            if (risk <= maxRiskPct) {
              candidates.push(candidate);
              break;
            }
          }
        }
      }

      // 2순위: MTF OB 하단 (진입가보다 아래인 경우만)
      if (candidates.length === 0) {
        for (let i = mtfStructure.orderBlocks.length - 1; i >= 0; i--) {
          const ob = mtfStructure.orderBlocks[i];
          if (ob.low < price) {
            candidates.push(ob.low * (1 - slPct * 0.3));
            break;
          }
        }
      }

      // 3순위: LTF 스윙 로우 (진입가보다 아래)
      if (candidates.length === 0 && ltfEntry.swingLows) {
        for (let i = ltfEntry.swingLows.length - 1; i >= 0; i--) {
          const slow = ltfEntry.swingLows[i].price;
          if (slow < price) {
            candidates.push(slow * (1 - 0.001));
            break;
          }
        }
      }

      // 4순위: PDL (진입가보다 아래)
      if (candidates.length === 0 && htfBias.pdhl && htfBias.pdhl.pdl < price) {
        candidates.push(htfBias.pdhl.pdl * (1 - 0.001));
      }

      // 폴백: 고정 비율
      if (candidates.length === 0) {
        candidates.push(price * (1 - slPct));
      }

      sl = candidates[0];
      // 최종 검증: Long SL은 반드시 진입가보다 낮아야 함
      if (sl >= price) {
        sl = price * (1 - slPct);
      }
      const risk = price - sl;
      tp = price + risk * 3;
    } else {
      // Short: SL은 반드시 진입가보다 높아야 함
      const candidates = [];

      // 1순위: HTF OB 상단 (진입가보다 위 + 리스크 ≤ 3%)
      if (htfBias && htfBias.orderBlocks) {
        for (let i = htfBias.orderBlocks.length - 1; i >= 0; i--) {
          const ob = htfBias.orderBlocks[i];
          if (ob.high > price) {
            const candidate = ob.high * (1 + 0.001);
            const risk = (candidate - price) / price;
            if (risk <= maxRiskPct) {
              candidates.push(candidate);
              break;
            }
          }
        }
      }

      // 2순위: MTF OB 상단 (진입가보다 위인 경우만)
      if (candidates.length === 0) {
        for (let i = mtfStructure.orderBlocks.length - 1; i >= 0; i--) {
          const ob = mtfStructure.orderBlocks[i];
          if (ob.high > price) {
            candidates.push(ob.high * (1 + slPct * 0.3));
            break;
          }
        }
      }

      // 3순위: LTF 스윙 하이 (진입가보다 위)
      if (candidates.length === 0 && ltfEntry.swingHighs) {
        for (let i = ltfEntry.swingHighs.length - 1; i >= 0; i--) {
          const shigh = ltfEntry.swingHighs[i].price;
          if (shigh > price) {
            candidates.push(shigh * (1 + 0.001));
            break;
          }
        }
      }

      // 4순위: PDH (진입가보다 위)
      if (candidates.length === 0 && htfBias.pdhl && htfBias.pdhl.pdh > price) {
        candidates.push(htfBias.pdhl.pdh * (1 + 0.001));
      }

      // 폴백
      if (candidates.length === 0) {
        candidates.push(price * (1 + slPct));
      }

      sl = candidates[0];
      // 최종 검증: Short SL은 반드시 진입가보다 높아야 함
      if (sl <= price) {
        sl = price * (1 + slPct);
      }
      const risk = sl - price;
      tp = price - risk * 3;
    }

    return { sl, tp };
  }
}

module.exports = IctStrategy;
