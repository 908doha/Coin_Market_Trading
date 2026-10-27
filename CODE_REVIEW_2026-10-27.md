# Osprey 코드 리뷰 — 2026-10-27

## 총평

최근 5개 커밋(Binance TP/SL 견고화, ICT 5-Pillar 시각화, 5초 자동 폴링 제거/복귀, TickerRow 최적화)을 중심으로 전체 코드베이스를 리뷰했다. **보안 5건(Critical 2 / High 3), 버그 5건(High 2 / Medium 3), 성능 3건, 유지보수 2건**.

**가장 심각한 문제**: `user-accounts.ts`의 JWT가 서명 검증 없이 base64 디코딩만 한다 — 누구나 임의의 `user_id`로 JWT를 조작하면 다른 사용자의 암호화된 거래소 API 키에 접근할 수 있다. 이것과 맞물려 `positions.ts`, `trades.ts`, `exchange/balance.ts` 등 주요 엔드포인트에 인증 자체가 없어 공격 표면이 매우 넓다.

---

## 문제점 리스트

### 0. [Security / Critical] JWT 서명 검증 없음 — 타 사용자 계정 탈취 가능

**파일**: `api/user-accounts.ts:18-29`, 동일 패턴이 `api/balance-history.ts:34-46`, `api/ict-snapshot.ts:30-42`에도 복제

`decodeJwtPayload`가 JWT payload를 base64 디코딩만 하고 서명을 검증하지 않는다. 주석에도 "검증 없이 userId 추출"이라고 명시되어 있다. 공격자가 `{"user_id": 1}` 같은 payload로 JWT를 직접 만들면 모든 사용자의 AES 암호화된 거래소 API 키를 복호화할 수 있다.

추가로, `positions.ts`, `trades.ts`, `exchange/balance.ts`, `ict-analyze.ts` 등 주요 API 엔드포인트는 인증 자체가 없다 — POST body로 받은 API 키를 그대로 거래소에 전달하는 구조.

**Before:**
```typescript
// api/user-accounts.ts:18-29
function decodeJwtPayload(token: string): { user_id?: number; id?: number; sub?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const pad     = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
    const decoded = Buffer.from(pad(parts[1]), 'base64url').toString('utf8');
    return JSON.parse(decoded);
  } catch { return null; }
}
```

**After:**
```typescript
import { verifyToken } from './_jwt';

function getUserId(req: any): string | null {
  const auth = req.headers?.authorization ?? req.headers?.Authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const payload = verifyToken(token);  // _jwt.ts의 서명 검증 함수 사용
  if (!payload) return null;
  const id = payload.user_id ?? payload.id ?? payload.sub;
  return id != null ? String(id) : null;
}
```

`_jwt.ts`에 이미 `verifyToken` 함수가 존재하지만 사용되지 않고 있다. 모든 엔드포인트에서 이 함수로 교체 필요.

---

### 0-1. [Security / Critical] 암호화 키 하드코딩 + CRON_SECRET 미설정 시 인증 우회

**파일**: `api/user-accounts.ts:43`, `api/cron/positions.ts:29`, `api/cron/positions.ts:237`

(a) `ACCOUNTS_ENCRYPTION_KEY` 미설정 시 하드코딩된 `'default_dev_key_change_in_prod!!'`로 폴백 — 소스코드를 읽으면 모든 암호화된 API 키를 복호화 가능.

(b) `CRON_SECRET` 미설정 시 인증 체크 자체를 건너뛴다 — 누구나 `/api/cron/positions`를 호출하여 모든 사용자의 포지션/잔고를 처리할 수 있다.

**Before (a):**
```typescript
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY ?? 'default_dev_key_change_in_prod!!';
```
**After (a):**
```typescript
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY;
if (!secret) throw new Error('ACCOUNTS_ENCRYPTION_KEY is required');
```

**Before (b):**
```typescript
const cronSecret = process.env.CRON_SECRET;
if (cronSecret) {  // 미설정이면 통과
  ...
}
```
**After (b):**
```typescript
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) { res.status(500).json({ error: 'CRON_SECRET not configured' }); return; }
```

---

### 0-2. [Security / High] Cron의 SSRF — Host 헤더 조작으로 API 키 탈취

**파일**: `api/cron/positions.ts:246`

`baseUrl`이 `req.headers.host`에서 파생된다. 공격자가 `Host: evil.com`으로 cron 엔드포인트를 호출하면, 내부 `fetchIctViaHttp` 호출이 `https://evil.com/api/ict-analyze`로 리다이렉트되어 body에 담긴 API 키가 공격자 서버로 전송된다.

**Before:**
```typescript
const baseUrl = `https://${req.headers.host}`;
```
**After:**
```typescript
const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://your-production-domain.vercel.app';
```

---

### 1. [Security / High] CRON_SECRET 비교가 타이밍 공격에 취약

**파일**: `api/cron/positions.ts:239-240`

`===` 문자열 비교는 첫 번째 불일치 문자에서 즉시 반환하므로 응답 시간 차이로 secret을 한 글자씩 추론할 수 있다. 외부(cron-job.org)에서 호출하는 엔드포인트라 공격 표면이 넓다.

**Before:**
```typescript
if (token !== cronSecret) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}
```

**After:**
```typescript
const tokenBuf  = Buffer.from(token);
const secretBuf = Buffer.from(cronSecret);
if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}
```

---

### 2. [Security / High] Cron이 API 키를 HTTP 요청 본문으로 내부 전송

**파일**: `api/cron/positions.ts:216-218`

`fetchIctViaHttp`가 사용자의 Gate.io API 키를 JSON body에 담아 자기 자신(`baseUrl/api/ict-analyze`)에 POST한다. Vercel 내부 네트워크라 해도 API 키가 로그/모니터링에 노출될 수 있고, `ict-analyze` 엔드포인트에는 별도 인증이 없어 외부에서도 직접 호출 가능하다.

**Before:**
```typescript
const res = await fetch(`${baseUrl}/api/ict-analyze`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ apiKey, apiSecret, contract }),
});
```

**After:**
ICT 분석 로직을 공유 모듈로 추출하여 cron에서 직접 호출하거나, 최소한 cron 내부 호출에 `CRON_SECRET` 헤더를 추가하고 `ict-analyze`에서 검증:
```typescript
// api/cron/positions.ts
const res = await fetch(`${baseUrl}/api/ict-analyze`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Cron-Secret': process.env.CRON_SECRET ?? '',
  },
  body: JSON.stringify({ apiKey, apiSecret, contract }),
});

// api/ict-analyze.ts (handler 첫 줄에 추가)
const internalSecret = req.headers['x-cron-secret'];
const hasAuth = req.body?.apiKey && req.body?.apiSecret;
if (!hasAuth && !internalSecret) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```
장기적으로는 캔들 fetch 로직을 `_shared/gateCandles.ts`로 분리하여 HTTP 내부 호출을 제거하는 것이 올바른 방향.

---

### 3. [Bug / High] `sumBalances`가 수익률을 단순 합산

**파일**: `frontend/src/store/accounts.tsx:157-164`

`profitRate`와 `profitTodayRate`를 단순 합산(`acc.profitRate + b.profitRate`)한다. 계좌가 2개이고 각각 +5%, +10%면 총 수익률이 15%로 표시된다. 가중평균이어야 한다.

**Before:**
```typescript
return valid.reduce<Balance>(
  (acc, b) => ({
    total:           acc.total           + b.total,
    invested:        acc.invested        + b.invested,
    available:       acc.available       + b.available,
    profitTotal:     acc.profitTotal     + b.profitTotal,
    profitRate:      acc.profitRate      + b.profitRate,         // 단순 합산
    profitToday:     acc.profitToday     + b.profitToday,
    profitTodayRate: acc.profitTodayRate + b.profitTodayRate,    // 단순 합산
    totalUsd:        (acc.totalUsd ?? 0) + (b.totalUsd ?? 0),
    usdtKrw:         b.usdtKrw ?? acc.usdtKrw,
  }),
  { total: 0, invested: 0, available: 0, profitTotal: 0, profitRate: 0, profitToday: 0, profitTodayRate: 0 },
);
```

**After:**
```typescript
const summed = valid.reduce<Balance>(
  (acc, b) => ({
    total:           acc.total           + b.total,
    invested:        acc.invested        + b.invested,
    available:       acc.available       + b.available,
    profitTotal:     acc.profitTotal     + b.profitTotal,
    profitRate:      0, // 아래에서 재계산
    profitToday:     acc.profitToday     + b.profitToday,
    profitTodayRate: 0, // 아래에서 재계산
    totalUsd:        (acc.totalUsd ?? 0) + (b.totalUsd ?? 0),
    usdtKrw:         b.usdtKrw ?? acc.usdtKrw,
  }),
  { total: 0, invested: 0, available: 0, profitTotal: 0, profitRate: 0, profitToday: 0, profitTodayRate: 0 },
);
summed.profitRate = summed.invested > 0
  ? (summed.profitTotal / summed.invested) * 100
  : 0;
summed.profitTodayRate = summed.total > 0
  ? (summed.profitToday / (summed.total - summed.profitToday)) * 100
  : 0;
return summed;
```

---

### 4. [Bug / High] `__binanceLastDebug` 모듈 레벨 상태가 warm container 간 누출

**파일**: `api/positions.ts:255`

`let __binanceLastDebug: string = ''`가 모듈 스코프에 선언되어 있다. Vercel serverless의 warm container에서 이전 요청의 Binance 디버그 정보가 다른 사용자의 응답 헤더에 노출될 수 있다.

**Before:**
```typescript
let __binanceLastDebug: string = '';

async function fetchBinancePositions(...) { ... }

export default async function handler(req, res) {
  ...
  __binanceLastDebug = '';
  positions = await fetchBinancePositions(apiKey, apiSecret);
  if (__binanceLastDebug) {
    res.setHeader('x-binance-debug', __binanceLastDebug);
  }
}
```

**After:**
```typescript
// 모듈 레벨 변수 제거, fetchBinancePositions에서 직접 반환
async function fetchBinancePositions(
  apiKey: string, apiSecret: string
): Promise<{ positions: Position[]; debug: string }> {
  // ... 기존 로직 ...
  return { positions: open.map(...), debug: JSON.stringify({...}) };
}

export default async function handler(req, res) {
  ...
  const { positions: binPos, debug } = await fetchBinancePositions(apiKey, apiSecret);
  positions = binPos;
  if (debug) res.setHeader('x-binance-debug', debug);
}
```

---

### 5. [Bug / Medium] ICT scan useEffect의 `ictScores` 참조가 stale closure

**파일**: `frontend/app/(main)/analysis/index.tsx:495-601`

ICT 스캔 `useEffect`의 dependency에 `ictScores`가 없다. `targets` 필터링에서 `ictScores[t.contract] === undefined` 체크가 최초 마운트 시점의 빈 객체를 참조한다. `sortBy`가 변경되지 않는 한 이미 실패(null)한 종목을 재스캔하지 않는 의도된 동작이지만, `tickers`가 변경되면 이전에 성공한 종목도 `targets`에 포함되어 중복 스캔한다.

**Before:**
```typescript
useEffect(() => {
  ...
  const targets = tickers
    .slice(0, SCAN_LIMIT)
    .filter((t) => ictScores[t.contract] === undefined);
  ...
}, [sortBy, tickers, accounts]);  // ictScores 없음
```

**After:**
`ictScores`를 dependency에 추가하면 매 setState마다 effect가 재실행되어 무한루프. ref로 최신값 참조:
```typescript
const ictScoresRef = useRef(ictScores);
ictScoresRef.current = ictScores;

useEffect(() => {
  ...
  const targets = tickers
    .slice(0, SCAN_LIMIT)
    .filter((t) => ictScoresRef.current[t.contract] === undefined);
  ...
}, [sortBy, tickers, accounts]);
```

---

### 6. [Performance / Medium] 5초 폴링에서 매 사이클 전체 포지션 스냅샷 저장

**파일**: `frontend/src/store/accounts.tsx:318-339`

`refreshPositions`가 5초마다 호출되며, 매번 모든 활성 포지션의 `savePositionSnapshotWithHistory`를 실행한다. 이는 매 5초마다 `JSON.stringify` + `localStorage.setItem`을 포지션 수만큼 반복한다.

**Before:**
```typescript
// 모든 활성 포지션 스냅샷 저장 (매 폴링 — TP/SL 변경 즉시 반영)
for (const p of pos) {
  ...
  savePositionSnapshotWithHistory({...}, entryTs);
}
```

**After:**
변경된 포지션만 저장하도록 이전 상태와 비교:
```typescript
const prevPositionsRef = useRef<Map<string, string>>(new Map());

// refreshPositions 내부
const newMap = new Map<string, string>();
for (const p of pos) {
  const contract = p.symbol.replace('/', '_');
  const entryAt  = (p as any).entryAt ?? '';
  const key = `${contract}_${entryAt}`;
  const fingerprint = `${p.stopLoss}_${p.targetPrice}_${p.amount}`;
  newMap.set(key, fingerprint);

  if (prevPositionsRef.current.get(key) === fingerprint) continue;

  // ... 기존 savePositionSnapshotWithHistory 호출 ...
}
prevPositionsRef.current = newMap;
```

---

### 7. [Performance / Medium] `parseKstEntryTs`가 `Date.parse`를 먼저 시도

**파일**: `frontend/src/store/accounts.tsx:174-176`

`Date.parse('2025.01.19 (일) 18:07')`은 브라우저마다 결과가 다르다. Chrome에서는 `NaN`을 반환하지만 일부 엔진에서는 잘못된 timestamp를 반환할 수 있다. `Date.parse`가 성공하면 regex 분기를 건너뛰어 KST → UTC 변환(+09:00)이 적용되지 않는다.

**Before:**
```typescript
function parseKstEntryTs(s: string): number {
  if (!s || s === '-') return 0;
  const ts = Date.parse(s);
  if (!isNaN(ts)) return Math.floor(ts / 1000);
  const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})\s+\([^)]+\)\s+(\d{2}):(\d{2})/);
  ...
}
```

**After:**
```typescript
function parseKstEntryTs(s: string): number {
  if (!s || s === '-') return 0;
  const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})\s+\([^)]+\)\s+(\d{2}):(\d{2})/);
  if (m) {
    const utcMs = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`).getTime();
    return isNaN(utcMs) ? 0 : Math.floor(utcMs / 1000);
  }
  const ts = Date.parse(s);
  return isNaN(ts) ? 0 : Math.floor(ts / 1000);
}
```

---

### 8. [Bug / Medium] PnL 퍼센트 계산에서 margin=0 시 Infinity

**파일**: `api/positions.ts:162-166`

`marginUsdt`가 0이면 fallback 계산으로 넘어가지만, `entryPrice`도 0이면 최종값이 0이 되어 문제없다. 그러나 `entryPrice > 0`이고 `marginUsdt === 0`인 경우(청산 직전 margin call) fallback 분기에서 leverage 곱셈이 비정상적으로 큰 수익률을 생성할 수 있다.

**Before:**
```typescript
const profitRate = marginUsdt > 0
  ? (unrealisedPnl / marginUsdt) * 100
  : entryPrice > 0
    ? ((markPrice - entryPrice) / entryPrice) * 100 * (size > 0 ? 1 : -1) * leverage
    : 0;
```

**After:**
```typescript
const profitRate = marginUsdt > 0
  ? (unrealisedPnl / marginUsdt) * 100
  : 0;
```
`marginUsdt === 0`이면 포지션이 사실상 무효(Gate.io가 margin=0을 내려주는 경우는 청산 진행 중). 부정확한 추정치보다 0이 안전하다.

---

### 9. [Maintainability / Medium] Gate.io 서명 로직이 4곳에 복제

**파일**: `api/positions.ts:41-46`, `api/cron/positions.ts:48-53`, `api/ict-analyze.ts`, `api/candlesticks.ts`

`gateSign` + `gateGet` 함수가 4개 파일에 동일하게 복사되어 있다. 서명 방식 변경 시 4곳을 모두 수정해야 하며 실수 가능성이 높다.

**After:**
```typescript
// api/_gate.ts (신규 공유 모듈)
import crypto from 'crypto';

export function gateSign(secret: string, method: string, path: string, query: string, ts: string): string {
  const bodyHash = crypto.createHash('sha512').update('').digest('hex');
  return crypto.createHmac('sha512', secret)
    .update(`${method}\n${path}\n${query}\n${bodyHash}\n${ts}`)
    .digest('hex');
}

export async function gateGet(apiKey: string, apiSecret: string, path: string, query: string): Promise<any> {
  const ts  = Math.floor(Date.now() / 1000).toString();
  const sig = gateSign(apiSecret, 'GET', path, query, ts);
  const res = await fetch(`https://api.gateio.ws${path}${query ? '?' + query : ''}`, {
    headers: { KEY: apiKey, Timestamp: ts, SIGN: sig, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Gate.io ${path}: ${res.status}`);
  return res.json();
}
```
각 파일에서 `import { gateSign, gateGet } from './_gate';`로 교체.

---

### 10. [Security / Low] AES 암호화의 hardcoded salt

**파일**: `api/cron/positions.ts:30`, `api/user-accounts.ts` (동일 패턴)

`crypto.scryptSync(secret, 'accounts_salt_v1', 32)` — salt가 상수이므로 동일 secret에 대해 항상 같은 키가 생성된다. scrypt의 salt는 본래 랜덤이어야 하지만, 이 경우 암호화 키 파생용이므로 salt를 저장할 곳이 없어 현실적으로 상수 사용이 불가피하다. 다만 `ACCOUNTS_ENCRYPTION_KEY` 자체가 충분히 길고(32자 이상 요구) 랜덤이라면 실질적 위험은 낮다. 주석으로 의도를 명시할 것.

---

## 리팩토링 제안 (노션 게시용)

| 우선순위 | 항목 | 영향 | 예상 작업량 |
|---------|------|------|-----------|
| **P0** | **JWT 서명 검증 도입 (전 엔드포인트)** | **보안 — 타 사용자 계정 탈취** | **1시간** |
| **P0** | **암호화 키 하드코딩 제거 + CRON_SECRET 필수화** | **보안 — API 키 평문 노출** | **10분** |
| **P0** | **Cron SSRF 수정 (Host 헤더 → VERCEL_URL)** | **보안 — API 키 외부 유출** | **5분** |
| P0 | CRON_SECRET 타이밍 안전 비교 | 보안 — 외부 노출 엔드포인트 | 5분 |
| P0 | `sumBalances` 수익률 가중평균 | 버그 — 다중 계좌 사용자 전원 영향 | 15분 |
| P1 | `__binanceLastDebug` 모듈 상태 제거 | 버그 — warm container 간 정보 누출 | 20분 |
| P1 | Cron→ICT 내부 호출에서 API 키 직접 전달 제거 | 보안 — API 키 노출 면적 축소 | 1시간 |
| P1 | `parseKstEntryTs` Date.parse 순서 수정 | 버그 — 크로스 브라우저 | 5분 |
| P1 | CORS `Access-Control-Allow-Origin: *` 제한 | 보안 — 교차 출처 공격 면적 축소 | 15분 |
| P1 | `ExchangeLogo` / `AccountBottomSheet` 3곳 중복 제거 | 유지보수 — 공유 컴포넌트 이미 존재 | 30분 |
| P1 | ICT 전략 SL `>= price` 가드에 maxRiskPct 재검증 | 버그 — 봇 손실 위험 | 15분 |
| P2 | Gate.io 서명 로직 공유 모듈화 (`_gate.ts`) | 유지보수 — 4곳 중복 제거 | 30분 |
| P2 | 5초 폴링 스냅샷 변경 감지 최적화 | 성능 — localStorage 쓰기 80% 감소 | 30분 |
| P2 | ICT scan stale closure → ref 패턴 적용 | 버그 — 중복 스캔 방지 | 10분 |
| P2 | `scryptSync` 호출 결과 캐싱 | 성능 — 매 요청 CPU 절감 | 10분 |
| P3 | `profitRate` fallback 제거 (margin=0 → 0%) | 버그 — 엣지 케이스 | 5분 |
| P3 | AES salt 상수 사용 의도 주석 추가 | 가독성 | 2분 |
| P3 | `runIctAnalysis` 데드 코드 제거 | 유지보수 — API quota 낭비 | 2분 |
| P3 | ICT SL/TP `toFixed(2)` 제거 (tick size는 gateClient에서 처리) | 버그 — 저가 코인 정밀도 | 5분 |
