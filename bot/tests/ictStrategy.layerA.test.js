/**
 * Layer A (블랙박스) — strategy.analyze() end-to-end.
 *
 * Phase 1 Quick Wins 대상:
 *  - ICT-01 (a): 현재가 > FVG top + CE 절대값 근접 → FVG_CE entry 발동 안 되어야 함
 *  - ICT-01 (b): 현재가 ∈ [bottom, top] + CE 근접 → entry 정상 발동
 *  - 공통 계약: _calculateSLTP 가 sl=null 반환 시 analyze 가 반드시 signal=null
 *
 * 접근: indicators 를 전면 mock — 합성 candle 로 원하는 출력 유도하기 어려우므로
 *       indicatorsPatch 로 순수 strategy 로직만 검증 (indicators 기능은 별도 모듈
 *       책임, 본 Phase 1 스코프 밖).
 *
 * v3 Hard Gate 대응:
 *   - 기본 mock 은 Gate 1 (HTF MSS), Gate 2 (PDH sweep), Gate 3 (MTF MSS aligned)
 *     를 모두 통과시켜 LTF entry trigger 검증 (ICT-01) 에 집중.
 *   - swingHighs 의 상단을 103 으로 잡아 nearest TP R:R ≥ 1.0 floor 통과.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStrategy } = require('./helpers/loadStrategy');
const { priceSeries, uptrend } = require('./helpers/candles');

/**
 * analyze() 가 FVG CE entry 경로까지 도달하도록 세팅된 indicators mock.
 * FVG 는 호출자가 overrides.fvg 로 주입.
 *
 * swingsFarFromPrice=true: swingHighs/Lows 를 price(≈100) 에서 크게 떨어뜨려
 *   _calculateSLTP 의 LTF swing SL 후보 체인이 maxRiskPct 가드에서 전부 탈락하도록 함.
 *   → "폴백 경로 도달 → RISK-01 가드 발동" 검증용.
 *   기본값 false 는 현실적 근접 swing (FVG CE 해피 패스 검증용).
 */
function makeIndicatorsMock({
  fvg,
  session = { active: true, session: 'ny', name: 'NY AM' },
  swingsFarFromPrice = false,
} = {}) {
  const swingHighs = swingsFarFromPrice
    ? [
        { index: 10, price: 50, timestamp: 0 },
        { index: 30, price: 60, timestamp: 0 },   // HH (둘 다 price 대비 훨씬 아래)
      ]
    : [
        { index: 10, price: 99.5, timestamp: 0 },
        // v3: nearest TP R:R floor 1.0 통과 위해 상단을 103 으로 (price ~100, risk ~2 → R:R ~1.5).
        { index: 30, price: 103,  timestamp: 0 },
      ];
  const swingLows = swingsFarFromPrice
    ? [
        { index: 5,  price: 50, timestamp: 0 },
        { index: 25, price: 60, timestamp: 0 },   // HL (price 대비 멀어서 maxRiskPct 초과 확정)
      ]
    : [
        { index: 5,  price: 98, timestamp: 0 },
        { index: 25, price: 99, timestamp: 0 },   // HL → bullish swing pattern
      ];

  return {
    getActiveSession:   () => session,
    findSwingHighs:     () => swingHighs,
    findSwingLows:      () => swingLows,
    // v3 Gate 2: PDH Sweep 으로 HTF backing 충족 (Active POI 부재 시 Sweep 폴백 경로).
    calculatePDHL:      () => ({ pdh: 105, pdl: 95, pdhSweep: true, pdlSweep: false }),
    // v3 Gate 1/3: bullish CHoCH 반환 → HTF direction=bullish + MTF MSS aligned 충족.
    detectMarketStructureShift: () => ({
      direction: 'bullish', kind: 'CHoCH', label: 'CHoCH bullish', breakIndex: 50,
    }),
    findOrderBlocks:    () => ({ bullish: [], bearish: [] }),
    findFairValueGaps:  () => ({ bullish: fvg ? [fvg] : [], bearish: [] }),
    detectLiquiditySweep: () => [],
    detectIOFED:        () => [],
    calculateSessionRanges: () => ({}),
  };
}

// 합성 candle 은 length 체크 통과 + currentPrice 주입 용도만.
function makeCandles(currentPrice, count = 60) {
  const base = uptrend({ basePrice: currentPrice * 0.95, count, stepPct: 0.001 });
  base[base.length - 1] = { ...base[base.length - 1], close: currentPrice };
  return base;
}

// ───────────────────────────────────────────────────────────────────────────
// ICT-01 (a) — currentPrice > FVG top + atCE 근접 → entry 발동 안 되어야 함
// ───────────────────────────────────────────────────────────────────────────
test('ICT-01 (a): FVG 외부 + CE 근접만으로는 FVG_CE entry 발동되지 않아야 함', () => {
  const currentPrice = 100.12;
  // FVG: bottom=99.95, top=100.10, ce=100.025 (gap 0.15% > fvgMinGapPercent 0.05%)
  // currentPrice(100.12) > top(100.10) → inRange=false
  // |100.12 - 100.025| / 100.025 = 0.095% < 0.15% → atCE=true
  const fvg = {
    bottom: 99.95, top: 100.10, ce: 100.025,
    atCE: true, inRange: false, isFilled: false, fillPercent: 0, maxFillPercent: 0,
    gapPercent: 0.15, index: 40, timestamp: 0, mid: 100.025,
  };

  const { strategy } = loadStrategy({
    indicatorsPatch: makeIndicatorsMock({ fvg }),
  });

  const candles = makeCandles(currentPrice);
  const result = strategy.analyze({ htf: candles, mtf: candles, ltf: candles });

  // AFTER FIX: FVG CE entry 가 inRange 없이 발동되면 안 됨
  // 다른 entry 경로 (Fill/IOFED/sweep+MSS) 모두 차단된 mock 상태에서
  // signal 은 null 이어야 함 (FVG CE/Fill/IOFED 미충족 reason).
  assert.equal(result.signal, null,
    `signal 은 null 이어야 함. 받은 값: signal=${result.signal}, reason=${result.reason}`);
});

// ───────────────────────────────────────────────────────────────────────────
// ICT-01 (b) — currentPrice ∈ [bottom, top] + CE 근접 → entry 정상 발동
// ───────────────────────────────────────────────────────────────────────────
test('ICT-01 (b): FVG 내부 + CE 근접 → FVG_CE entry 정상 발동 (happy path 회귀 방지)', () => {
  const currentPrice = 100.025;  // = ce, 완전 내부
  const fvg = {
    bottom: 99.95, top: 100.10, ce: 100.025,
    atCE: true, inRange: true, isFilled: false, fillPercent: 50, maxFillPercent: 50,
    gapPercent: 0.15, index: 40, timestamp: 0, mid: 100.025,
  };

  const { strategy } = loadStrategy({
    indicatorsPatch: makeIndicatorsMock({ fvg }),
  });

  const candles = makeCandles(currentPrice);
  const result = strategy.analyze({ htf: candles, mtf: candles, ltf: candles });

  // Happy path: FVG CE entry 정상 발동 → long signal
  assert.equal(result.signal, 'long',
    `signal 은 long 이어야 함. 받은 값: signal=${result.signal}, reason=${result.reason}`);
  // entryType 은 confluence 안에 'LTF FVG CE' 포함되어야 함
  assert.ok(result.confluence.some(c => /LTF FVG CE/.test(c)),
    `confluence 에 LTF FVG CE 가 있어야 함. 받은 값: ${JSON.stringify(result.confluence)}`);
});

// ───────────────────────────────────────────────────────────────────────────
// 공통 계약 — _calculateSLTP sl=null 반환 → analyze signal=null
//   트리거 경로: RISK-01 폴백 차단 (fallbackRisk > maxRiskPct).
//   향후 ICT-01 / RISK-02 경로별 sl=null 통합 검증 추가 여지 남김.
// ───────────────────────────────────────────────────────────────────────────
test('공통 계약: _calculateSLTP 가 sl=null 반환 시 analyze() 가 signal=null 반환 (RISK-01 폴백 차단 경로로 트리거)', () => {
  // FVG CE 정상 발동 → _calculateSLTP 호출까지 도달.
  //
  // sl=null 유도 경로:
  //   price=100.025, maxRiskPct=3% → _slCandidateWithRisk 허용 범위 ≈ [97.02, 103.08]
  //   swingLows=[50, 60] 은 maxRiskPct 를 명확히 초과 → _slCandidateWithRisk 가 null 반환
  //   → 모든 구조적 SL 후보 체인 탈락 (HTF OB=[], MTF OB=[], IOFED=null, LTF swing 탈락, PDL=null)
  //   → 폴백 경로 도달 → fallback=price*(1-slPct)=95.024, fallbackRisk=5% > maxRiskPct=3%
  //   → RISK-01 가드 발동 → sl=null, tpSource='risk-cap-violation'
  //   → analyze() L108 skip 분기 → signal=null, reason='risk-cap-violation'.
  const currentPrice = 100.025;
  const fvg = {
    bottom: 99.95, top: 100.10, ce: 100.025,
    atCE: true, inRange: true, isFilled: false, fillPercent: 50, maxFillPercent: 50,
    gapPercent: 0.15, index: 40, timestamp: 0, mid: 100.025,
  };

  const { strategy } = loadStrategy({
    config: { stopLossPercent: 5, ict: { maxRiskPct: 0.03 } },
    indicatorsPatch: makeIndicatorsMock({ fvg, swingsFarFromPrice: true }),
  });

  const candles = makeCandles(currentPrice);
  const result = strategy.analyze({ htf: candles, mtf: candles, ltf: candles });

  assert.equal(result.signal, null,
    `sl=null 이면 signal 반드시 null. 받은 값: signal=${result.signal}, reason=${result.reason}`);
  // v3: reason 은 '[Gate 5] <tpSource>' 포맷. RISK-01 경로는 'risk-cap-violation'.
  assert.equal(result.reason, '[Gate 5] risk-cap-violation',
    `RISK-01 경로는 reason='[Gate 5] risk-cap-violation' 이어야 함. 받은 reason: ${result.reason}`);
});
