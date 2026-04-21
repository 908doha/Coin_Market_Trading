/**
 * 합성 OHLC 캔들 factory — 의도 기반 DSL.
 *
 * 원칙:
 *  - 매직 시나리오 이름 금지. 각 인자는 기하/가격 의미가 명확해야 함.
 *  - 케이스별 구체 수치는 테스트 파일에 직접 명시.
 *
 * 캔들 스키마 (indicators.js 기대): { open, high, low, close, timestamp }
 */

const BAR_MS = 60 * 1000; // 기본 1분 (테스트 전용, 실제 timeframe 무관)

/**
 * 지정 가격 배열을 OHLC 캔들로 변환. wick 은 0.05% 너비로 부여.
 * open 은 직전 close (첫 봉은 closes[0]), close 는 closes[i].
 *
 * 예: priceSeries([100, 101, 102, 101.5])
 *     → [{o:100, h:100.05, l:99.95, c:100}, {o:100, h:101.05, l:99.95, c:101}, ...]
 */
function priceSeries(closes, { startTs = 0, wickPct = 0.0005 } = {}) {
  const candles = [];
  for (let i = 0; i < closes.length; i++) {
    const close = closes[i];
    const open  = i === 0 ? close : closes[i - 1];
    const hi    = Math.max(open, close) * (1 + wickPct);
    const lo    = Math.min(open, close) * (1 - wickPct);
    candles.push({
      open,
      close,
      high: hi,
      low:  lo,
      timestamp: startTs + i * BAR_MS,
    });
  }
  return candles;
}

/**
 * 단조 상승 시퀀스 (bullish trend) — swing high/low 감지 + MSS 재료.
 * count 봉, basePrice 시작, stepPct 봉당 상승률.
 */
function uptrend({ basePrice = 100, count = 60, stepPct = 0.002 } = {}) {
  const closes = [];
  let p = basePrice;
  for (let i = 0; i < count; i++) {
    closes.push(p);
    p *= (1 + stepPct);
  }
  return priceSeries(closes);
}

/**
 * 단조 하락 시퀀스 (bearish).
 */
function downtrend({ basePrice = 100, count = 60, stepPct = 0.002 } = {}) {
  const closes = [];
  let p = basePrice;
  for (let i = 0; i < count; i++) {
    closes.push(p);
    p *= (1 - stepPct);
  }
  return priceSeries(closes);
}

/**
 * 지그재그 (swing 생성용) — amplitude% 폭으로 period 봉마다 반전.
 */
function zigzag({ basePrice = 100, count = 60, period = 10, amplitudePct = 0.01 } = {}) {
  const closes = [];
  for (let i = 0; i < count; i++) {
    const phase = Math.floor(i / period) % 2;
    const wave  = phase === 0 ? 1 : -1;
    const within = (i % period) / period;
    closes.push(basePrice * (1 + wave * amplitudePct * within));
  }
  return priceSeries(closes);
}

/**
 * 마지막 봉의 close 를 원하는 값으로 override — currentPrice 주입용.
 */
function setLastClose(candles, close) {
  const out = [...candles];
  const last = out[out.length - 1];
  const open = last.open;
  const hi   = Math.max(open, close) * 1.0005;
  const lo   = Math.min(open, close) * 0.9995;
  out[out.length - 1] = { ...last, close, high: hi, low: lo };
  return out;
}

module.exports = { priceSeries, uptrend, downtrend, zigzag, setLastClose, BAR_MS };
