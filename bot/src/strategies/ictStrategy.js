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
    // HTF MSS 가 direction 근거일 때 별도 confluence (MTF/LTF MSS 와 대칭적 가점).
    // HH/HL 폴백 direction 은 매칭되지 않아 영향 없음.
    if (htfBias.reason && /^HTF (BOS|CHoCH)/.test(htfBias.reason)) {
      confluence.push(`HTF ${htfBias.reason.replace(/^HTF /, '')}`);
    }

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

    const { sl, tp, rr, tpSource } = this._calculateSLTP(
      currentPrice, direction, mtfStructure, ltfEntry, htfBias
    );

    // SL 계산 실패 (risk-cap-violation, risk-zero) 시 entry 차단.
    // tpSource 가 self-documenting reason 으로 전달됨.
    if (sl == null) {
      return { signal: null, reason: tpSource || 'SL calculation failed', confluence };
    }

    // ========== Weak setup + fallback TP skip ==========
    // ICT: "구조적 liquidity draw 없으면 매매 skip". weak setup (hasHtfPoi 없고
    // confluence < 5) 과 fallback TP (구조적 타겟 전부 탈락) 의 이중 약점 조합은
    // minRR 필터의 경계 (2.5) 를 정확히 통과해도 entry 금지.
    const isFallbackTp = /^fallback/.test(tpSource || '');
    if (!hasHtfPoi && confluence.length < 5 && isFallbackTp) {
      logger.info(`[ICT v2] ${signal.toUpperCase()} weak setup + fallback TP → skip`);
      return {
        signal: null,
        reason: 'weak setup + 구조적 TP 없음 (fallback)',
        confluence,
      };
    }

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
      logger.info(`[ICT v2] ${signal.toUpperCase()} R:R ${rr.toFixed(2)} < 최소 ${minRR} (컨플루언스 ${confluence.length}개) → 스킵`);
      return {
        signal: null,
        reason: `R:R ${rr.toFixed(2)} 부족 (최소 ${minRR}, 컨플루언스 ${confluence.length}개)`,
        confluence,
      };
    }

    // ========== Setup Score ==========
    const setupScore = this._calculateSetupScore(confluence, rr);
    logger.info(`[ICT v2] ${signal.toUpperCase()} | R:R ${rr.toFixed(2)} | ${setupScore.score}/100 ${setupScore.label} | ${confluence.length}개 컨플루언스`);

    return {
      signal,
      reason: `ICT v2 ${signal.toUpperCase()} - R:R ${rr.toFixed(2)} | ${setupScore.score}/100 ${setupScore.label}`,
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

    // MSS 를 먼저 조회 — CHoCH (reversal) 는 HH/HL 보다 우선 (fresh 신호가 stale 구조 덮음).
    const mss = indicators.detectMarketStructureShift(candles, swingHighs, swingLows);
    // breakIndex 가 number 임을 명시 검증 — indicators 측 implementation detail 의존 해소.
    const mssAge = (mss && Number.isFinite(mss.breakIndex))
      ? candles.length - mss.breakIndex - 1 : null;
    const mssAgeStr = mssAge !== null ? ` (${mssAge}봉 전 돌파)` : '';

    if (mss && mss.kind === 'CHoCH') {
      direction = mss.direction;
      reason = `HTF ${mss.label}${mssAgeStr}`;
    } else if (higherHigh && higherLow) {
      direction = 'bullish';
      reason = 'HH + HL';
    } else if (lowerHigh && lowerLow) {
      direction = 'bearish';
      reason = 'LH + LL';
    } else if (mss) {
      // BOS continuation — HH/HL 미충족 시 폴백
      direction = mss.direction;
      reason = `HTF ${mss.label}${mssAgeStr}`;
    }

    // PDH/PDL sweep 폴백
    //   양방향 sweep = range expansion failure → direction null 유지 (ICT: wait for directional break).
    //   단방향 sweep 은 반전 신호로 direction 설정.
    if (!direction && pdhl) {
      if (pdhl.pdlSweep && pdhl.pdhSweep) {
        reason = 'PDH+PDL 양방향 sweep (range)';
      } else if (pdhl.pdlSweep) {
        direction = 'bullish'; reason = 'PDL Sweep 반전';
      } else if (pdhl.pdhSweep) {
        direction = 'bearish'; reason = 'PDH Sweep 반전';
      }
    }

    // EQH/EQL swing sweep 폴백 — 1-A-1 이후 EQH 가 swing 으로 감지되므로
    //   비-PDH 레벨에서 BSL/SSL sweep 이 발생한 경우도 direction 결정에 활용.
    //   index 기준 가장 최근 sweep 채택 (배열 순서 보장 없음 — reduce 로 명시).
    if (!direction) {
      const sweeps = indicators.detectLiquiditySweep(candles, swingHighs, swingLows);
      // self-defending reduce — 다른 3건 (L298, L416, L537) 과 동일 패턴.
      //   `if (sweeps.length > 0)` 가드 의존 제거.
      const latest = sweeps.reduce((a, b) => (!a || b.index > a.index ? b : a), null);
      if (latest) {
        direction = latest.type;
        reason = `HTF ${latest.label}`;
      }
    }

    // ===== HTF POI 탐색 (OB + FVG) =====
    const htfPoiTolerance = config.ict.htfPoiTolerance;
    const orderBlocks = indicators.findOrderBlocks(candles);
    const fvgs = indicators.findFairValueGaps(candles);

    let relevantOBs = [];
    let relevantFVGs = [];
    let activeOBs = [];
    let activeFVGs = [];

    if (direction) {
      const rawOBs = direction === 'bullish' ? orderBlocks.bullish : orderBlocks.bearish;
      relevantOBs = rawOBs.filter((ob) => {
        // 내부 진입 / 접촉 반등 포함. broken OB 는 indicators 1-A-3 at-source 필터로 배제됨.
        if (direction === 'bullish') return ob.low <= currentPrice;  // OB 가 현재가 이하 (내부 포함)
        return ob.high >= currentPrice;                                // OB 가 현재가 이상 (내부 포함)
      });

      const rawFVGs = direction === 'bullish' ? fvgs.bullish : fvgs.bearish;
      relevantFVGs = rawFVGs.filter((f) => {
        if (f.isFilled) return false;
        if (direction === 'bullish') return f.bottom <= currentPrice; // FVG 하단이 현재가 이하 (내부 포함)
        return f.top >= currentPrice;                                  // FVG 상단이 현재가 이상 (내부 포함)
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
    // index 기준 최신 sweep 채택 (1-C-1 EQH 폴백과 동일 원칙).
    const htfSweeps = indicators.detectLiquiditySweep(candles, swingHighs, swingLows);
    const htfActiveSweep = direction
      ? htfSweeps
          .filter((s) => s.type === direction)
          .reduce((a, b) => (!a || b.index > a.index ? b : a), null)
      : null;

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
   * 두 배열의 첫 overlap 찾기 (역순 iteration — 가장 최신 쌍 우선).
   *   각 원소의 [lowKey] ~ [highKey] 범위 비교.
   *   overlap 발견 시 교집합 {lo, hi} 반환, 없으면 null.
   *
   * Pass 3-C: _analyzeMTF 의 OB/FVG overlap 검사 2곳 패턴 추출.
   */
  _findFirstOverlap(mtfArr, htfArr, lowKey, highKey) {
    for (let mi = mtfArr.length - 1; mi >= 0; mi--) {
      const m = mtfArr[mi];
      for (let hi = htfArr.length - 1; hi >= 0; hi--) {
        const h = htfArr[hi];
        if (m[lowKey] <= h[highKey] && m[highKey] >= h[lowKey]) {
          return {
            lo: Math.max(m[lowKey], h[lowKey]),
            hi: Math.min(m[highKey], h[highKey]),
          };
        }
      }
    }
    return null;
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
      // breakIndex 가 number 임을 명시 검증 — HTF 와 대칭, indicators 의존 해소.
      const age = Number.isFinite(mss.breakIndex)
        ? candles.length - mss.breakIndex - 1 : null;
      const ageStr = age !== null ? ` (${age}봉 전)` : '';
      confluence.push(`MTF(${config.timeframes.mtf}) ${mss.label}${ageStr}`);
    }

    // Order Block - 위치 검증
    const orderBlocks = indicators.findOrderBlocks(candles);
    const rawOBs = htfDirection === 'bullish' ? orderBlocks.bullish : orderBlocks.bearish;
    const relevantOBs = rawOBs.filter((ob) => {
      // 내부 진입 / 접촉 반등 포함. broken OB 는 1-A-3 at-source 필터로 배제됨.
      if (htfDirection === 'bullish') return ob.low <= currentPrice;
      return ob.high >= currentPrice;
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
      // 내부 진입 포함 (HTF 필터와 대칭)
      if (htfDirection === 'bullish') return f.bottom <= currentPrice;
      return f.top >= currentPrice;
    });
    if (unfilled.length > 0) {
      const fvg = unfilled[unfilled.length - 1];
      confluence.push(`MTF FVG [${fvg.bottom.toFixed(2)}-${fvg.top.toFixed(2)}] CE:${fvg.ce.toFixed(2)}`);
    }

    // HTF POI와 겹침 검사 (ICT 탑다운 컨플루언스) — 역순 iteration (최신 쌍 우선)
    if (htfBias && htfBias.orderBlocks && htfBias.orderBlocks.length > 0 && relevantOBs.length > 0) {
      const ov = this._findFirstOverlap(relevantOBs, htfBias.orderBlocks, 'low', 'high');
      if (ov) confluence.push(`★ HTF+MTF OB 겹침 [${ov.lo.toFixed(2)}-${ov.hi.toFixed(2)}]`);
    }

    if (htfBias && htfBias.fvgs && htfBias.fvgs.length > 0 && unfilled.length > 0) {
      const ov = this._findFirstOverlap(unfilled, htfBias.fvgs, 'bottom', 'top');
      if (ov) confluence.push(`★ HTF+MTF FVG 겹침 [${ov.lo.toFixed(2)}-${ov.hi.toFixed(2)}]`);
    }

    // MTF Liquidity Sweep (BSL/SSL) — HTF 방향과 일치하는 스윕만 가점
    // index 기준 최신 sweep 채택 (배열 순서는 swing 순회순이라 index 최신 보장 없음).
    const mtfSweeps = indicators.detectLiquiditySweep(candles, swingHighs, swingLows);
    const mtfActiveSweep = mtfSweeps
      .filter((s) => s.type === htfDirection)
      .reduce((a, b) => (!a || b.index > a.index ? b : a), null);
    if (mtfActiveSweep) {
      confluence.push(`★ MTF ${mtfActiveSweep.label} @ ${mtfActiveSweep.level.toFixed(2)}`);
    }

    // hasStructure: ICT 정통 "MSS 또는 swing 패턴 (HH/HL/LH/LL)" 으로 구조 확인.
    // OB 존재만으로는 구조 증거 부족 (OB 는 potential reaction zone, structural break 아님).
    let swingPattern = false;
    if (swingHighs.length >= 2 && swingLows.length >= 2) {
      const lastHigh = swingHighs[swingHighs.length - 1].price;
      const prevHigh = swingHighs[swingHighs.length - 2].price;
      const lastLow = swingLows[swingLows.length - 1].price;
      const prevLow = swingLows[swingLows.length - 2].price;
      swingPattern =
        (htfDirection === 'bullish' && lastHigh > prevHigh && lastLow > prevLow) ||
        (htfDirection === 'bearish' && lastHigh < prevHigh && lastLow < prevLow);
    }
    const hasStructure = mssAligned || swingPattern;
    const hasPOI = relevantOBs.length > 0 || unfilled.length > 0;

    return {
      confirmed: hasStructure && hasPOI,
      reason: hasStructure && hasPOI ? '구조 확인됨' : 'MSS/swing 패턴 또는 POI 부족 (위치 검증 후)',
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
    let iofedZone = null; // IOFED drill candle body — SL 체인에서 구조적 SL 후보로 사용

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
    // CE = FVG 중간값. 현재가가 CE에서 fvgCeThreshold(0.15%) 이내 + FVG 내부일 때만.
    // inRange 가드 없이는 currentPrice > top 이어도 CE 절대값 근접으로 entry 발동되는 버그.
    for (const fvg of unfilledFVGs) {
      if (fvg.atCE && fvg.inRange) {
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
        // config.ict.iofedValidityBars 봉 내의 IOFED 만 유효 entry 근거
        if (candles.length - latest.index <= config.ict.iofedValidityBars) {
          confluence.push(`IOFED ${latest.type} (${latest.consecutiveBars}연속봉 후 반전)`);
          entryConfirmed = true;
          entryType = 'IOFED';
          iofedZone = latest.entryZone; // drill candle body — SL 후보로 전달
        }
      }
    }

    // LTF MSS (BOS/CHoCH) — sweep entry 의 확정 조건 + confluence 로 공용 사용
    const ltfMss = indicators.detectMarketStructureShift(candles, swingHighs, swingLows);
    const ltfMssAligned = ltfMss && ltfMss.direction === htfDirection;

    // Liquidity Sweep (BSL/SSL) — index 기준 최신 sweep 채택
    const sweeps = indicators.detectLiquiditySweep(candles, swingHighs, swingLows);
    const relevantSweep = sweeps
      .filter((s) => s.type === htfDirection)
      .reduce((a, b) => (!a || b.index > a.index ? b : a), null);
    if (relevantSweep) {
      confluence.push(`LTF ${relevantSweep.label} @ ${relevantSweep.level.toFixed(2)}`);
      // ICT 정통 "sweep is bait, CHoCH is confirmation" — sweep 단독 entry 금지.
      // CE/Fill/IOFED 미충족 시 sweep + LTF MSS 정렬 조합만 entry trigger.
      if (!entryConfirmed && ltfMssAligned) {
        entryConfirmed = true;
        entryType = relevantSweep.liquidity; // 'BSL' | 'SSL'
      }
    }

    // LTF MSS confluence 가점 (entry trigger 아님 — stateful MSS 는 오래된 break 도
    // 포함할 수 있어 독립 entry 근거로는 부적합, confluence 전용)
    if (ltfMssAligned) {
      // breakIndex 가 number 임을 명시 검증 — HTF/MTF 와 대칭, indicators 의존 해소.
      const age = Number.isFinite(ltfMss.breakIndex)
        ? candles.length - ltfMss.breakIndex - 1 : null;
      const ageStr = age !== null ? ` (${age}봉 전 돌파)` : '';
      confluence.push(`LTF ${ltfMss.label}${ageStr}`);
    }

    return {
      ready: entryConfirmed,
      reason: entryConfirmed ? `${entryType} 진입` : 'FVG CE/Fill/IOFED 미충족',
      confluence,
      entryType,
      swingHighs,
      swingLows,
      sessionRanges,
      iofedZone,
    };
  }

  /**
   * TP 후보 중 minRR 이상의 R:R 을 만족하는 첫 원소 반환.
   *   tpCandidates 는 수집 단계에서 이미 direction 쪽만 포함하므로 Math.abs 로
   *   Bullish/Bearish 부호 차이 흡수.
   *
   * Pass 3-C2: Bullish/Bearish TP 블록의 R:R filter 공통 로직 추출 (나머지 거울 유지).
   */
  _findTpAtRR(tpCandidates, price, risk, minRR) {
    return tpCandidates.find((t) => Math.abs(t.price - price) / risk >= minRR) || null;
  }

  /**
   * SL candidate 를 safety margin 적용 + maxRiskPct 가드 후 반환.
   *   - basePrice: structural reference (OB.low / OB.high, swing.price, PDL/PDH 등)
   *   - direction === 'bullish' 시 candidate = basePrice * (1 - 0.001) (price 아래로 0.1% 띄움)
   *   - direction === 'bearish' 시 candidate = basePrice * (1 + 0.001) (price 위로 0.1% 띄움)
   *   - sideValid: bullish 는 basePrice < price, bearish 는 basePrice > price
   *   - risk (|candidate - price| / price) 가 maxRiskPct 초과 시 null 반환
   *
   * Pass 3-A: SL 체인 10 지점 (Bullish 5 + Bearish 5) 의 중복 패턴 추출.
   */
  _slCandidateWithRisk(price, basePrice, direction, maxRiskPct) {
    const sideValid = direction === 'bullish' ? basePrice < price : basePrice > price;
    if (!sideValid) return null;
    const marginFactor = direction === 'bullish' ? (1 - 0.001) : (1 + 0.001);
    const candidate = basePrice * marginFactor;
    const dist = Math.abs(candidate - price);
    return dist / price <= maxRiskPct ? candidate : null;
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
    const maxRiskPct = config.ict.maxRiskPct;
    const maxRR = 5.0;
    const fallbackRR = 2.5;

    // ===== SL 계산 (기존 구조 기반 — 변경 없음) =====
    let sl;
    const slCandidates = [];

    if (direction === 'bullish') {
      // 1. HTF OB
      if (htfBias && htfBias.orderBlocks) {
        for (let i = htfBias.orderBlocks.length - 1; i >= 0; i--) {
          const c = this._slCandidateWithRisk(price, htfBias.orderBlocks[i].low, 'bullish', maxRiskPct);
          if (c !== null) { slCandidates.push(c); break; }
        }
      }
      // 2. MTF OB — margin 0.001 통일, maxRiskPct 가드
      if (slCandidates.length === 0) {
        for (let i = mtfStructure.orderBlocks.length - 1; i >= 0; i--) {
          const c = this._slCandidateWithRisk(price, mtfStructure.orderBlocks[i].low, 'bullish', maxRiskPct);
          if (c !== null) { slCandidates.push(c); break; }
        }
      }
      // 2.5. IOFED drill candle body (institutional entry pocket) — MTF OB 보다 타이트, LTF swing 보다 구조적
      if (slCandidates.length === 0 && ltfEntry.iofedZone) {
        const c = this._slCandidateWithRisk(price, ltfEntry.iofedZone.low, 'bullish', maxRiskPct);
        if (c !== null) slCandidates.push(c);
      }
      // 3. LTF Swing Low — maxRiskPct 가드 추가
      if (slCandidates.length === 0 && ltfEntry.swingLows) {
        for (let i = ltfEntry.swingLows.length - 1; i >= 0; i--) {
          const c = this._slCandidateWithRisk(price, ltfEntry.swingLows[i].price, 'bullish', maxRiskPct);
          if (c !== null) { slCandidates.push(c); break; }
        }
      }
      // 4. PDL — maxRiskPct 가드 추가 (강한 추세장에서 PDL 이 멀 때 무제한 risk 차단)
      if (slCandidates.length === 0 && htfBias.pdhl && htfBias.pdhl.pdl < price) {
        const c = this._slCandidateWithRisk(price, htfBias.pdhl.pdl, 'bullish', maxRiskPct);
        if (c !== null) slCandidates.push(c);
      }
      // 5. 고정 % 폴백 (모든 구조적 후보 탈락 시 안전망) — maxRiskPct 가드 적용.
      //    폴백도 가드 초과 시 sl=null 반환으로 entry 차단.
      if (slCandidates.length === 0) {
        const fallback = price * (1 - slPct);
        const fallbackRisk = Math.abs(fallback - price) / price;
        if (fallbackRisk > maxRiskPct) {
          logger.warn(`[SL] 폴백 SL risk ${(fallbackRisk*100).toFixed(2)}% > maxRiskPct ${(maxRiskPct*100).toFixed(2)}% → entry 차단`);
          return { sl: null, tp: null, rr: 0, tpSource: 'risk-cap-violation' };
        }
        slCandidates.push(fallback);
      }

      sl = slCandidates[0];
      if (sl >= price) sl = price * (1 - slPct);
    } else {
      // Short SL
      if (htfBias && htfBias.orderBlocks) {
        for (let i = htfBias.orderBlocks.length - 1; i >= 0; i--) {
          const c = this._slCandidateWithRisk(price, htfBias.orderBlocks[i].high, 'bearish', maxRiskPct);
          if (c !== null) { slCandidates.push(c); break; }
        }
      }
      // 2. MTF OB — margin 0.001 통일 + maxRiskPct 가드
      if (slCandidates.length === 0) {
        for (let i = mtfStructure.orderBlocks.length - 1; i >= 0; i--) {
          const c = this._slCandidateWithRisk(price, mtfStructure.orderBlocks[i].high, 'bearish', maxRiskPct);
          if (c !== null) { slCandidates.push(c); break; }
        }
      }
      // 2.5. IOFED drill candle body (bullish drill = 마지막 양봉 body 상단)
      if (slCandidates.length === 0 && ltfEntry.iofedZone) {
        const c = this._slCandidateWithRisk(price, ltfEntry.iofedZone.high, 'bearish', maxRiskPct);
        if (c !== null) slCandidates.push(c);
      }
      // 3. LTF Swing High — maxRiskPct 가드 추가
      if (slCandidates.length === 0 && ltfEntry.swingHighs) {
        for (let i = ltfEntry.swingHighs.length - 1; i >= 0; i--) {
          const c = this._slCandidateWithRisk(price, ltfEntry.swingHighs[i].price, 'bearish', maxRiskPct);
          if (c !== null) { slCandidates.push(c); break; }
        }
      }
      // 4. PDH — maxRiskPct 가드 추가
      if (slCandidates.length === 0 && htfBias.pdhl && htfBias.pdhl.pdh > price) {
        const c = this._slCandidateWithRisk(price, htfBias.pdhl.pdh, 'bearish', maxRiskPct);
        if (c !== null) slCandidates.push(c);
      }
      // 5. 고정 % 폴백 — maxRiskPct 가드 적용 (bullish 블록과 대칭).
      if (slCandidates.length === 0) {
        const fallback = price * (1 + slPct);
        const fallbackRisk = Math.abs(fallback - price) / price;
        if (fallbackRisk > maxRiskPct) {
          logger.warn(`[SL] 폴백 SL risk ${(fallbackRisk*100).toFixed(2)}% > maxRiskPct ${(maxRiskPct*100).toFixed(2)}% → entry 차단`);
          return { sl: null, tp: null, rr: 0, tpSource: 'risk-cap-violation' };
        }
        slCandidates.push(fallback);
      }

      sl = slCandidates[0];
      if (sl <= price) sl = price * (1 + slPct);
    }

    const risk = Math.abs(price - sl);

    // risk 가 0 이면 (SL이 진입가와 일치 — 부동소수점 오차나 slPct=0 설정 시)
    // 후속 R:R 계산이 Infinity/NaN 이 되어 잘못된 TP 가 선택된다.
    // 폴백 rr=fallbackRR(2.5) 반환은 minRR 필터를 조용히 통과시키므로 entry 차단이 안전.
    if (risk <= 0) {
      logger.warn(`[SL/TP] risk=0 감지 — entry 차단 (slPct=${slPct}, price=${price}, sl=${sl})`);
      return { sl: null, tp: null, rr: 0, tpSource: 'risk-zero' };
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
      const match = this._findTpAtRR(tpCandidates, price, risk, 1.5);
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

      const match = this._findTpAtRR(tpCandidates, price, risk, 1.5);
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

    // rr 은 raw 값 반환 — 소비처에서 display 시점에만 toFixed 적용.
    // 반올림된 값을 비교에 쓰면 경계 0.005 이내 정밀도 손실 발생.
    return { sl, tp, rr: actualRR, tpSource };
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
      // HTF MSS (BOS/CHoCH) — MTF/LTF MSS 와 대칭, HTF 레이어 우선으로 10점
      { pattern: /HTF (BOS|CHoCH)/,                    points: 10, label: 'HTF MSS' },
      { pattern: /★ HTF OB 진입/,                      points: 15, label: 'HTF OB Entry' },
      { pattern: /★ HTF FVG 진입/,                     points: 12, label: 'HTF FVG Entry' },
      // HTF Sweep ↔ PDH/PDL 가중치 swap — ICT daily liquidity 우선 (1-B-2 NY midnight 업그레이드 반영)
      { pattern: /★ HTF (BSL|SSL) sweep/,              points: 8,  label: 'HTF Sweep' },
      { pattern: /PD[HL] Sweep/,                        points: 10, label: 'PDH/PDL Sweep' },
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
      let matched = false;
      for (const rule of rules) {
        if (rule.pattern.test(c)) {
          total += rule.points;
          breakdown.push({ text: c, points: rule.points });
          matched = true;
          break; // 한 컨플루언스에 하나의 룰만 매칭
        }
      }
      // 매치 실패 confluence 는 silent 로 누락되지 않고 breakdown 에 표시 + 경고.
      // 향후 confluence 포맷 변경 시 regex 호환성 깨져도 조기 탐지 가능.
      if (!matched) {
        logger.warn(`[setupScore] 미매칭 confluence: "${c}"`);
        breakdown.push({ text: c, points: 0, unmatched: true });
      }
    }

    // R:R 보너스
    let rrBonus = 0;
    if (rr >= 4.0) rrBonus = 8;
    else if (rr >= 3.0) rrBonus = 5;
    else if (rr >= 2.5) rrBonus = 3;
    if (rrBonus > 0) {
      total += rrBonus;
      breakdown.push({ text: `R:R ${rr.toFixed(2)} bonus`, points: rrBonus });
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
