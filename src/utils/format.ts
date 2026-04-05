/** ₩1,234,567 */
export function formatKRW(value: number): string {
  return `₩\u202F${Math.abs(value).toLocaleString('ko-KR')}`;
}

/** +₩1,234 or -₩1,234 */
export function formatKRWSigned(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${formatKRW(value)}`;
}

/** +3.75% or -1.20% */
export function formatRate(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/** ₩98,450,000 → 9,845만 */
export function formatMillions(value: number): string {
  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(1)}억`;
  }
  if (value >= 10_000) {
    return `${Math.floor(value / 10_000).toLocaleString('ko-KR')}만`;
  }
  return value.toLocaleString('ko-KR');
}
