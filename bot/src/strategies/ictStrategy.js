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

    const { sl, tp, rr } = this._calculateSLTP(
      currentPrice, direction, mtfStructure, ltfEntry, htfBias
    );

    // ========== R:R 필터 (7-B: 컨플루언스 강도별 최소 R:R) ==========
    let minRR;
    if (hasHtfPoi && confluence.length >= 6) {
      minRR = 1.5; // Strong setup
    } else if (hasHtfPoi || confluence.length >= 5) {
      minRR = 2.0; // Medium setup
    } else {
      minRR = 2.5; // Weak setup
    }

    if (rr < minRR) {
      logger.info(`[ICT v2] ${signal.toUpperCase()} R:R ${rr} < 최소 ${minRR} (컨플루언스 ${confluence.length}개) → 스킵`);
      return {
        signal: null,
        reason: `R:R ${rr} 부족 (최소 ${minRR}, 컨플루언스 ${confluence.length}개)`,
        confluence,
      };
    }

    // ========== Setup Score ==========
    const setupScore = this._calculateSetupScore(confluence, rr);
    logger.info(`[ICT v2] ${signal.toUpperCase()} | R:R ${rr} | ${setupScore.score}/100 ${setupScore.label} | ${confluence.length}개 컨플루언스`);

    return {
      signal,
      reason: `ICT v2 ${signal.toUpperCase()} - R:R ${rr} | ${setupScore.score}/100 ${setupScore.label}`,
      entry: currentPrice,
      sl: parseFloat(sl.toFixed(2)),
      tp: parseFloat(tp.toFixed(2)),
      rr,
      confluence,
      setupScore,
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
    //   동일 캔들이 PDH/PDL 둘 다 스윕한 변동성 장에서는 먼저 평가한 쪽을 유지.
    //   (else if 로 변경 — 과거엔 두 조건이 모두 true 일 때 bearish 로 덮였음)
    if (!direction && pdhl) {
      if (pdhl.pdlSweep) { direction = 'bullish'; reason = 'PDL Sweep 반전'; }
      else if (pdhl.pdhSweep) { direction = 'bearish'; reason = 'PDH Sweep 반전'; }
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

    // ===== HTF Opposing POI (TP 구조적 타겟용) =====
    let opposingOBs = [];
    let opposingFVGs = [];
    if (direction) {
      // Opposing OB: 진행 방향에 있는 반대 OB (Long → bearish OB 위, Short → bullish OB 아래)
      const oppRawOBs = direction === 'bullish' ? orderBlocks.bearish : orderBlocks.bullish;
      opposingOBs = oppRawOBs.filter((ob) => {
        if (direction === 'bullish') return ob.low > currentPrice;
        return ob.high < currentPrice;
      });

      // Opposing FVG: 진행 방향에 있는 반대 미메움 FVG
      const oppRawFVGs = direction === 'bullish' ? fvgs.bearish : fvgs.bullish;
      opposingFVGs = oppRawFVGs.filter((f) => {
        if (f.isFilled) return false;
        if (direction === 'bullish') return f.bottom > currentPrice;
        return f.top < currentPrice;
      });
    }

    // ===== HTF Liquidity Sweep (BSL/SSL) =====
    const htfSweeps = indicators.detectLiquiditySweep(candles, swingHighs, swingLows);
    const htfActiveSweep = direction ? htfSweeps.find((s) => s.type === direction) : null;

    return {
      direction,
      reason: direction ? reason : '트렌드 불명확',
      swingHighs,
      swingLows,
      pdhl,
      orderBlocks: relevantOBs,
      opposingOBs,
      fvgs: relevantFVGs,
      opposingFVGs,
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
    // 반대 방향 OB = TP 구조적 타겟용
    const opposingRawOBs = htfDirection === 'bullish' ? orderBlocks.bearish : orderBlocks.bullish;
    const opposingOBs = opposingRawOBs.filter((ob) => {
      if (htfDirection === 'bullish') return ob.low > currentPrice; // 위쪽 저항
      return ob.high < currentPrice; // 아래쪽 지지
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
      opposingOBs,
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
   * SL/TP 계산 (ICT 구조적 R:R)
   *
   * SL: 구조 기반 (HTF OB → MTF OB → LTF Swing → PDH/PDL → 고정 %)
   * TP: 구조적 타겟 (opposing liquidity → opposing OB → PDH/PDL → risk × 2.5)
   *
   * R:R 가드레일:
   *   - max R:R 5.0 (타겟 너무 멀면 캡)
   *   - min R:R은 컨플루언스 강도별 차등 (analyze()에서 필터)
   *
   * @param confluenceCount  컨플루언스 개수 (R:R 산출 후 반환용)
   */
  _calculateSLTP(price, direction, mtfStructure, ltfEntry, htfBias) {
    const slPct = config.stopLossPercent / 100;
    const maxRiskPct = 0.03;
    const maxRR = 5.0;
    const fallbackRR = 2.5;

    // ===== SL 계산 (기존 구조 기반 — 변경 없음) =====
    let sl;
    const slCandidates = [];

    if (direction === 'bullish') {
      // 1. HTF OB
      if (htfBias && htfBias.orderBlocks) {
        for (let i = htfBias.orderBlocks.length - 1; i >= 0; i--) {
          const ob = htfBias.orderBlocks[i];
          if (ob.low < price && (price - ob.low * (1 - 0.001)) / price <= maxRiskPct) {
            slCandidates.push(ob.low * (1 - 0.001));
            break;
          }
        }
      }
      // 2. MTF OB
      if (slCandidates.length === 0) {
        for (let i = mtfStructure.orderBlocks.length - 1; i >= 0; i--) {
          const ob = mtfStructure.orderBlocks[i];
          if (ob.low < price) { slCandidates.push(ob.low * (1 - slPct * 0.3)); break; }
        }
      }
      // 3. LTF Swing Low
      if (slCandidates.length === 0 && ltfEntry.swingLows) {
        for (let i = ltfEntry.swingLows.length - 1; i >= 0; i--) {
          if (ltfEntry.swingLows[i].price < price) { slCandidates.push(ltfEntry.swingLows[i].price * (1 - 0.001)); break; }
        }
      }
      // 4. PDL
      if (slCandidates.length === 0 && htfBias.pdhl && htfBias.pdhl.pdl < price) {
        slCandidates.push(htfBias.pdhl.pdl * (1 - 0.001));
      }
      // 5. 고정
      if (slCandidates.length === 0) slCandidates.push(price * (1 - slPct));

      sl = slCandidates[0];
      if (sl >= price) sl = price * (1 - slPct);
    } else {
      // Short SL
      if (htfBias && htfBias.orderBlocks) {
        for (let i = htfBias.orderBlocks.length - 1; i >= 0; i--) {
          const ob = htfBias.orderBlocks[i];
          if (ob.high > price && (ob.high * (1 + 0.001) - price) / price <= maxRiskPct) {
            slCandidates.push(ob.high * (1 + 0.001));
            break;
          }
        }
      }
      if (slCandidates.length === 0) {
        for (let i = mtfStructure.orderBlocks.length - 1; i >= 0; i--) {
          const ob = mtfStructure.orderBlocks[i];
          if (ob.high > price) { slCandidates.push(ob.high * (1 + slPct * 0.3)); break; }
        }
      }
      if (slCandidates.length === 0 && ltfEntry.swingHighs) {
        for (let i = ltfEntry.swingHighs.length - 1; i >= 0; i--) {
          if (ltfEntry.swingHighs[i].price > price) { slCandidates.push(ltfEntry.swingHighs[i].price * (1 + 0.001)); break; }
        }
      }
      if (slCandidates.length === 0 && htfBias.pdhl && htfBias.pdhl.pdh > price) {
        slCandidates.push(htfBias.pdhl.pdh * (1 + 0.001));
      }
      if (slCandidates.length === 0) slCandidates.push(price * (1 + slPct));

      sl = slCandidates[0];
      if (sl <= price) sl = price * (1 + slPct);
    }

    const risk = Math.abs(price - sl);

    // risk 가 0 이면 (SL이 진입가와 일치 — 부동소수점 오차나 slPct=0 설정 시)
    // 후속 R:R 계산이 Infinity/NaN 이 되어 잘못된 TP 가 선택된다.
    // 이 경우 고정 % 기반 SL/TP 로 즉시 반환한다.
    if (risk <= 0) {
      const fallbackSl = direction === 'bullish' ? price * (1 - slPct) : price * (1 + slPct);
      const fallbackTp = direction === 'bullish' ? price * (1 + slPct * fallbackRR) : price * (1 - slPct * fallbackRR);
      logger.warn(`[SL/TP] risk=0 감지 — 고정 % 폴백: SL=${fallbackSl.toFixed(2)} TP=${fallbackTp.toFixed(2)}`);
      return { sl: fallbackSl, tp: fallbackTp, rr: fallbackRR, tpSource: 'risk=0 fallback' };
    }

    // ===== TP 계산 (구조적 타겟 — ICT Liquidity Draw) =====
    // 가격은 다음 유동성 풀로 끌린다. TP = 가장 가까운 구조적 타겟.
    // 후보를 모두 모은 뒤 가까운 순으로 정렬, R:R ≥ 1.5인 첫 후보 채택.
    let tp;
    let tpSource = 'fallback';
    const tpCandidates = []; // { price, source }

    if (direction === 'bullish') {
      // Long: 위쪽 타겟 수집
      // 1. HTF swing high (opposing BSL) — 진입가 위의 모든 swing high 수집
      if (htfBias.swingHighs) {
        for (const sh of htfBias.swingHighs) {
          if (sh.price > price) tpCandidates.push({ price: sh.price, source: 'HTF swing high' });
        }
      }
      // 2. PDH
      if (htfBias.pdhl && htfBias.pdhl.pdh > price) {
        tpCandidates.push({ price: htfBias.pdhl.pdh, source: 'PDH' });
      }
      // 3. MTF opposing OB (bearish OB 하단 = 저항)
      if (mtfStructure.opposingOBs) {
        for (const ob of mtfStructure.opposingOBs) {
          if (ob.low > price) tpCandidates.push({ price: ob.low, source: 'MTF opposing OB' });
        }
      }
      // 4. HTF opposing OB
      if (htfBias.opposingOBs) {
        for (const ob of htfBias.opposingOBs) {
          if (ob.low > price) tpCandidates.push({ price: ob.low, source: 'HTF opposing OB' });
        }
      }
      // 5. HTF opposing FVG (반대 방향 미메움 FVG)
      if (htfBias.opposingFVGs) {
        for (const f of htfBias.opposingFVGs) {
          if (f.bottom > price) tpCandidates.push({ price: f.bottom, source: 'HTF opposing FVG' });
        }
      }

      // 가까운 순 정렬 (오름차순)
      tpCandidates.sort((a, b) => a.price - b.price);

      // R:R ≥ 1.5 인 첫 후보 채택
      const match = tpCandidates.find((t) => (t.price - price) / risk >= 1.5);
      if (match) {
        const rr = (match.price - price) / risk;
        tp = rr > maxRR ? price + risk * maxRR : match.price;
        tpSource = rr > maxRR ? `${match.source} (캡 ${maxRR})` : match.source;
      } else {
        tp = price + risk * fallbackRR;
        tpSource = `fallback (risk×${fallbackRR})`;
      }
    } else {
      // Short: 아래쪽 타겟 수집
      // 1. HTF swing low (opposing SSL)
      if (htfBias.swingLows) {
        for (const sl of htfBias.swingLows) {
          if (sl.price < price) tpCandidates.push({ price: sl.price, source: 'HTF swing low' });
        }
      }
      // 2. PDL
      if (htfBias.pdhl && htfBias.pdhl.pdl < price) {
        tpCandidates.push({ price: htfBias.pdhl.pdl, source: 'PDL' });
      }
      // 3. MTF opposing OB (bullish OB 상단 = 지지)
      if (mtfStructure.opposingOBs) {
        for (const ob of mtfStructure.opposingOBs) {
          if (ob.high < price) tpCandidates.push({ price: ob.high, source: 'MTF opposing OB' });
        }
      }
      // 4. HTF opposing OB
      if (htfBias.opposingOBs) {
        for (const ob of htfBias.opposingOBs) {
          if (ob.high < price) tpCandidates.push({ price: ob.high, source: 'HTF opposing OB' });
        }
      }
      // 5. HTF opposing FVG
      if (htfBias.opposingFVGs) {
        for (const f of htfBias.opposingFVGs) {
          if (f.top < price) tpCandidates.push({ price: f.top, source: 'HTF opposing FVG' });
        }
      }

      // 가까운 순 정렬 (내림차순 = 가격에서 가장 가까운 아래쪽부터)
      tpCandidates.sort((a, b) => b.price - a.price);

      const match = tpCandidates.find((t) => (price - t.price) / risk >= 1.5);
      if (match) {
        const rr = (price - match.price) / risk;
        tp = rr > maxRR ? price - risk * maxRR : match.price;
        tpSource = rr > maxRR ? `${match.source} (캡 ${maxRR})` : match.source;
      } else {
        tp = price - risk * fallbackRR;
        tpSource = `fallback (risk×${fallbackRR})`;
      }
    }

    const actualRR = Math.abs(tp - price) / risk;
    logger.info(`[SL/TP] SL=${sl.toFixed(2)} | TP=${tp.toFixed(2)} (${tpSource}) | R:R 1:${actualRR.toFixed(2)} | 후보 ${tpCandidates.length}개`);

    return { sl, tp, rr: parseFloat(actualRR.toFixed(2)), tpSource };
  }

  /**
   * 컨플루언스 점수 계산 (ICT 중요도 기반, 100점 만점)
   *
   * 각 컨플루언스 항목에 ICT 중요도에 따른 점수를 부여하고,
   * R:R 보너스를 더해 총점(최대 100)을 산출한다.
   *
   * @param confluence  컨플루언스 문자열 배열
   * @param rr          Risk:Reward 비율
   * @returns {{ score, grade, label, breakdown }}
   */
  _calculateSetupScore(confluence, rr) {
    const rules = [
      { pattern: /세션:/,                              points: 5,  label: 'Session' },
      { pattern: /HTF\(.+\)\s+(BULLISH|BEARISH)/,      points: 10, label: 'HTF Direction' },
      { pattern: /★ HTF OB 진입/,                      points: 15, label: 'HTF OB Entry' },
      { pattern: /★ HTF FVG 진입/,                     points: 12, label: 'HTF FVG Entry' },
      { pattern: /★ HTF (BSL|SSL) sweep/,              points: 10, label: 'HTF Sweep' },
      { pattern: /PD[HL] Sweep/,                        points: 8,  label: 'PDH/PDL Sweep' },
      { pattern: /★ HTF\+MTF.+겹침/,                   points: 12, label: 'HTF+MTF Overlap' },
      { pattern: /MTF\(.+\)\s+(BOS|CHoCH)/,            points: 8,  label: 'MTF MSS' },
      { pattern: /MTF OB/,                              points: 7,  label: 'MTF OB' },
      { pattern: /MTF FVG/,                             points: 5,  label: 'MTF FVG' },
      { pattern: /★ MTF (BSL|SSL) sweep/,              points: 7,  label: 'MTF Sweep' },
      { pattern: /LTF FVG CE/,                          points: 8,  label: 'LTF FVG CE' },
      { pattern: /LTF FVG Fill/,                        points: 6,  label: 'LTF FVG Fill' },
      { pattern: /IOFED/,                               points: 7,  label: 'IOFED' },
      { pattern: /LTF (BSL|SSL) sweep/,                points: 6,  label: 'LTF Sweep' },
      { pattern: /LTF (BOS|CHoCH)/,                    points: 4,  label: 'LTF MSS' },
      { pattern: /Range Sweep/,                          points: 5,  label: 'Session Range' },
    ];

    const breakdown = [];
    let total = 0;

    for (const c of confluence) {
      for (const rule of rules) {
        if (rule.pattern.test(c)) {
          total += rule.points;
          breakdown.push({ text: c, points: rule.points });
          break; // 한 컨플루언스에 하나의 룰만 매칭
        }
      }
    }

    // R:R 보너스
    let rrBonus = 0;
    if (rr >= 4.0) rrBonus = 8;
    else if (rr >= 3.0) rrBonus = 5;
    else if (rr >= 2.5) rrBonus = 3;
    if (rrBonus > 0) {
      total += rrBonus;
      breakdown.push({ text: `R:R ${rr} bonus`, points: rrBonus });
    }

    const score = Math.min(total, 100);

    // 등급 결정
    let grade, label;
    if (score >= 90) { grade = 'S'; label = 'ELITE'; }
    else if (score >= 80) { grade = 'A'; label = 'PREMIUM'; }
    else if (score >= 70) { grade = 'B+'; label = 'STRONG'; }
    else if (score >= 60) { grade = 'B'; label = 'SOLID'; }
    else if (score >= 50) { grade = 'C'; label = 'MODERATE'; }
    else if (score >= 40) { grade = 'D'; label = 'WEAK'; }
    else { grade = 'F'; label = 'FRAGILE'; }

    return { score, grade, label, breakdown };
  }
}

module.exports = IctStrategy;
