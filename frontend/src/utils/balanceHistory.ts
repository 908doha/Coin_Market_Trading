/**
 * 총 자산(KRW) 이력 스냅샷 저장 유틸
 * - 5초 폴링마다 호출되지만 5분 간격으로만 저장 (과밀 방지)
 * - 최대 5000개 유지 → 5분 간격 × 5000 ≈ 17.5일
 * - accountId 지정 시 해당 계좌 전용 키에 저장 (전체/계좌별 분리)
 */

export interface BalanceSnapshot {
  ts:    number;  // unix 초
  total: number;  // 총 자산 KRW
}

const KEY          = (accountId?: string) => accountId ? `balance_hist_v1_${accountId}` : 'balance_hist_v1';
const MIN_INTERVAL  = 5 * 60;   // 최소 300초(5분) 간격
const MAX_SNAPSHOTS = 5_000;

export function appendBalanceSnapshot(totalKrw: number, accountId?: string): void {
  if (!totalKrw || totalKrw <= 0) return;
  const ts = Math.floor(Date.now() / 1000);
  try {
    const key  = KEY(accountId);
    const raw  = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    const list: BalanceSnapshot[] = raw ? JSON.parse(raw) : [];
    const last = list[list.length - 1];
    if (last && ts - last.ts < MIN_INTERVAL) return;   // 너무 이른 저장 스킵
    list.push({ ts, total: totalKrw });
    if (list.length > MAX_SNAPSHOTS) list.splice(0, list.length - MAX_SNAPSHOTS);
    localStorage.setItem(key, JSON.stringify(list));
  } catch { /* 스토리지 없는 환경 무시 */ }
}

export function loadBalanceHistory(accountId?: string): BalanceSnapshot[] {
  try {
    const key = KEY(accountId);
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
