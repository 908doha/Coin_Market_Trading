/**
 * 총 자산(KRW) 이력 스냅샷 저장 유틸
 * - 5초 폴링마다 호출되지만 5분 간격으로만 저장 (과밀 방지)
 * - 최대 5000개 유지 → 5분 간격 × 5000 ≈ 17.5일
 */

export interface BalanceSnapshot {
  ts:    number;  // unix 초
  total: number;  // 총 자산 KRW
}

const STORAGE_KEY   = 'balance_hist_v1';
const MIN_INTERVAL  = 5 * 60;   // 최소 300초(5분) 간격
const MAX_SNAPSHOTS = 5_000;

export function appendBalanceSnapshot(totalKrw: number): void {
  if (!totalKrw || totalKrw <= 0) return;
  const ts = Math.floor(Date.now() / 1000);
  try {
    const raw  = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const list: BalanceSnapshot[] = raw ? JSON.parse(raw) : [];
    const last = list[list.length - 1];
    if (last && ts - last.ts < MIN_INTERVAL) return;   // 너무 이른 저장 스킵
    list.push({ ts, total: totalKrw });
    if (list.length > MAX_SNAPSHOTS) list.splice(0, list.length - MAX_SNAPSHOTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch { /* 스토리지 없는 환경 무시 */ }
}

export function loadBalanceHistory(): BalanceSnapshot[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
