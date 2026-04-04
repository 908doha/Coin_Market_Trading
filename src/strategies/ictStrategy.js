const indicators = require('../utils/indicators');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * ICT (Inner Circle Trading) 전략
 *
 * 진입 조건 (Long):
 *  1. Kill Zone 시간대 내
 *  2. Bullish MSS (시장 구조 전환) 또는 Bullish Liquidity Sweep 감지
 *  3. 현재가가 Bullish Order Block 또는 Bullish FVG 영역 내
 *  4. 현재가가 OTE (0.62~0.79 피보나치 되돌림) 구간 내
 *
 * 진입 조건 (Short):
 *  1. Kill Zone 시간대 내
 *  2. Bearish MSS 또는 Bearish Liquidity Sweep 감지
 *  3. 현재가가 Bearish Order Block 또는 Bearish FVG 영역 내
 *  4. 현재가가 OTE 구간 내
 *
 * 손절/익절:
 *  - SL: 오더블록/FVG 반대편 또는 설정 비율
 *  - TP: 반대편 유동성 레벨 또는 설정 비율 (R:R 최소 1:2)
 */
class IctStrategy {
  constructor() {
    this.name = 'ICT Strategy';
  }

  /**
   * 캔들 데이터를 분석하여 매매 신호 생성
   * @param {Array} candles - OHLCV 캔들 데이터
   * @returns {{ signal: 'long'|'short'|null, reason: string, entry: number, sl: number, tp: number, confluence: string[] }}
   */
  analyze(candles) {
    if (candles.length < config.ict.orderBlockLookback) {
      logger.warn('캔들 데이터 부족');
      return { signal: null, reason: '데이터 부족' };
    }

    const currentPrice = candles[candles.length - 1].close;
    const confluence = [];

    // 1. Kill Zone 확인
    const killZone = indicators.isInKillZone();
    if (!killZone.active) {
      return { signal: null, reason: `Kill Zone 외 시간대 (현재 비활성)` };
    }
    confluence.push(`Kill Zone: ${killZone.zone}`);

    // 2. 스윙 포인트 탐색
    const swingHighs = indicators.findSwingHighs(candles, config.ict.structureShiftBars);
    const swingLows = indicators.findSwingLows(candles, config.ict.structureShiftBars);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { signal: null, reason: '스윙 포인트 부족' };
    }

    // 3. Market Structure Shift 감지
    const mss = indicators.detectMarketStructureShift(candles, swingHighs, swingLows);

    // 4. Liquidity Sweep 감지
    const sweeps = indicators.detectLiquiditySweep(candles, swingHighs, swingLows);

    // 5. Order Block 탐색
    const orderBlocks = indicators.findOrderBlocks(candles);

    // 6. Fair Value Gap 탐색
    const fvgs = indicators.findFairValueGaps(candles);

    // 7. OTE 계산
    const recentHigh = swingHighs[swingHighs.length - 1].price;
    const recentLow = swingLows[swingLows.length - 1].price;
    const ote = indicators.calculateOTE(recentHigh, recentLow);

    // === Long 신호 판단 ===
    const longSignal = this._checkLong(currentPrice, mss, sweeps, orderBlocks, fvgs, ote, confluence);
    if (longSignal) return longSignal;

    // === Short 신호 판단 ===
    const shortSignal = this._checkShort(currentPrice, mss, sweeps, orderBlocks, fvgs, ote, confluence);
    if (shortSignal) return shortSignal;

    return { signal: null, reason: 'ICT 조건 불충족', confluence };
  }

  _checkLong(price, mss, sweeps, orderBlocks, fvgs, ote, baseConfluence) {
    const confluence = [...baseConfluence];
    let structureSignal = false;

    // MSS 확인
    if (mss === 'bullish') {
      confluence.push('Bullish MSS (시장 구조 전환)');
      structureSignal = true;
    }

    // Liquidity Sweep 확인
    const bullishSweep = sweeps.find((s) => s.type === 'bullish');
    if (bullishSweep) {
      confluence.push(`Bullish Liquidity Sweep @ ${bullishSweep.level.toFixed(2)}`);
      structureSignal = true;
    }

    if (!structureSignal) return null;

    // Order Block 영역 확인
    const inBullishOB = orderBlocks.bullish.find(
      (ob) => price >= ob.low && price <= ob.high
    );
    if (inBullishOB) {
      confluence.push(`Bullish OB [${inBullishOB.low.toFixed(2)} - ${inBullishOB.high.toFixed(2)}]`);
    }

    // FVG 영역 확인
    const inBullishFVG = fvgs.bullish.find(
      (fvg) => price >= fvg.bottom && price <= fvg.top
    );
    if (inBullishFVG) {
      confluence.push(`Bullish FVG [${inBullishFVG.bottom.toFixed(2)} - ${inBullishFVG.top.toFixed(2)}]`);
    }

    // OTE 구간 확인
    const inOTE = price >= ote.bullish.lower && price <= ote.bullish.upper;
    if (inOTE) {
      confluence.push(`OTE 구간 [${ote.bullish.lower.toFixed(2)} - ${ote.bullish.upper.toFixed(2)}]`);
    }

    // 최소 3개 컨플루언스 충족 시 진입 (Kill Zone + 구조 + OB/FVG/OTE 중 하나)
    if (confluence.length >= 3 && (inBullishOB || inBullishFVG || inOTE)) {
      const sl = inBullishOB
        ? inBullishOB.low * (1 - config.stopLossPercent / 100 * 0.5)
        : price * (1 - config.stopLossPercent / 100);
      const riskAmount = price - sl;
      const tp = price + riskAmount * 2; // R:R = 1:2

      return {
        signal: 'long',
        reason: `ICT Long - ${confluence.length}개 컨플루언스 충족`,
        entry: price,
        sl: parseFloat(sl.toFixed(2)),
        tp: parseFloat(tp.toFixed(2)),
        confluence,
      };
    }

    return null;
  }

  _checkShort(price, mss, sweeps, orderBlocks, fvgs, ote, baseConfluence) {
    const confluence = [...baseConfluence];
    let structureSignal = false;

    // MSS 확인
    if (mss === 'bearish') {
      confluence.push('Bearish MSS (시장 구조 전환)');
      structureSignal = true;
    }

    // Liquidity Sweep 확인
    const bearishSweep = sweeps.find((s) => s.type === 'bearish');
    if (bearishSweep) {
      confluence.push(`Bearish Liquidity Sweep @ ${bearishSweep.level.toFixed(2)}`);
      structureSignal = true;
    }

    if (!structureSignal) return null;

    // Order Block 영역 확인
    const inBearishOB = orderBlocks.bearish.find(
      (ob) => price >= ob.low && price <= ob.high
    );
    if (inBearishOB) {
      confluence.push(`Bearish OB [${inBearishOB.low.toFixed(2)} - ${inBearishOB.high.toFixed(2)}]`);
    }

    // FVG 영역 확인
    const inBearishFVG = fvgs.bearish.find(
      (fvg) => price >= fvg.bottom && price <= fvg.top
    );
    if (inBearishFVG) {
      confluence.push(`Bearish FVG [${inBearishFVG.bottom.toFixed(2)} - ${inBearishFVG.top.toFixed(2)}]`);
    }

    // OTE 구간 확인
    const inOTE = price >= ote.bearish.lower && price <= ote.bearish.upper;
    if (inOTE) {
      confluence.push(`OTE 구간 [${ote.bearish.lower.toFixed(2)} - ${ote.bearish.upper.toFixed(2)}]`);
    }

    // 최소 3개 컨플루언스 충족 시 진입
    if (confluence.length >= 3 && (inBearishOB || inBearishFVG || inOTE)) {
      const sl = inBearishOB
        ? inBearishOB.high * (1 + config.stopLossPercent / 100 * 0.5)
        : price * (1 + config.stopLossPercent / 100);
      const riskAmount = sl - price;
      const tp = price - riskAmount * 2; // R:R = 1:2

      return {
        signal: 'short',
        reason: `ICT Short - ${confluence.length}개 컨플루언스 충족`,
        entry: price,
        sl: parseFloat(sl.toFixed(2)),
        tp: parseFloat(tp.toFixed(2)),
        confluence,
      };
    }

    return null;
  }
}

module.exports = IctStrategy;
