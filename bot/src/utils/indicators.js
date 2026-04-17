const config = require('../config');

/**
 * ICT (Inner Circle Trading) 기술적 지표 모듈 v2
 *
 * 구현 지표:
 * - Swing High / Low
 * - Market Structure Shift (MSS)
 * - Order Block (OB)
 * - Fair Value Gap (FVG) + Consequent Encroachment (CE) + FVG Fill
 * - IOFED (Institutional Order Flow Entry Drill)
 * - Optimal Trade Entry (OTE)
 * - PDH / PDL (Previous Day High / Low)
 * - Session Range (Asian / London / NY)
 * - Session Time Check (점심시간 제외, 주말 제외)
 * - Liquidity Sweep
 */
const indicators = {
  // ========== 스윙 포인트 ==========

  findSwingHighs(candles, lookback = 5) {
    const swings = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      let isSwingHigh = true;
      for (let j = 1; j <= lookback; j++) {
        if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
          isSwingHigh = false;
          break;
        }
      }
      if (isSwingHigh) {
        swings.push({ index: i, price: candles[i].high, timestamp: candles[i].timestamp });
      }
    }
    return swings;
  },

  findSwingLows(candles, lookback = 5) {
    const swings = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      let isSwingLow = true;
      for (let j = 1; j <= lookback; j++) {
        if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
          isSwingLow = false;
          break;
        }
      }
      if (isSwingLow) {
        swings.push({ index: i, price: candles[i].low, timestamp: candles[i].timestamp });
      }
    }
    return swings;
  },

  // ========== Market Structure Shift (BOS / CHoCH 분리) ==========

  /**
   * 구조 전환 감지
   *  - BOS  (Break of Structure)        : 기존 추세 방향으로의 구조 돌파 (추세 지속)
   *  - CHoCH (Change of Character)      : 기존 추세 반대 방향으로의 구조 돌파 (추세 전환)
   *
   * 직전 swing 패턴(HH/HL vs LH/LL)으로 기존 추세를 추정한 뒤,
   * 돌파 방향과 비교하여 BOS/CHoCH를 라벨링한다.
   *
   * @returns {null | { direction: 'bullish'|'bearish', kind: 'BOS'|'CHoCH', label: string }}
   */
  detectMarketStructureShift(candles, swingHighs, swingLows) {
    if (swingHighs.length < 2 || swingLows.length < 2) return null;

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    // 직전 추세 추정
    const lh = swingHighs[swingHighs.length - 1].price;
    const ph = swingHighs[swingHighs.length - 2].price;
    const ll = swingLows[swingLows.length - 1].price;
    const pl = swingLows[swingLows.length - 2].price;

    let priorTrend = null;
    if (lh > ph && ll > pl) priorTrend = 'bullish';
    else if (lh < ph && ll < pl) priorTrend = 'bearish';

    const recentHigh = swingHighs[swingHighs.length - 1];
    const recentLow = swingLows[swingLows.length - 1];

    // Bullish 돌파 (직전 swing high 종가 돌파)
    if (recentLow.index > recentHigh.index) {
      const prevHigh = swingHighs[swingHighs.length - 1];
      if (lastCandle.close > prevHigh.price && prevCandle.close <= prevHigh.price) {
        const kind = priorTrend === 'bearish' ? 'CHoCH' : 'BOS';
        return { direction: 'bullish', kind, label: `${kind} bullish` };
      }
    }

    // Bearish 돌파 (직전 swing low 종가 돌파)
    if (recentHigh.index > recentLow.index) {
      const prevLow = swingLows[swingLows.length - 1];
      if (lastCandle.close < prevLow.price && prevCandle.close >= prevLow.price) {
        const kind = priorTrend === 'bullish' ? 'CHoCH' : 'BOS';
        return { direction: 'bearish', kind, label: `${kind} bearish` };
      }
    }

    return null;
  },

  // ========== Order Block ==========

  findOrderBlocks(candles, lookback) {
    lookback = lookback || config.ict.orderBlockLookback;
    const blocks = { bullish: [], bearish: [] };
    const start = Math.max(0, candles.length - lookback);

    for (let i = start + 2; i < candles.length; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];

      const prevBearish = prev.close < prev.open;
      const currBullish = curr.close > curr.open;
      const strongMove = (curr.close - curr.open) / curr.open > 0.002;

      if (prevBearish && currBullish && strongMove) {
        blocks.bullish.push({
          index: i - 1,
          high: prev.open,
          low: prev.close,
          mid: (prev.open + prev.close) / 2,
          timestamp: prev.timestamp,
        });
      }

      const prevBullish = prev.close > prev.open;
      const currBearish = curr.close < curr.open;
      const strongDown = (curr.open - curr.close) / curr.open > 0.002;

      if (prevBullish && currBearish && strongDown) {
        blocks.bearish.push({
          index: i - 1,
          high: prev.close,
          low: prev.open,
          mid: (prev.open + prev.close) / 2,
          timestamp: prev.timestamp,
        });
      }
    }

    return blocks;
  },

  // ========== Fair Value Gap + CE + Fill ==========

  /**
   * FVG 탐색 + Consequent Encroachment(CE) + Fill 상태 계산
   *
   * CE = FVG의 정확히 50% 지점 (기관 진입 포인트)
   * Fill = 가격이 FVG를 얼마나 채웠는지 (100% = 완전 메움)
   */
  findFairValueGaps(candles, lookback) {
    lookback = lookback || config.ict.orderBlockLookback;
    const gaps = { bullish: [], bearish: [] };
    const start = Math.max(0, candles.length - lookback);
    const currentPrice = candles[candles.length - 1].close;

    for (let i = start + 2; i < candles.length; i++) {
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];

      // Bullish FVG
      if (c1.high < c3.low) {
        const gapSize = (c3.low - c1.high) / c2.close;
        if (gapSize >= config.ict.fvgMinGapPercent / 100) {
          const top = c3.low;
          const bottom = c1.high;
          const ce = (top + bottom) / 2; // Consequent Encroachment

          // maxFillPercent: FVG 형성 이후 wick 최대 침투 깊이 (monotonic — 한번 찍히면 유지).
          //   isFilled(=invalidation) 판정 전용. "이 FVG 가 역사적으로 얼마나 건드려졌는가".
          let fillLevel = top; // FVG 상단부터 시작
          for (let k = i + 1; k < candles.length; k++) {
            if (candles[k].low < fillLevel) {
              fillLevel = candles[k].low;
            }
          }
          const maxFillPercent = fillLevel <= bottom ? 100
            : Math.max(0, ((top - fillLevel) / (top - bottom)) * 100);
          const isFilled = maxFillPercent >= 100;

          // fillPercent: 현재가 기준 FVG 내 침투 깊이. inRange 와 시간 기준 일치.
          //   0% = 현재가가 top 이상 (미접촉), 100% = 현재가가 bottom 이하.
          //   "FVG Fill 진입" 조건은 이 현재 시점 값으로 판단 → 되돌림 후 재진입이 fresh 로 인식됨.
          const fillPercent = (currentPrice >= top) ? 0
            : (currentPrice <= bottom) ? 100
            : ((top - currentPrice) / (top - bottom)) * 100;

          gaps.bullish.push({
            index: i - 1,
            top,
            bottom,
            ce,
            mid: ce,
            gapPercent: gapSize * 100,
            fillPercent: parseFloat(fillPercent.toFixed(1)),
            maxFillPercent: parseFloat(maxFillPercent.toFixed(1)),
            isFilled,
            timestamp: c2.timestamp,
            // 현재가가 CE 근처인지
            atCE: Math.abs(currentPrice - ce) / ce <= config.ict.fvgCeThreshold,
            // 현재가가 FVG 내인지
            inRange: currentPrice >= bottom && currentPrice <= top,
          });
        }
      }

      // Bearish FVG
      if (c1.low > c3.high) {
        const gapSize = (c1.low - c3.high) / c2.close;
        if (gapSize >= config.ict.fvgMinGapPercent / 100) {
          const top = c1.low;
          const bottom = c3.high;
          const ce = (top + bottom) / 2;

          let fillLevel = bottom;
          for (let k = i + 1; k < candles.length; k++) {
            if (candles[k].high > fillLevel) {
              fillLevel = candles[k].high;
            }
          }
          const fillPercent = fillLevel >= top ? 100
            : Math.max(0, ((fillLevel - bottom) / (top - bottom)) * 100);
          const isFilled = fillPercent >= 100;

          gaps.bearish.push({
            index: i - 1,
            top,
            bottom,
            ce,
            mid: ce,
            gapPercent: gapSize * 100,
            fillPercent: parseFloat(fillPercent.toFixed(1)),
            isFilled,
            timestamp: c2.timestamp,
            atCE: Math.abs(currentPrice - ce) / ce <= config.ict.fvgCeThreshold,
            inRange: currentPrice >= bottom && currentPrice <= top,
          });
        }
      }
    }

    return gaps;
  },

  // ========== IOFED (Institutional Order Flow Entry Drill) ==========

  /**
   * IOFED: 한 방향으로 연속된 봉이 나온 후 반전 시작점
   * 기관이 한 방향으로 강하게 주문을 넣은 뒤 반대로 전환하는 패턴
   *
   * Bullish IOFED: 연속 음봉 → 양봉 전환 (기관 매수 시작)
   * Bearish IOFED: 연속 양봉 → 음봉 전환 (기관 매도 시작)
   */
  detectIOFED(candles) {
    const results = [];
    const minBars = config.ict.iofedMinBars;
    const len = candles.length;
    if (len < minBars + 2) return results;

    // 최근 30봉 내에서 탐색
    const start = Math.max(0, len - 30);

    for (let i = start + minBars; i < len; i++) {
      const curr = candles[i];
      const currBullish = curr.close > curr.open;
      const currBearish = curr.close < curr.open;

      // 이전 연속 봉 체크
      let consecutiveBearish = 0;
      let consecutiveBullish = 0;

      for (let j = 1; j <= Math.min(minBars + 5, i); j++) {
        const prev = candles[i - j];
        if (prev.close < prev.open) {
          consecutiveBearish++;
        } else {
          break;
        }
      }

      for (let j = 1; j <= Math.min(minBars + 5, i); j++) {
        const prev = candles[i - j];
        if (prev.close > prev.open) {
          consecutiveBullish++;
        } else {
          break;
        }
      }

      // Bullish IOFED: 연속 음봉 후 양봉
      if (currBullish && consecutiveBearish >= minBars) {
        const drillCandle = candles[i - 1]; // 마지막 음봉
        results.push({
          type: 'bullish',
          index: i,
          entryZone: { high: drillCandle.open, low: drillCandle.close },
          consecutiveBars: consecutiveBearish,
          timestamp: curr.timestamp,
        });
      }

      // Bearish IOFED: 연속 양봉 후 음봉
      if (currBearish && consecutiveBullish >= minBars) {
        const drillCandle = candles[i - 1]; // 마지막 양봉
        results.push({
          type: 'bearish',
          index: i,
          entryZone: { high: drillCandle.close, low: drillCandle.open },
          consecutiveBars: consecutiveBullish,
          timestamp: curr.timestamp,
        });
      }
    }

    return results;
  },

  // ========== OTE ==========

  calculateOTE(swingHigh, swingLow) {
    const range = swingHigh - swingLow;
    return {
      bullish: {
        upper: swingHigh - range * config.ict.oteFibLow,
        lower: swingHigh - range * config.ict.oteFibHigh,
        mid: swingHigh - range * 0.705,
      },
      bearish: {
        upper: swingLow + range * config.ict.oteFibHigh,
        lower: swingLow + range * config.ict.oteFibLow,
        mid: swingLow + range * 0.705,
      },
    };
  },

  // ========== PDH / PDL (Previous Day High / Low) ==========

  /**
   * NY timezone 의 "오늘 자정" 에 해당하는 UTC Date 반환.
   * ICT 정통의 daily bias reset 시점. DST (EST UTC-5 / EDT UTC-4) 자동 판정.
   *
   * 구현: NY 로컬 날짜(YYYY-MM-DD)를 추출한 뒤 UTC 05:00 probe 로 EST/EDT 구분.
   *   (clock-displayed elapsed 방식은 DST 전환일에 1시간 오차 발생 — 사용 금지.)
   */
  _nyMidnight(now) {
    const dateParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const y  = parseInt(dateParts.find((p) => p.type === 'year').value, 10);
    const mo = parseInt(dateParts.find((p) => p.type === 'month').value, 10);
    const d  = parseInt(dateParts.find((p) => p.type === 'day').value, 10);

    // UTC 05:00 (EST midnight 후보) 에서 NY 시계가 00 이면 EST 기간, 01 이면 EDT 기간.
    const probe = new Date(Date.UTC(y, mo - 1, d, 5, 0, 0));
    const nyHour = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour12: false, hour: '2-digit',
    }).format(probe), 10) % 24;

    return nyHour === 0
      ? probe                                              // EST midnight = UTC 05:00
      : new Date(Date.UTC(y, mo - 1, d, 4, 0, 0));         // EDT midnight = UTC 04:00
  },

  /**
   * 전일 고가/저가 계산 (ICT 정통 NY midnight 기준)
   * 캔들 타임스탬프 기준으로 전일/오늘 데이터 필터링.
   */
  calculatePDHL(candles) {
    const now = new Date();
    const todayStart = this._nyMidnight(now);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    let pdh = -Infinity;
    let pdl = Infinity;
    let hasPrevDay = false;

    // 1차 패스: 전일 PDH/PDL 확정
    for (const c of candles) {
      const t = new Date(c.timestamp);
      if (t >= yesterdayStart && t < todayStart) {
        if (c.high > pdh) pdh = c.high;
        if (c.low < pdl) pdl = c.low;
        hasPrevDay = true;
      }
    }

    if (!hasPrevDay) return null;

    // 2차 패스: 오늘 장중 어느 봉에서든 PDH/PDL wick 스윕 + 종가 복귀 여부
    //   (마지막 봉 한정 검사로는 4h HTF 기준 몇 시간 전 sweep 을 놓침)
    let pdhSweep = false;
    let pdlSweep = false;
    for (const c of candles) {
      const t = new Date(c.timestamp);
      if (t < todayStart) continue;
      if (c.high > pdh && c.close < pdh) pdhSweep = true;
      if (c.low  < pdl && c.close > pdl) pdlSweep = true;
    }

    return {
      pdh,
      pdl,
      // PDH/PDL 을 유동성 타겟으로 사용
      pdhSweep,
      pdlSweep,
    };
  },

  // ========== Session Range ==========

  /**
   * 세션별 고가/저가 레인지 계산
   * 당일 각 세션의 레인지를 유동성 기준으로 사용
   */
  calculateSessionRanges(candles) {
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const currentPrice = candles[candles.length - 1].close;

    const ranges = {};

    for (const [key, session] of Object.entries(config.sessions)) {
      const [sh, sm] = session.full.start.split(':').map(Number);
      const [eh, em] = session.full.end.split(':').map(Number);
      const sessionStart = new Date(todayStart.getTime() + (sh * 60 + sm) * 60000);
      const sessionEnd = new Date(todayStart.getTime() + (eh * 60 + em) * 60000);

      let high = -Infinity;
      let low = Infinity;
      let hasData = false;

      for (const c of candles) {
        const t = new Date(c.timestamp);
        if (t >= sessionStart && t < sessionEnd) {
          if (c.high > high) high = c.high;
          if (c.low < low) low = c.low;
          hasData = true;
        }
      }

      if (hasData && high !== -Infinity) {
        ranges[key] = {
          name: session.name,
          high,
          low,
          mid: (high + low) / 2,
          range: high - low,
          // 현재가 대비 위치
          aboveHigh: currentPrice > high,
          belowLow: currentPrice < low,
          highSweep: candles[candles.length - 1].high > high && currentPrice < high,
          lowSweep: candles[candles.length - 1].low < low && currentPrice > low,
        };
      }
    }

    return ranges;
  },

  // ========== Liquidity Sweep ==========

  /**
   * 유동성 스윕 감지 (BSL / SSL 라벨링)
   *  - BSL (Buy-Side Liquidity)  : swing high 위 stop을 쓸어가는 상승 wick → 하락 반전 신호
   *  - SSL (Sell-Side Liquidity) : swing low 아래 stop을 쓸어가는 하락 wick → 상승 반전 신호
   */
  detectLiquiditySweep(candles, swingHighs, swingLows) {
    const sweeps = [];
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    for (const sh of swingHighs.slice(-3)) {
      if (last.high > sh.price && last.close < sh.price && prev.close < sh.price) {
        sweeps.push({
          type: 'bearish',
          liquidity: 'BSL',
          label: 'BSL sweep',
          level: sh.price,
          wick: last.high,
        });
      }
    }

    for (const sl of swingLows.slice(-3)) {
      if (last.low < sl.price && last.close > sl.price && prev.close > sl.price) {
        sweeps.push({
          type: 'bullish',
          liquidity: 'SSL',
          label: 'SSL sweep',
          level: sl.price,
          wick: last.low,
        });
      }
    }

    return sweeps;
  },

  // ========== Session Time Check ==========

  /**
   * 현재 시간이 활성 세션 내인지 확인
   * - 점심시간 제외
   * - 주말 제외 (토/일)
   */
  getActiveSession(now) {
    now = now || new Date();

    // 주말 체크 (0=일, 6=토)
    const dayOfWeek = now.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { active: false, session: null, reason: '주말 - 세션 휴장' };
    }

    const utcH = now.getUTCHours();
    const utcM = now.getUTCMinutes();
    const utcTime = utcH * 60 + utcM;

    for (const [key, session] of Object.entries(config.sessions)) {
      // AM 세션 체크
      const [amSh, amSm] = session.am.start.split(':').map(Number);
      const [amEh, amEm] = session.am.end.split(':').map(Number);
      const amStart = amSh * 60 + amSm;
      const amEnd = amEh * 60 + amEm;

      if (utcTime >= amStart && utcTime < amEnd) {
        return { active: true, session: key, period: 'am', name: `${session.name} AM` };
      }

      // PM 세션 체크
      const [pmSh, pmSm] = session.pm.start.split(':').map(Number);
      const [pmEh, pmEm] = session.pm.end.split(':').map(Number);
      const pmStart = pmSh * 60 + pmSm;
      const pmEnd = pmEh * 60 + pmEm;

      if (utcTime >= pmStart && utcTime < pmEnd) {
        return { active: true, session: key, period: 'pm', name: `${session.name} PM` };
      }

      // 점심시간 체크
      if (utcTime >= amEnd && utcTime < pmStart) {
        return { active: false, session: key, reason: `${session.name} 점심시간` };
      }
    }

    return { active: false, session: null, reason: '세션 외 시간' };
  },

  // 하위 호환: isInKillZone → getActiveSession 래핑
  isInKillZone(now) {
    const session = this.getActiveSession(now);
    return {
      active: session.active,
      zone: session.active ? session.name : null,
    };
  },
};

module.exports = indicators;
