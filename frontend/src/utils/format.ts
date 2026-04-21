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
 * USD 가격 포매터 — 종목 가격대에 따라 유의한 소수 자릿수를 자동 선택.
 * BTC/ETH/XBR(~$70) 처럼 ≥ $1 자산은 2자리,
 * DOGE/ADA(~$0.15) 는 4자리,
 * SHIB/PEPE 급 초저가 토큰은 최대 8자리까지 노출해 가격 레벨이
 * `$0.00` 으로 뭉개지지 않도록 함.
 * 포지션 진입가/현재가/청산가/손절가 등 '가격 레벨' 전용.
 */
export function formatUsdPrice(value: number): string {
  const abs = Math.abs(value);
  let digits: number;
  if      (abs === 0)     digits = 2;
  else if (abs >= 1)      digits = 2;   // BTC, ETH, BNB, SOL, 원자재 등
  else if (abs >= 0.1)    digits = 4;   // DOGE, ADA
  else if (abs >= 0.01)   digits = 5;
  else if (abs >= 0.001)  digits = 6;
  else if (abs >= 0.0001) digits = 7;
  else                    digits = 8;   // SHIB, PEPE 등
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
