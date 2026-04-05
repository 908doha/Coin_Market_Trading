/** 1,234,567원 */
export function formatKRW(value: number): string {
  return `${Math.abs(value).toLocaleString('ko-KR')}원`;
}

/** +1,234원 or -1,234원 */
export function formatKRWSigned(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${Math.abs(value).toLocaleString('ko-KR')}원`;
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
