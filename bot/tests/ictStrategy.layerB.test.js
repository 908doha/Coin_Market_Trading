/**
 * Layer B (화이트박스) — _calculateSLTP 직접 호출.
 *
 * Phase 1 Quick Wins 대상:
 *  - RISK-01: 구조적 SL 후보 전부 탈락 + 폴백 > maxRiskPct → sl=null, tpSource='risk-cap-violation'
 *  - RISK-02: slPct=0 → risk=0 → sl=null, tpSource='risk-zero'
 *  - 정상 경로: 구조적 후보 or 가드 통과 폴백 → 유효 sl/tp/rr 반환
 *
 * 주의: 본 테스트는 **수정 전에는 실패해야 한다** (현재 코드는 sl=null 을 반환하지 않음).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStrategy } = require('./helpers/loadStrategy');

// _calculateSLTP 가 참조하는 최소 필드만 채운 lean 구조체.
function emptyHtfBias() {
  return {
    orderBlocks:   [],
    opposingOBs:   [],
    fvgs:          [],
    opposingFVGs:  [],
    swingHighs:    [],
    swingLows:     [],
    pdhl:          null,
    htfActiveSweep: null,
    direction:     'bullish',
  };
}
function emptyMtfStructure() {
  return { orderBlocks: [], opposingOBs: [] };
}
function emptyLtfEntry() {
  return { swingHighs: [], swingLows: [], iofedZone: null };
}

// ───────────────────────────────────────────────────────────────────────────
// RISK-01 (a) — 폴백도 maxRiskPct 초과 → entry 차단 (sl=null)
// ───────────────────────────────────────────────────────────────────────────
test('RISK-01 (a): 구조 후보 전부 탈락 + 폴백 SL risk > maxRiskPct → sl=null, tpSource=risk-cap-violation', () => {
  // slPct(5%) > maxRiskPct(3%) → 폴백이 가드 초과
  const { strategy } = loadStrategy({
    config: { stopLossPercent: 5, ict: { maxRiskPct: 0.03 } },
  });

  const result = strategy._calculateSLTP(
    100,          // price
    'bullish',
    emptyMtfStructure(),
    emptyLtfEntry(),
    emptyHtfBias(),
  );

  assert.equal(result.sl, null, 'sl 은 null 이어야 함');
  assert.equal(result.tp, null, 'tp 는 null 이어야 함');
  assert.equal(result.rr, 0,    'rr 은 0 이어야 함');
  assert.equal(result.tpSource, 'risk-cap-violation');
});

// ───────────────────────────────────────────────────────────────────────────
// RISK-01 (b) — 폴백이 maxRiskPct 이내 → 폴백 SL 사용
// ───────────────────────────────────────────────────────────────────────────
test('RISK-01 (b): 구조 후보 탈락했지만 폴백 risk ≤ maxRiskPct → 폴백 SL 사용 (sl 유효)', () => {
  // slPct(2%) < maxRiskPct(3%) → 폴백 가드 통과
  const { strategy } = loadStrategy({
    config: { stopLossPercent: 2, ict: { maxRiskPct: 0.03 } },
  });

  // v3: TP 도 NEAREST 구조적 후보 + R:R floor 1.0 검증.
  //   SL 폴백 (98) → risk=2. swing high 103 = nearest TP, R:R=(103-100)/2=1.5 ≥ 1.0 통과.
  const htfBias = emptyHtfBias();
  htfBias.swingHighs = [{ price: 103 }];

  const result = strategy._calculateSLTP(
    100, 'bullish',
    emptyMtfStructure(),
    emptyLtfEntry(),
    htfBias,
  );

  assert.ok(result.sl !== null, 'sl 은 유효해야 함');
  assert.ok(Math.abs(result.sl - 98) < 0.01, `sl ≈ 98 이어야 함, got ${result.sl}`);
  assert.ok(result.tp !== null && result.tp > 100, 'tp 는 price 위');
  assert.ok(Math.abs(result.tp - 103) < 0.01, `nearest TP=103, got ${result.tp}`);
  assert.ok(result.rr > 0);
});

// ───────────────────────────────────────────────────────────────────────────
// RISK-01 (c) — 정상 경로: 구조적 SL 후보 존재
// ───────────────────────────────────────────────────────────────────────────
test('RISK-01 (c): 구조적 SL 후보 존재 + maxRiskPct 이내 → 구조적 SL 선택', () => {
  const { strategy } = loadStrategy({
    config: { stopLossPercent: 2, ict: { maxRiskPct: 0.03 } },
  });

  const htfBias = emptyHtfBias();
  htfBias.orderBlocks  = [{ low: 99, high: 99.5 }];    // SL 후보: 99 * (1-0.001) = 98.901
  htfBias.opposingOBs  = [{ low: 105, high: 106 }];    // TP 후보
  htfBias.swingHighs   = [{ price: 103 }];             // TP 추가 후보

  const result = strategy._calculateSLTP(
    100, 'bullish',
    emptyMtfStructure(),
    emptyLtfEntry(),
    htfBias,
  );

  assert.ok(result.sl !== null);
  // 구조적 SL = 99 * 0.999 = 98.901 (0.1% margin)
  assert.ok(Math.abs(result.sl - 98.901) < 0.01, `구조적 SL ≈ 98.901, got ${result.sl}`);
  assert.ok(result.tp > 100);
  assert.notEqual(result.tpSource, 'risk-cap-violation');
  assert.notEqual(result.tpSource, 'risk-zero');
});

// ───────────────────────────────────────────────────────────────────────────
// RISK-02 — slPct=0 → risk=0 → sl=null, tpSource='risk-zero'
// ───────────────────────────────────────────────────────────────────────────
test('RISK-02: slPct=0 → risk=0 감지 → sl=null, tpSource=risk-zero', () => {
  const { strategy } = loadStrategy({
    config: { stopLossPercent: 0, ict: { maxRiskPct: 0.03 } },
  });

  const result = strategy._calculateSLTP(
    100, 'bullish',
    emptyMtfStructure(),
    emptyLtfEntry(),
    emptyHtfBias(),
  );

  assert.equal(result.sl, null);
  assert.equal(result.tp, null);
  assert.equal(result.rr, 0);
  assert.equal(result.tpSource, 'risk-zero');
});

// ───────────────────────────────────────────────────────────────────────────
// RISK-01 대칭 — bearish 방향도 동일 계약
// ───────────────────────────────────────────────────────────────────────────
test('RISK-01 (a, bearish): bearish 방향도 폴백 초과 시 sl=null', () => {
  const { strategy } = loadStrategy({
    config: { stopLossPercent: 5, ict: { maxRiskPct: 0.03 } },
  });

  const htfBias = emptyHtfBias();
  htfBias.direction = 'bearish';

  const result = strategy._calculateSLTP(
    100, 'bearish',
    emptyMtfStructure(),
    emptyLtfEntry(),
    htfBias,
  );

  assert.equal(result.sl, null);
  assert.equal(result.tpSource, 'risk-cap-violation');
});
