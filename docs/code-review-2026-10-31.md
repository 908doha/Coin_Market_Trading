# Osprey 코드 리뷰 보고서 (2026-10-31)

## 총평

전체 코드베이스에서 **보안 5건, 버그 7건, 성능 4건, 유지보수 7건, 가독성 2건** — 총 25건의 문제를 발견했다.

**가장 치명적인 구조적 결함**: API 키가 클라이언트(localStorage)에 평문 저장되고 매 요청마다 POST body로 전송되며, JWT 서명 검증이 없어 공격자가 임의 사용자로 위장 가능하다. 이 두 가지가 해결되지 않으면 나머지 보안 조치(CORS, 암호화)가 무의미하다.

코드 중복도 심각하다. `gateSign`/`getUserId`/`getSupabase`/`decrypt`가 5개 파일에 복붙, ExchangeLogo가 3벌, AccountBottomSheet가 2벌 — 하나를 고치면 나머지가 동기화되지 않는 유지보수 지뢰밭이다.

---

## 문제점 리스트

---

### [SEC-1] JWT 서명 미검증 — 인증 완전 우회 가능 (Critical)

**파일**: `api/ict-snapshot.ts:30-42`, `api/balance-history.ts:34-46`, `api/user-accounts.ts:19-39`

3개 파일의 `getUserId`/`decodeJwtPayload`가 서명 없이 Base64 디코딩만 수행. 공격자가 `{"user_id":"victim_id"}`로 JWT를 직접 조립하면 타 사용자 데이터에 접근 가능.

**Before** (`api/ict-snapshot.ts:30-42`):
```typescript
function getUserId(req: any): string | null {
  try {
    const auth  = (req.headers?.authorization ?? '') as string;
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const pad     = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
    const payload = JSON.parse(Buffer.from(pad(parts[1]), 'base64url').toString('utf8'));
    return payload.user_id ?? payload.id ?? payload.sub ?? null;
  } catch { return null; }
}
```

**After** (공통 `api/_auth.ts`):
```typescript
import crypto from 'crypto';

export function verifyAndGetUserId(req: any): string | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  const auth = (req.headers?.authorization ?? '') as string;
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    const pad = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
    const decoded = JSON.parse(Buffer.from(pad(payload), 'base64url').toString('utf8'));
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;
    const id = decoded.user_id ?? decoded.id ?? decoded.sub;
    return id != null ? String(id) : null;
  } catch { return null; }
}
```

---

### [SEC-2] API 키가 클라이언트에서 평문 전송/저장 (Critical)

**파일**: `frontend/src/store/accounts.tsx:44-67`, `frontend/src/services/positions.service.ts:44-48`, `frontend/src/services/exchange.service.ts:18-26`

클라이언트가 apiKey/apiSecret을 localStorage에 평문 저장하고, 매 요청마다 POST body로 서버에 전송. XSS 한 번이면 모든 거래소 자격증명이 탈취된다.

**Before** (`positions.service.ts`):
```typescript
const res = await fetch(`${API_BASE}/api/positions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    accountId: params.id,
    exchange: params.exchange,
    apiKey: params.apiKey,
    apiSecret: params.apiSecret,
  }),
});
```

**After**:
```typescript
const token = await tokenStorage.getAccess();
const res = await fetch(`${API_BASE}/api/positions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ accountId: params.id }),
});
// 서버에서 accountId + userId로 exchange_accounts에서 복호화해 사용
```

---

### [SEC-3] CORS `Access-Control-Allow-Origin: *` (High)

**파일**: `api/ict-analyze.ts:581`, `api/ict-snapshot.ts:51`, `api/balance-history.ts:57`, `api/user-accounts.ts:99`, `api/candlesticks.ts`

모든 인증 API가 와일드카드 CORS. 악성 사이트에서 사용자의 JWT 포함 요청을 보낼 수 있다.

**Before**:
```typescript
function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
}
```

**After**:
```typescript
const ALLOWED_ORIGINS = new Set([
  'https://your-app.vercel.app',
  'http://localhost:8081',
  'http://localhost:19006',
]);

function setCors(req: any, res: any) {
  const origin = req.headers?.origin ?? '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
}
```

---

### [SEC-4] 하드코딩된 암호화 키 fallback (High)

**파일**: `api/user-accounts.ts:43`, `api/cron/positions.ts:29`

`ACCOUNTS_ENCRYPTION_KEY` 미설정 시 `'default_dev_key_change_in_prod!!'`로 fallback. 환경변수 설정 실수 시 모든 API 키가 예측 가능한 키로 암호화 = 실질적 평문.

**Before**:
```typescript
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY ?? 'default_dev_key_change_in_prod!!';
return crypto.scryptSync(secret, 'accounts_salt_v1', 32);
```

**After**:
```typescript
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY;
if (!secret) throw new Error('ACCOUNTS_ENCRYPTION_KEY is not configured');
return crypto.scryptSync(secret, 'accounts_salt_v1', 32);
```

---

### [SEC-5] Cron 엔드포인트 인증 선택적 (Medium)

**파일**: `api/cron/positions.ts:236-244`

`CRON_SECRET` 미설정 시 인증을 완전히 건너뜀. 누구나 `/api/cron/positions`를 호출해 모든 사용자의 API 키로 거래소 API 호출을 트리거 가능.

**Before**:
```typescript
const cronSecret = process.env.CRON_SECRET;
if (cronSecret) {
  const auth = (req.headers?.authorization ?? '') as string;
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== cronSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
}
```

**After**:
```typescript
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) {
  res.status(500).json({ error: 'CRON_SECRET not configured' });
  return;
}
const auth = (req.headers?.authorization ?? '') as string;
const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret))) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}
```

---

### [BUG-1] 전역 변수 `__binanceLastDebug`로 요청 간 데이터 누수 (High)

**파일**: `api/positions.ts:255`

Vercel Serverless는 warm 인스턴스에서 전역 상태가 유지됨. 사용자 A의 Binance 디버그 정보가 사용자 B의 응답 헤더에 포함될 수 있다.

**Before**:
```typescript
let __binanceLastDebug: string = '';
```

**After** — 핸들러 스코프 내에서 처리:
```typescript
export default async function handler(req: any, res: any) {
  let binanceDebug = '';
  const { positions, debug } = await fetchBinancePositions(apiKey, apiSecret);
  if (debug) res.setHeader('x-binance-debug', debug);
}
```

---

### [BUG-2] positions/trades에서 API 키를 body로 직접 수신 (High)

**파일**: `api/positions.ts:434-436`, `api/trades.ts:270`

JWT 인증 없이 클라이언트에서 API 키/시크릿을 body로 직접 전송. `user-accounts.ts`의 암호화 저장 구조와 모순.

**Before**:
```typescript
const { exchange, apiKey, apiSecret, accountId } = req.body ?? {};
```

**After**:
```typescript
const userId = verifyAndGetUserId(req);
if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
const { exchange, accountId } = req.body ?? {};
const accounts = await getDecryptedAccounts(userId);
const account = accounts.find(a => a.id === accountId);
if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
const { apiKey, apiSecret } = account;
```

---

### [BUG-3] sumBalances에서 profitRate 단순 합산 (Medium)

**파일**: `frontend/src/store/accounts.tsx:153-169`

다중 계좌의 수익률을 단순 덧셈. 계좌 A(100만원 +10%)와 계좌 B(1000만원 -5%)의 합계가 +5%가 됨 — 투자금 비중 미반영.

**Before**:
```typescript
profitRate: acc.profitRate + b.profitRate,
profitTodayRate: acc.profitTodayRate + b.profitTodayRate,
```

**After**:
```typescript
const result = valid.reduce<Balance>((acc, b) => ({
  ...acc,
  total: acc.total + b.total,
  invested: acc.invested + b.invested,
  profitTotal: acc.profitTotal + b.profitTotal,
}), ZERO_BALANCE);
result.profitRate = result.invested > 0
  ? (result.profitTotal / result.invested) * 100
  : 0;
```

---

### [BUG-4] parseKstEntryTs 타임존 불일치 (Medium)

**파일**: `frontend/app/(main)/positions/[id].tsx:15-25`

accounts.tsx의 `parseKstEntryTs`는 `+09:00`을 명시하지만, positions/[id].tsx의 `parseEntryAtTs`는 타임존 없이 파싱. 서버가 KST 문자열을 주므로 로컬 타임존에 따라 9시간 오차 발생 가능.

**Before**:
```typescript
if (m) return Math.floor(new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`).getTime() / 1000);
```

**After**:
```typescript
if (m) return Math.floor(new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`).getTime() / 1000);
```

---

### [BUG-5] balance-history PATCH — N+1 쿼리 + race condition (Medium)

**파일**: `api/balance-history.ts:165-206`

orphan rebind에서 각 orphan마다 4개 DB 쿼리. 동시 PATCH 요청 시 동일 orphan 이중 rebind.

**After** — Supabase RPC로 원자적 처리:
```sql
CREATE OR REPLACE FUNCTION claim_orphan_balance_history(
  p_user_id TEXT, p_new_account_id TEXT, p_keep_account_ids TEXT[]
) RETURNS INTEGER AS $$
DECLARE rebound INTEGER;
BEGIN
  WITH orphans AS (
    SELECT id, ts FROM balance_history
    WHERE user_id = p_user_id
      AND account_id NOT IN (SELECT unnest(p_keep_account_ids))
      AND account_id != ''
      AND NOT EXISTS (
        SELECT 1 FROM balance_history bh2
        WHERE bh2.user_id = p_user_id
          AND bh2.account_id = p_new_account_id
          AND bh2.ts = balance_history.ts
      )
  )
  UPDATE balance_history SET account_id = p_new_account_id
  FROM orphans WHERE balance_history.id = orphans.id;
  GET DIAGNOSTICS rebound = ROW_COUNT;
  DELETE FROM balance_history
  WHERE user_id = p_user_id
    AND account_id NOT IN (SELECT unnest(p_keep_account_ids))
    AND account_id != '' AND account_id != p_new_account_id;
  RETURN rebound;
END; $$ LANGUAGE plpgsql;
```

---

### [BUG-6] makeId() 충돌 가능 (Medium)

**파일**: `frontend/src/store/accounts.tsx:69-71`

**Before**:
```typescript
function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
```

**After**:
```typescript
function makeId(): string {
  return crypto.randomUUID();
}
```

---

### [BUG-7] Cron에서 ICT 분석 시 API 키를 HTTP body로 자체 호출 (Medium)

**파일**: `api/cron/positions.ts:216-228`

`fetchIctViaHttp`가 평문 apiKey/apiSecret을 HTTP POST body로 자체 서버에 전송. 네트워크 로그에 평문 자격증명이 기록됨.

**After** — ICT 분석 로직을 공유 모듈로 추출하고 직접 호출:
```typescript
import { runIctAnalysis } from './_ict-core';
const analysis = await runIctAnalysis(apiKey, apiSecret, contract);
```

---

### [PERF-1] 5초 폴링이 모든 계좌에 API 호출 발생 (High)

**파일**: `frontend/src/store/accounts.tsx:394-402`

5초마다 N개 계좌 × 2 API 호출(balance + positions). 거래소 rate limit에 걸릴 수 있다.

**Before**:
```typescript
const id = setInterval(() => {
  refreshBalances();
  refreshPositions();
}, 5_000);
```

**After**:
```typescript
useEffect(() => {
  if (isLoading || accounts.length === 0) return;
  const INTERVAL = 30_000;
  let id = setInterval(() => { refreshBalances(); refreshPositions(); }, INTERVAL);
  const handleVisibility = () => {
    clearInterval(id);
    if (document.visibilityState === 'visible') {
      refreshBalances(); refreshPositions();
      id = setInterval(() => { refreshBalances(); refreshPositions(); }, INTERVAL);
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);
  return () => { clearInterval(id); document.removeEventListener('visibilitychange', handleVisibility); };
}, [isLoading, accounts.length]);
```

---

### [PERF-2] localStorage 토큰 1초 폴링 (Medium)

**파일**: `frontend/src/store/accounts.tsx:237-251`

**Before**:
```typescript
const interval = setInterval(() => {
  const current = localStorage.getItem(TOKEN_KEY);
  if (current && current !== lastToken) { syncFromBackend(); }
}, 1000);
```

**After**:
```typescript
const handler = (e: StorageEvent) => {
  if (e.key === TOKEN_KEY && e.newValue && e.newValue !== e.oldValue) {
    syncFromBackend();
  }
};
window.addEventListener('storage', handler);
return () => window.removeEventListener('storage', handler);
```

---

### [PERF-3] Supabase 클라이언트 매 호출마다 재생성 (Medium)

**파일**: `api/ict-snapshot.ts:44-49`, `api/balance-history.ts:49-54`, `api/user-accounts.ts:70-75`, `api/cron/positions.ts:19-24`

**Before**:
```typescript
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
```

**After**:
```typescript
let _sb: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}
```

---

### [PERF-4] scryptSync 매 요청마다 호출 (Low)

**파일**: `api/user-accounts.ts:43-45`, `api/cron/positions.ts:29-31`

`scryptSync`는 의도적으로 느린 KDF. 모듈 스코프에 캐싱 필요.

**After**:
```typescript
let _derivedKey: Buffer | null = null;
function getKey(): Buffer {
  if (_derivedKey) return _derivedKey;
  const secret = process.env.ACCOUNTS_ENCRYPTION_KEY;
  if (!secret) throw new Error('ACCOUNTS_ENCRYPTION_KEY not configured');
  _derivedKey = crypto.scryptSync(secret, 'accounts_salt_v1', 32);
  return _derivedKey;
}
```

---

### [MAINT-1] gateSign/getUserId/getSupabase/decrypt 5회 이상 복붙 (High)

**파일**: `api/positions.ts`, `api/trades.ts`, `api/ict-analyze.ts`, `api/cron/positions.ts`, `api/exchange/balance.ts`

**After** — 공통 모듈 구조:
```
api/
├── _auth.ts          # verifyAndGetUserId
├── _supabase.ts      # getSupabase (캐싱)
├── _crypto.ts        # getKey, encrypt, decrypt
├── _gate.ts          # gateSign, gateGet, gateGetCandles
├── _binance.ts       # binanceSign, binanceFapiGet
├── _exchange-rate.ts # getUsdtKrwRate
└── _cors.ts          # setCors (origin whitelist)
```

---

### [MAINT-2] ExchangeLogo 3벌 중복 (High)

**파일**: `frontend/src/components/ExchangeLogo.tsx`, `frontend/app/(main)/home.tsx:673-755`, `frontend/app/(main)/positions/index.tsx:23-66`

3곳에 별도 구현. 실제로 home.tsx와 positions/index.tsx에서 bybit/okx 로고가 누락된 등 구현 차이가 있다.

**After**: 모든 파일에서 `import { ExchangeLogo } from '@/components/ExchangeLogo'` 사용, 인라인 구현 삭제.

---

### [MAINT-3] AccountBottomSheet 2벌 중복 (Medium)

**파일**: `frontend/src/components/AccountBottomSheet.tsx`, `frontend/app/(main)/positions/index.tsx:69-227`

**After**: positions/index.tsx에서 공용 컴포넌트를 import.

---

### [MAINT-4] `any` 타입 남용 — 30건 이상 (Medium)

**파일**: `frontend/src/store/accounts.tsx:314-315`, `frontend/app/(main)/positions/[id].tsx:75,101,105`, `frontend/src/utils/ictSnapshot.ts:18,87`, `frontend/src/components/IctAnalysisCard.tsx:57`

Position 인터페이스에 누락 필드가 있어 `as any` 캐스팅이 반복된다.

**After**: Position 인터페이스에 `entryAt`, `liqPrice`, `usdtKrw`, `size` 등 optional 필드 추가.

---

### [MAINT-5] 차트 버킷 생성 3벌 중복 (Medium)

**파일**: `frontend/app/(main)/home.tsx:31-295`

`buildChartFromSnapshots`, `buildChartFromTrades`, `buildPeriodBarsFromTrades` — 시간/일/주/월/년 버킷 생성이 3회 반복.

**After**: `buildTimeBuckets(period, now)` 공통 함수로 추출.

---

### [MAINT-6] 중첩 디렉토리 5개 (Low)

`design-system/design-system/`, `store/store/`, `hooks/hooks/`, `mock/mock/`, `constants/constants/` — import가 참조하므로 단순 삭제 불가. import 경로 전수 조사 후 정리 필요.

---

### [MAINT-7] home.tsx 1259줄 단일 파일 (Low)

차트, 로고, 계좌 행, 기간 탭, 통계 카드가 모두 하나의 파일. 컴포넌트 분리해 300줄 이하로 나눠야 HMR과 번들 사이즈가 개선됨.

---

### [READ-1] 핸들러 `req: any, res: any` 타입 (Low)

**파일**: 거의 모든 API 파일

**After**:
```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
export default async function handler(req: VercelRequest, res: VercelResponse) {
```

---

### [READ-2] 프로덕션 console.log에 민감 데이터 노출 (Low)

**파일**: `frontend/src/store/accounts.tsx:49,66,209,243,428` 등 수십 곳

API 키 포함 객체나 토큰 정보가 console.log로 출력된다.

---

## 노션 리팩토링 제안 (우선순위순)

| 우선순위 | 항목 | 설명 | 예상 공수 |
|---------|------|------|-----------|
| **P0** | API 키 서버사이드 전환 | 클라이언트에서 API 키 전송 제거. accountId + JWT로 서버에서 복호화 | 4h |
| **P0** | JWT 서명 검증 추가 | `api/_auth.ts` 공통 모듈 + timingSafeEqual + exp 검사 | 2h |
| **P0** | 암호화 키 fallback 제거 | 환경변수 미설정 시 throw | 30m |
| **P1** | CORS origin 화이트리스트 | `*` → 프로덕션 도메인만 허용 | 1h |
| **P1** | CRON_SECRET 필수화 | 미설정 시 500 에러 + timingSafeEqual | 30m |
| **P1** | 5초 폴링 → 30초 + visibilitychange | rate limit 방지 | 1h |
| **P1** | ExchangeLogo/AccountBottomSheet 통합 | 3벌+2벌 → 각 1벌 | 2h |
| **P2** | 공통 헬퍼 모듈 추출 | `_gate.ts`, `_auth.ts`, `_supabase.ts`, `_cors.ts`, `_crypto.ts`, `_exchange-rate.ts` | 3h |
| **P2** | Position 타입 정비 | `as any` 30건 제거. 인터페이스에 누락 필드 추가 | 2h |
| **P2** | sumBalances profitRate 수정 | 단순 합산 → 투자금 가중 평균 | 1h |
| **P2** | parseKstEntryTs 타임존 통일 | 2개 함수의 타임존 처리 일치 | 30m |
| **P2** | cron ICT 분석 직접 import | HTTP self-call 제거 (API 키 평문 전송 방지) | 2h |
| **P2** | balance-history PATCH 원자적 처리 | Supabase RPC 함수로 N+1 + race condition 해소 | 2h |
| **P3** | `__binanceLastDebug` 전역 변수 제거 | 핸들러 스코프로 이동 | 30m |
| **P3** | makeId() → crypto.randomUUID() | 충돌 가능성 제거 | 15m |
| **P3** | Supabase 클라이언트 + scryptSync 캐싱 | 모듈 스코프 캐싱으로 warm start 최적화 | 1h |
| **P3** | cron 순차 → 병렬 처리 | `Promise.allSettled` batch(5) | 1h |
| **P3** | 차트 버킷 공통 함수 | 3벌 중복 → 단일 함수 | 1h |
| **P3** | home.tsx 분할 | 1259줄 → 300줄 이하 4-5개 컴포넌트 | 2h |
| **P3** | console.log 정리 | 프로덕션 빌드에서 제거 | 1h |
| **P3** | 중첩 디렉토리 정리 | import 경로 전수 조사 후 5개 제거 | 2h |
| **P3** | `VercelRequest/VercelResponse` 타입 적용 | 모든 API 핸들러 | 1h |
| **P3** | `bot/index.ts` 중복 제거 | `[...path].ts`가 catch-all이므로 불필요 | 15m |

**총 예상 공수**: P0 ~6.5h, P1 ~4.5h, P2 ~10.5h, P3 ~10h = **~31.5h**
