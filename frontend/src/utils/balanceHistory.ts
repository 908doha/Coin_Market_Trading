/**
 * 총 자산(KRW) 이력 스냅샷 저장 유틸
 *
 * 저장 정책 (계층적 압축)
 *   - 최근 24시간: 5분 간격 원본 그대로 보존
 *   - 24시간 이전: 하루 1개 (해당 날의 마지막 스냅샷)로 압축
 *   → 저장 용량: 최대 288(24h) + 수천(일별) ≈ 수년치 이력을 수KB로 보존
 *
 * localStorage (로컬)
 *   - 5초 폴링마다 호출되지만 5분 간격으로만 저장
 *   - appendBalanceSnapshot / syncBalanceHistory 시 자동 압축
 *
 * Supabase (원격)
 *   - syncBalanceHistory(): 앱 시작 시 원격 이력 → localStorage 머지 후 압축
 *   - pushBalanceHistory(): 30분마다 신규 스냅샷을 원격으로 업로드
 *   - 토큰 없거나 서버 미설정이면 localStorage만 사용 (graceful fallback)
 */

export interface BalanceSnapshot {
  ts:    number;  // unix 초
  total: number;  // 총 자산 KRW
}

const KEY           = (accountId?: string) => accountId ? `balance_hist_v1_${accountId}` : 'balance_hist_v1';
const LAST_PUSH_KEY = (accountId?: string) => accountId ? `balance_hist_push_${accountId}` : 'balance_hist_push';
const MIN_INTERVAL  = 5 * 60;     // 최소 저장 간격: 5분
const MAX_SNAPSHOTS = 10_000;     // 안전 상한 (압축 후 실제 크기는 수백~수천 개)
const COMPACT_AFTER = 24 * 3600;  // 24시간 이전 데이터는 일별 압축

// ── 압축 ──────────────────────────────────────────────────────────────────────
/**
 * 24시간 이전 스냅샷을 하루 1개(해당 날의 마지막 값)로 압축.
 * 최근 24시간 데이터는 5분 간격 원본 그대로 유지.
 */
function compactSnapshots(list: BalanceSnapshot[]): BalanceSnapshot[] {
  const cutoff = Math.floor(Date.now() / 1000) - COMPACT_AFTER;

  const recent = list.filter((s) => s.ts >= cutoff);
  const old    = list.filter((s) => s.ts <  cutoff);

  // 오래된 데이터: 로컬 날짜(YYYY-MM-DD) 기준으로 그룹화, 각 날의 마지막 값만 보존
  const byDay = new Map<string, BalanceSnapshot>();
  for (const s of old) {
    const d   = new Date(s.ts * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // 같은 날 후순 스냅샷이 덮어씀 → 하루의 마지막 값 유지
    byDay.set(key, s);
  }

  const compacted = Array.from(byDay.values()).sort((a, b) => a.ts - b.ts);
  const merged    = [...compacted, ...recent];

  // 안전 상한 초과 시 오래된 것 제거 (일반적으로 발생하지 않음)
  return merged.length > MAX_SNAPSHOTS
    ? merged.slice(merged.length - MAX_SNAPSHOTS)
    : merged;
}

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
    localStorage.setItem(key, JSON.stringify(compactSnapshots(list)));
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

/** local + remote 스냅샷을 ts 기준 합집합 후 압축 */
function mergeAndCompact(local: BalanceSnapshot[], remote: BalanceSnapshot[]): BalanceSnapshot[] {
  const map = new Map<number, number>();
  for (const s of local)  map.set(s.ts, s.total);
  for (const s of remote) map.set(s.ts, s.total);  // 원격이 로컬을 덮어씀
  const merged = Array.from(map.entries())
    .map(([ts, total]) => ({ ts, total }))
    .sort((a, b) => a.ts - b.ts);
  return compactSnapshots(merged);
}

// ── 공개 원격 동기화 API ──────────────────────────────────────────────────────

/**
 * Supabase에서 이력을 로드해 localStorage와 머지 후 압축.
 * 앱 시작 시 (계좌 로드 완료 후) 호출.
 * @returns 원격 데이터가 있었으면 true
 */
export async function syncBalanceHistory(accountId?: string): Promise<boolean> {
  try {
    const remote = await remoteLoad(accountId);
    if (!remote.length) return false;

    const local   = loadBalanceHistory(accountId);
    const compacted = mergeAndCompact(local, remote);
    localStorage.setItem(KEY(accountId), JSON.stringify(compacted));
    return true;
  } catch { return false; }
}

/**
 * 마지막 push 이후 신규 스냅샷만 Supabase로 업로드.
 * 30분 주기 폴링에서 호출.
 * - 24시간 이내 데이터: 원본(5분 간격) 업로드
 * - 24시간 이전 데이터: 압축(일별) 상태로 업로드 → 서버 저장 공간 절약
 */
export async function pushBalanceHistory(accountId?: string): Promise<void> {
  try {
    const pushKey    = LAST_PUSH_KEY(accountId);
    const lastPushTs = parseInt(
      (typeof localStorage !== 'undefined' ? localStorage.getItem(pushKey) : null) ?? '0',
      10,
    );

    const all      = loadBalanceHistory(accountId);  // 이미 압축된 상태
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

/**
 * 새 계좌 ID로 orphan balance_history 흡수.
 * `exchange_accounts` 초기화 후 재등록 시, 옛 랜덤 account_id 에 남은
 * 스냅샷을 신규 ID 로 rebind 해서 계좌별 차트 연속성을 복구함.
 *
 * @param newAccountId  방금 추가된 계좌의 랜덤 id
 * @param keepAccountIds 보존할 활성 account_id 목록 (새 id 포함, '' 는 서버가 자동 보존)
 * @returns rebind 된 행 수 (0 = orphan 없음 또는 실패)
 */
export async function claimOrphanBalanceHistory(
  newAccountId:   string,
  keepAccountIds: string[],
): Promise<number> {
  const token = getToken();
  if (!token || !newAccountId) return 0;
  try {
    const res = await fetch('/api/balance-history', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ newAccountId, keepAccountIds }),
    });
    if (!res.ok) return 0;
    const { rebound } = await res.json();
    return Number(rebound ?? 0);
  } catch { return 0; }
}
