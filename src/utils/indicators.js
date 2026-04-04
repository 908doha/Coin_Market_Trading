const config = require('../config');

/**
 * ICT (Inner Circle Trading) 기술적 지표 모듈
 *
 * 구현 지표:
 * - Swing High / Low (스윙 고점/저점)
 * - Market Structure Shift (시장 구조 전환)
 * - Order Block (오더블록)
 * - Fair Value Gap (공정가치 갭)
 * - Optimal Trade Entry (최적 진입 구간)
 * - Kill Zone (킬존 시간대)
 * - Liquidity Sweep (유동성 스윕)
 */
const indicators = {
  /**
   * 스윙 하이 포인트 탐색
   * 양쪽으로 n개 봉보다 높은 고점
   */
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

  /**
   * 스윙 로우 포인트 탐색
   * 양쪽으로 n개 봉보다 낮은 저점
   */
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

  /**
   * Market Structure Shift (MSS) 감지
   * 직전 스윙 하이/로우를 돌파하면 구조 전환으로 판단
   *
   * 반환: 'bullish' | 'bearish' | null
   */
  detectMarketStructureShift(candles, swingHighs, swingLows) {
    if (swingHighs.length < 2 || swingLows.length < 2) return null;

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const recentHigh = swingHighs[swingHighs.length - 1];
    const recentLow = swingLows[swingLows.length - 1];

    // 하락 추세에서 직전 스윙 하이를 상방 돌파 → Bullish MSS
    if (recentLow.index > recentHigh.index) {
      // 최근 저점이 고점 이후에 형성 = 하락 구조
      const prevHigh = swingHighs[swingHighs.length - 1];
      if (lastCandle.close > prevHigh.price && prevCandle.close <= prevHigh.price) {
        return 'bullish';
      }
    }

    // 상승 추세에서 직전 스윙 로우를 하방 돌파 → Bearish MSS
    if (recentHigh.index > recentLow.index) {
      // 최근 고점이 저점 이후에 형성 = 상승 구조
      const prevLow = swingLows[swingLows.length - 1];
      if (lastCandle.close < prevLow.price && prevCandle.close >= prevLow.price) {
        return 'bearish';
      }
    }

    return null;
  },

  /**
   * Order Block (오더블록) 탐색
   * - Bullish OB: 큰 하락 후 강한 반전 상승이 시작된 마지막 음봉 구간
   * - Bearish OB: 큰 상승 후 강한 반전 하락이 시작된 마지막 양봉 구간
   */
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

      // Bullish Order Block: 음봉 → 강한 양봉
      if (prevBearish && currBullish && strongMove) {
        blocks.bullish.push({
          index: i - 1,
          high: prev.open,   // 음봉의 시가 (OB 상단)
          low: prev.close,   // 음봉의 종가 (OB 하단)
          mid: (prev.open + prev.close) / 2,
          timestamp: prev.timestamp,
        });
      }

      const prevBullish = prev.close > prev.open;
      const currBearish = curr.close < curr.open;
      const strongDown = (curr.open - curr.close) / curr.open > 0.002;

      // Bearish Order Block: 양봉 → 강한 음봉
      if (prevBullish && currBearish && strongDown) {
        blocks.bearish.push({
          index: i - 1,
          high: prev.close,  // 양봉의 종가 (OB 상단)
          low: prev.open,    // 양봉의 시가 (OB 하단)
          mid: (prev.open + prev.close) / 2,
          timestamp: prev.timestamp,
        });
      }
    }

    return blocks;
  },

  /**
   * Fair Value Gap (FVG / 공정가치 갭) 탐색
   * 3봉 패턴: 1번봉과 3번봉 사이에 2번봉이 커버하지 못하는 갭
   */
  findFairValueGaps(candles, lookback) {
    lookback = lookback || config.ict.orderBlockLookback;
    const gaps = { bullish: [], bearish: [] };
    const start = Math.max(0, candles.length - lookback);

    for (let i = start + 2; i < candles.length; i++) {
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];

      // Bullish FVG: 1번봉 고가 < 3번봉 저가 (갭 상승)
      if (c1.high < c3.low) {
        const gapSize = (c3.low - c1.high) / c2.close;
        if (gapSize >= config.ict.fvgMinGapPercent / 100) {
          gaps.bullish.push({
            index: i - 1,
            top: c3.low,
            bottom: c1.high,
            mid: (c3.low + c1.high) / 2,
            gapPercent: gapSize * 100,
            timestamp: c2.timestamp,
          });
        }
      }

      // Bearish FVG: 1번봉 저가 > 3번봉 고가 (갭 하락)
      if (c1.low > c3.high) {
        const gapSize = (c1.low - c3.high) / c2.close;
        if (gapSize >= config.ict.fvgMinGapPercent / 100) {
          gaps.bearish.push({
            index: i - 1,
            top: c1.low,
            bottom: c3.high,
            mid: (c1.low + c3.high) / 2,
            gapPercent: gapSize * 100,
            timestamp: c2.timestamp,
          });
        }
      }
    }

    return gaps;
  },

  /**
   * Optimal Trade Entry (OTE) 구간 계산
   * 피보나치 되돌림 0.62 ~ 0.79 구간
   */
  calculateOTE(swingHigh, swingLow) {
    const range = swingHigh - swingLow;
    return {
      // Bullish OTE: 고점에서 되돌림 (매수 구간)
      bullish: {
        upper: swingHigh - range * config.ict.oteFibLow,  // 0.62 되돌림
        lower: swingHigh - range * config.ict.oteFibHigh,  // 0.79 되돌림
        mid: swingHigh - range * 0.705,                    // 중간값
      },
      // Bearish OTE: 저점에서 되돌림 (매도 구간)
      bearish: {
        upper: swingLow + range * config.ict.oteFibHigh,   // 0.79 되돌림
        lower: swingLow + range * config.ict.oteFibLow,    // 0.62 되돌림
        mid: swingLow + range * 0.705,                     // 중간값
      },
    };
  },

  /**
   * Liquidity Sweep (유동성 스윕) 감지
   * 스윙 포인트를 일시적으로 돌파 후 다시 복귀하는 패턴
   */
  detectLiquiditySweep(candles, swingHighs, swingLows) {
    const sweeps = [];
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    // 스윙 하이 위로 스윕 후 다시 아래로 (Bearish Sweep)
    for (const sh of swingHighs.slice(-3)) {
      if (last.high > sh.price && last.close < sh.price && prev.close < sh.price) {
        sweeps.push({ type: 'bearish', level: sh.price, wick: last.high });
      }
    }

    // 스윙 로우 아래로 스윕 후 다시 위로 (Bullish Sweep)
    for (const sl of swingLows.slice(-3)) {
      if (last.low < sl.price && last.close > sl.price && prev.close > sl.price) {
        sweeps.push({ type: 'bullish', level: sl.price, wick: last.low });
      }
    }

    return sweeps;
  },

  /**
   * 현재 시간이 Kill Zone 내인지 확인
   */
  isInKillZone(now) {
    now = now || new Date();
    const utcH = now.getUTCHours();
    const utcM = now.getUTCMinutes();
    const utcTime = utcH * 60 + utcM;

    for (const [name, zone] of Object.entries(config.killZones)) {
      const [sh, sm] = zone.start.split(':').map(Number);
      const [eh, em] = zone.end.split(':').map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;

      if (utcTime >= start && utcTime < end) {
        return { active: true, zone: name };
      }
    }

    return { active: false, zone: null };
  },
};

module.exports = indicators;
