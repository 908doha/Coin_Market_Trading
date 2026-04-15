/**
 * 총 자산(KRW) 이력 스냅샷 저장 유틸
 *
 * localStorage (로컬)
 *   - 5초 폴링마다 호출되지만 5분 간격으로만 저장
 *   - 최대 26,000개 유지 ≈ 90일 (5분 × 26,000)
 *   - accountId 지정 시 해당 계좌 전용 키에 저장
 *
 * Supabase (원격)
 *   - syncBalanceHistory(): 앱 시작 시 원격 이력 → localStorage 머지
 *   - pushBalanceHistory(): 30분마다 신규 스냅샷을 원격으로 업로드
 *   - 토큰 없거나 서버 미설정이면 자동으로 localStorage만 사용 (graceful fallback)
 */

export interface BalanceSnapshot {
  ts:    number;  // unix 초
  total: number;  // 총 자산 KRW
}

const KEY           = (accountId?: string) => accountId ? `balance_hist_v1_${accountId}` : 'balance_hist_v1';
const LAST_PUSH_KEY = (accountId?: string) => accountId ? `balance_hist_push_${accountId}` : 'balance_hist_push';
const MIN_INTERVAL  = 5 * 60;     // 최소 저장 간격: 5분
const MAX_SNAPSHOTS = 26_000;     // 약 90일 (5분 간격)

// ── 로컬 저장 / 로드 ──────────────────────────────────────────────────────────

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

// ── 원격 동기화 헬퍼 ──────────────────────────────────────────────────────────

function getToken(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('jwt_access') : null;
  } catch { return null; }
}

/** Supabase에서 스냅샷 목록을 가져옴 (토큰 없으면 빈 배열 반환) */
async function remoteLoad(accountId?: string, since = 0): Promise<BalanceSnapshot[]> {
  const token = getToken();
  if (!token) return [];
  try {
    const params = new URLSearchParams({ accountId: accountId ?? '' });
    if (since > 0) params.set('since', String(since));
    const res = await fetch(`/api/balance-history?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 204) return [];   // 서버 미설정
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

/** 스냅샷 배치를 Supabase로 업로드 */
async function remotePush(snapshots: BalanceSnapshot[], accountId?: string): Promise<boolean> {
  const token = getToken();
  if (!token || !snapshots.length) return false;
  try {
    const res = await fetch('/api/balance-history', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({
        snapshots: snapshots.map((s) => ({ ...s, accountId: accountId ?? '' })),
      }),
    });
    if (res.status === 204) return false;  // 서버 미설정
    return res.ok;
  } catch { return false; }
}

/** local + remote 스냅샷을 ts 기준 합집합 후 정렬, MAX_SNAPSHOTS 유지 */
function mergeSnapshots(local: BalanceSnapshot[], remote: BalanceSnapshot[]): BalanceSnapshot[] {
  const map = new Map<number, number>();
  for (const s of local)  map.set(s.ts, s.total);
  for (const s of remote) map.set(s.ts, s.total);  // 원격이 로컬을 덮어씀
  const merged = Array.from(map.entries())
    .map(([ts, total]) => ({ ts, total }))
    .sort((a, b) => a.ts - b.ts);
  return merged.length > MAX_SNAPSHOTS
    ? merged.slice(merged.length - MAX_SNAPSHOTS)
    : merged;
}

// ── 공개 원격 동기화 API ──────────────────────────────────────────────────────

/**
 * Supabase에서 이력을 로드해 localStorage와 머지.
 * 앱 시작 시 (계좌 로드 완료 후) 호출.
 * @returns 원격 데이터가 있었으면 true
 */
export async function syncBalanceHistory(accountId?: string): Promise<boolean> {
  try {
    const remote = await remoteLoad(accountId);
    if (!remote.length) return false;

    const local  = loadBalanceHistory(accountId);
    const merged = mergeSnapshots(local, remote);
    localStorage.setItem(KEY(accountId), JSON.stringify(merged));
    return true;
  } catch { return false; }
}

/**
 * 마지막 push 이후 신규 스냅샷만 Supabase로 업로드.
 * 30분 주기 폴링에서 호출.
 */
export async function pushBalanceHistory(accountId?: string): Promise<void> {
  try {
    const pushKey   = LAST_PUSH_KEY(accountId);
    const lastPushTs = parseInt(
      (typeof localStorage !== 'undefined' ? localStorage.getItem(pushKey) : null) ?? '0',
      10,
    );

    const all     = loadBalanceHistory(accountId);
    const newSnaps = lastPushTs > 0
      ? all.filter((s) => s.ts > lastPushTs)
      : all;
    if (!newSnaps.length) return;

    const ok = await remotePush(newSnaps, accountId);
    if (ok) {
      const nowTs = Math.floor(Date.now() / 1000);
      localStorage.setItem(pushKey, String(nowTs));
    }
  } catch { /* 네트워크 오류 무시 — 다음 주기에 재시도 */ }
}
