/** 1,234,567원 */
export function formatKRW(value: number): string {
  return `${Math.round(Math.abs(value)).toLocaleString('ko-KR')}원`;
}

/** +1,234원 or -1,234원 */
export function formatKRWSigned(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${Math.round(Math.abs(value)).toLocaleString('ko-KR')}원`;
}

/** +3.75% or -1.20% */
export function formatRate(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/** 98,450,000 → 9,845만원 */
export function formatMillions(value: number): string {
  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(1)}억원`;
  }
  if (value >= 10_000) {
    return `${Math.floor(value / 10_000).toLocaleString('ko-KR')}만원`;
  }
  return `${value.toLocaleString('ko-KR')}원`;
}

/**
 * 가격 레벨 전용 자릿수 선택 — 종목 가격대에 따라 유의한 소수 자릿수 자동.
 * BTC/ETH/XBR(~$70) 처럼 ≥ $1 은 2자리, DOGE/ADA 는 4자리,
 * SHIB/PEPE 급 초저가 토큰은 최대 8자리까지.
 */
function pickPriceDigits(abs: number): number {
  if      (abs === 0)     return 2;
  else if (abs >= 1)      return 2;   // BTC, ETH, BNB, SOL, 원자재
  else if (abs >= 0.1)    return 4;   // DOGE, ADA
  else if (abs >= 0.01)   return 5;
  else if (abs >= 0.001)  return 6;
  else if (abs >= 0.0001) return 7;
  else                    return 8;   // SHIB, PEPE
}

/** USD 가격(접두 없음) — '0.1327', '60000.00' 등. 문자열 내 삽입용. */
export function formatPrice(value: number): string {
  const digits = pickPriceDigits(Math.abs(value));
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * USD 가격($ 접두) — '$0.1327', '$60,000.00'.
 * 포지션 진입가/현재가/청산가/손절가 등 '가격 레벨' 전용.
 */
export function formatUsdPrice(value: number): string {
  return `$${formatPrice(value)}`;
}
