# Osprey 코드 리뷰 (2026-10-30)

## 총평

보안 기초가 심각하게 취약하다. **JWT 서명 검증이 전혀 없고**, 다수 API 엔드포인트에 인증 자체가 없으며, 거래소 API 키가 매 요청마다 평문으로 전송된다. 트레이딩 앱에서 이 수준의 보안 결함은 실사용자의 자산 손실로 이어질 수 있다. 성능 측면에서는 5초 폴링이 여전히 상당량의 불필요한 API 호출과 state 갱신을 유발하고, 프론트엔드에서 거래소 API 키가 메모리에 상시 노출되는 구조가 근본적 문제다.

---

## 문제점 리스트

### 1. [Critical / Security] JWT 서명 미검증 — 전체 인증 체계 무력화

**파일**: `api/user-accounts.ts:19-29`, `api/balance-history.ts:34-46`, `api/ict-snapshot.ts:30-42`, `api/exchange/balance.ts` (해당 없이 아예 인증 없음)

JWT payload를 `Base64 decode`만 하고 **서명(signature)을 검증하지 않는다**. 공격자가 임의의 `user_id`를 담은 가짜 JWT를 만들어 보내면:
- 다른 사용자의 거래소 API 키(AES 암호화된 데이터) 조회/덮어쓰기 가능 (`user-accounts`)
- 다른 사용자의 잔고 이력 조회/조작 가능 (`balance-history`)
- 다른 사용자의 ICT 스냅샷 조회/삽입 가능 (`ict-snapshot`)

4개 파일에 동일한 `getUserId()` 함수가 복붙되어 있으며, 모두 서명 미검증이다.

**Before**:
```typescript
// api/user-accounts.ts:19
function decodeJwtPayload(token: string) {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const pad = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
  const decoded = Buffer.from(pad(parts[1]), 'base64url').toString('utf8');
  return JSON.parse(decoded);
}
```

**After**:
```typescript
// api/_auth.ts (공통 모듈로 추출)
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export function verifyAndGetUserId(req: any): string | null {
  if (!JWT_SECRET) return null;
  const auth = req.headers?.authorization ?? req.headers?.Authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    const id = payload.user_id ?? payload.id ?? payload.sub;
    return id != null ? String(id) : null;
  } catch {
    return null;
  }
}
```

---

### 2. [Critical / Security] `/api/positions`, `/api/exchange/balance` — 인증 없이 거래소 API 키 수락

**파일**: `api/positions.ts:431-464`, `api/exchange/balance.ts:408-452`

두 엔드포인트 모두 JWT 검증이 없다. 요청 body에 `apiKey`, `apiSecret`을 직접 받아 거래소 API를 호출한다. 엔드포인트 URL을 아는 누구나 타인의 거래소 키를 사용할 수 있다(키 자체를 알아야 하지만, 네트워크 가로채기·MITM에 취약).

더 심각한 것은 **프론트엔드가 매 5초 폴링마다 거래소 API 키를 평문으로 POST body에 담아 전송**하는 구조 (`positions.service.ts:47`, `store/accounts.tsx:397-401`)다.

**Before**:
```typescript
// api/positions.ts — 인증 없음
export default async function handler(req: any, res: any) {
  const { exchange, apiKey, apiSecret, accountId } = req.body ?? {};
  // ...apiKey/apiSecret으로 직접 거래소 호출
}
```

**After**:
```typescript
// 서버에서 user_id로 Supabase에 저장된 암호화 키를 복호화해서 사용
import { verifyAndGetUserId } from './_auth';
import { decryptAccountKeys } from './_accounts';

export default async function handler(req: any, res: any) {
  const userId = verifyAndGetUserId(req);
  if (!userId) { res.status(401).json({ error: '인증 필요' }); return; }

  const { accountId } = req.body ?? {};
  const account = await decryptAccountKeys(userId, accountId);
  if (!account) { res.status(404).json({ error: '계좌 없음' }); return; }

  const positions = await fetchPositions(account.apiKey, account.apiSecret);
  res.status(200).json(positions);
}
```

---

### 3. [High / Security] 하드코딩된 암호화 키 fallback

**파일**: `api/user-accounts.ts:43`, `api/cron/positions.ts:29`

```typescript
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY ?? 'default_dev_key_change_in_prod!!';
```

환경변수 미설정 시 하드코딩된 키로 거래소 API 키를 암호화한다. 이 코드가 GitHub에 공개돼 있으므로, Vercel 환경변수가 누락되면 **모든 사용자의 거래소 키를 복호화**할 수 있다.

**Before**:
```typescript
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY ?? 'default_dev_key_change_in_prod!!';
```

**After**:
```typescript
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY;
if (!secret) throw new Error('ACCOUNTS_ENCRYPTION_KEY 환경변수 필수');
```

---

### 4. [High / Security] 고정 salt로 scrypt 키 파생

**파일**: `api/user-accounts.ts:44`, `api/cron/positions.ts:29`

```typescript
crypto.scryptSync(secret, 'accounts_salt_v1', 32);
```

모든 사용자가 동일한 salt를 사용하므로, 같은 `ACCOUNTS_ENCRYPTION_KEY`에서 파생되는 AES 키가 항상 동일하다. salt가 코드에 하드코딩되어 있으므로 레인보우 테이블 공격에 취약하다. 사용자별 또는 레코드별 랜덤 salt를 사용해야 한다.

---

### 5. [High / Security] CORS `Access-Control-Allow-Origin: *` — 인증된 엔드포인트에도 적용

**파일**: `api/user-accounts.ts:100`, `api/balance-history.ts:58`, `api/ict-snapshot.ts:52`, `api/ict-analyze.ts:581`, `api/candlesticks.ts:18`

인증이 필요한 엔드포인트에도 `Access-Control-Allow-Origin: *`를 설정하고 있다. 악성 사이트에서 사용자의 브라우저를 통해 API를 호출할 수 있다 (JWT 토큰이 localStorage에 있으므로 직접 CSRF는 안 되지만, 같은 도메인 쿠키 기반 인증 추가 시 즉시 취약).

**After**: 실제 앱 도메인으로 제한
```typescript
const ALLOWED_ORIGINS = ['https://your-app.vercel.app', 'http://localhost:3000'];
const origin = req.headers.origin ?? '';
if (ALLOWED_ORIGINS.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
}
```

---

### 6. [High / Security] cron 엔드포인트 — CRON_SECRET 미설정 시 인증 우회

**파일**: `api/cron/positions.ts:236-244`

```typescript
const cronSecret = process.env.CRON_SECRET;
if (cronSecret) {   // <-- 미설정 시 조건 자체를 건너뜀
  const auth = ...;
  if (token !== cronSecret) { res.status(401)... }
}
```

`CRON_SECRET`이 미설정이면 인증 검사를 **완전히 건너뛴다**. 누구나 `/api/cron/positions`를 호출해 모든 사용자의 거래소 키를 복호화하고 API를 호출할 수 있다.

**Before**:
```typescript
if (cronSecret) {
  if (token !== cronSecret) { res.status(401)... }
}
```

**After**:
```typescript
if (!cronSecret) { res.status(500).json({ error: 'CRON_SECRET 미설정' }); return; }
if (token !== cronSecret) { res.status(401).json({ error: 'Unauthorized' }); return; }
```

---

### 7. [High / Security] cron이 모든 사용자의 API 키를 복호화해 ICT 분석에 평문 전송

**파일**: `api/cron/positions.ts:215-228`

```typescript
const analysis = await fetchIctViaHttp(acc.apiKey, acc.apiSecret, pos.contract, baseUrl);
```

cron이 모든 사용자의 거래소 API 키를 복호화한 뒤, 같은 서버의 `/api/ict-analyze`에 **평문 HTTP POST**로 전송한다. Vercel 내부 호출이라도 요청이 로그에 남을 수 있으며, `ict-analyze` 엔드포인트는 인증 없이 동작한다.

---

### 8. [High / Performance] 5초 폴링 — 거래소 API rate limit 낭비 + 불필요한 렌더링

**파일**: `frontend/src/store/accounts.tsx:394-402`

```typescript
const id = setInterval(() => {
  refreshBalances();   // 모든 계좌 × 거래소 API 호출
  refreshPositions();  // 모든 계좌 × 포지션 + 주문 API 호출
}, 5_000);
```

5초마다:
- 각 계좌별 잔고 API 호출 (Gate.io: spot + futures + tickers = 3회)
- 각 계좌별 포지션 API 호출 (Gate.io: positions + price_orders + orders = 3회)
- 환율 API 호출 (Upbit ticker)
- 모든 포지션에 대해 `appendPricePoint`, `savePositionSnapshotWithHistory` localStorage 쓰기

계좌 2개면 5초마다 ~14회 외부 API 호출. Gate.io rate limit (900 req/min)의 상당 부분을 소모한다.

**After**: WebSocket 또는 최소 15-30초 폴링으로 변경. 포지션 변경 없으면 localStorage 쓰기 스킵.

---

### 9. [Medium / Bug] `sumBalances`에서 `profitRate` 단순 합산

**파일**: `frontend/src/store/accounts.tsx:156-169`

```typescript
profitRate: acc.profitRate + b.profitRate,
```

수익률(%)을 단순 합산하고 있다. 계좌 A가 +10%, 계좌 B가 -5%면 결과가 +5%가 되는데, 이는 투자금 가중 평균이 아닌 산술 합이라 의미가 없다. 계좌 3개면 300%도 나올 수 있다.

**Before**:
```typescript
profitRate: acc.profitRate + b.profitRate,
```

**After**:
```typescript
// sumBalances 후 별도 계산
const totalInvested = valid.reduce((s, b) => s + b.invested, 0);
const totalProfit   = valid.reduce((s, b) => s + b.profitTotal, 0);
const profitRate    = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
```

---

### 10. [Medium / Bug] client.ts의 refresh queue — reject 없음으로 대기 중인 요청 영구 hang

**파일**: `frontend/src/services/client.ts:101-115`

```typescript
if (isRefreshing) {
  const newToken = await new Promise<string>((resolve) => refreshQueue.push(resolve));
  return request<T>(path, options, false);
}
```

`refreshAccessToken()`이 실패하면 `refreshQueue`의 `resolve` 콜백이 **영원히 호출되지 않는다**. 대기 중인 모든 요청이 hang된다.

**Before**:
```typescript
const newToken = await new Promise<string>((resolve) => refreshQueue.push(resolve));
```

**After**:
```typescript
const newToken = await new Promise<string>((resolve, reject) => {
  refreshQueue.push({ resolve, reject });
});
// catch에서:
refreshQueue.forEach(({ reject }) => reject(err));
refreshQueue = [];
```

---

### 11. [Medium / Maintainability] `getUserId()` 함수 4개 파일에 복붙

**파일**: `api/user-accounts.ts:19-39`, `api/balance-history.ts:34-46`, `api/ict-snapshot.ts:30-42`, `api/exchange/balance.ts` (미존재)

동일한 JWT 디코딩 로직이 4개 파일에 복사돼 있다. 한 곳만 수정하면 나머지가 불일치한다.

**After**: `api/_auth.ts`로 추출하여 공통 import.

---

### 12. [Medium / Maintainability] `gateSign()` 함수 4개 파일에 복붙

**파일**: `api/positions.ts:41-46`, `api/trades.ts`, `api/ict-analyze.ts`, `api/cron/positions.ts:48-53`

Gate.io HMAC 서명 함수가 4개 파일에 동일하게 복사돼 있다.

**After**: `api/_gate.ts`로 추출.

---

### 13. [Medium / Maintainability] `getUsdtKrwRate()` 환율 조회 로직 6곳 이상 복붙

**파일**: `api/exchange/balance.ts:23-31`, `api/positions.ts:133-135`, `api/cron/positions.ts:202-206` 등

Upbit 환율 조회 + fallback 1350 패턴이 최소 6곳에 분산돼 있다.

**After**: `api/_rate.ts`로 추출.

---

### 14. [Medium / Bug] Binance 포지션의 `__binanceLastDebug` 모듈 전역 변수 — 동시 요청 경합

**파일**: `api/positions.ts:255`

```typescript
let __binanceLastDebug: string = '';
```

Vercel Serverless Function은 인스턴스가 warm 상태면 여러 요청이 같은 모듈 스코프를 공유한다. 동시에 2명이 Binance 포지션을 조회하면 한 사용자의 디버그 정보가 다른 사용자의 응답 헤더에 노출될 수 있다.

**After**: 함수 내부 변수로 변경하거나, 반환값으로 전달.

---

### 15. [Medium / Performance] 분석 페이지 ICT 스캔 — `useEffect` 의존성에 `accounts` 참조

**파일**: `frontend/app/(main)/analysis/index.tsx:601`

```typescript
}, [sortBy, tickers, accounts]);
```

`accounts` 배열이 5초 폴링마다 새 참조로 생성되므로, ICT 스캔 useEffect가 불필요하게 재실행될 수 있다. `cancelled = true`로 이전 스캔을 취소하지만, 이미 진행 중인 fetch는 취소되지 않으므로 네트워크 낭비.

**After**: `accounts`의 참조 안정성 보장 (useMemo) 또는 의존성에서 `accounts` 대신 `accounts.length` + 첫 번째 계좌 키의 해시 사용.

---

### 16. [Medium / Performance] `balance-history.ts` PATCH — orphan rebind가 N+1 쿼리

**파일**: `api/balance-history.ts:165-205`

orphan account_id마다:
1. `SELECT ts, total` (orphan 행 전체)
2. `SELECT ts` (newAccountId의 기존 행)
3. `DELETE` (중복 ts 삭제)
4. `UPDATE` (나머지 rebind)

orphan이 N개면 4N개의 쿼리가 순차 실행된다.

**After**: 단일 SQL로 처리 (Supabase RPC 활용).
```sql
UPDATE balance_history
SET account_id = $newAccountId
WHERE user_id = $userId
  AND account_id NOT IN ($keepIds)
  AND account_id != ''
  AND (user_id, account_id, ts) NOT IN (
    SELECT user_id, $newAccountId, ts FROM balance_history
    WHERE user_id = $userId AND account_id = $newAccountId
  );
```

---

### 17. [Low / Bug] `makeId()` — 랜덤 충돌 가능

**파일**: `frontend/src/store/accounts.tsx:69-71`

```typescript
function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
```

`Math.random()`은 암호학적으로 안전하지 않고, 동시 호출 시 `Date.now()`가 같아 충돌 가능. `crypto.randomUUID()`가 더 안전하다.

---

### 18. [Low / Performance] localStorage 토큰 폴링 (1초 간격)

**파일**: `frontend/src/store/accounts.tsx:238-250`

```typescript
const interval = setInterval(() => {
  const current = localStorage.getItem(TOKEN_KEY);
  if (current && current !== lastToken) { ... }
}, 1000);
```

토큰 변경 감지를 위해 1초마다 localStorage를 읽는다. `StorageEvent` 리스너 또는 React Context의 토큰 변경 콜백으로 대체해야 한다.

---

### 19. [Low / Maintainability] 분석 페이지에 `AccountBottomSheet` + `ExchangeLogo` 인라인 정의

**파일**: `frontend/app/(main)/analysis/index.tsx:66-254`

이미 `frontend/src/components/AccountBottomSheet.tsx`와 `frontend/src/components/ExchangeLogo.tsx`가 존재하는데, 분석 페이지에서 중복 구현돼 있다. 약 190줄의 불필요한 코드 중복.

---

### 20. [Low / Bug] `runIctAnalysis()` — 항상 `null` 반환하는 데드 함수

**파일**: `api/cron/positions.ts:140-150`

```typescript
async function runIctAnalysis(...): Promise<any> {
  const [htfRaw, mtfRaw, ltfRaw] = await Promise.all([...]);
  return null;  // 항상 null
}
```

Gate.io 캔들 3개를 병렬 fetch한 뒤 아무것도 하지 않고 `null`을 반환한다. `fetchIctViaHttp()`가 실제 사용되므로, 이 함수와 3개의 API 호출이 완전히 데드 코드다. 삭제해야 한다.

---

## 개선 코드 요약 (Before / After)

| # | 위치 | Before | After |
|---|------|--------|-------|
| 1 | `api/*.ts` (4파일) | JWT payload Base64 decode만 | `jwt.verify()` + 공통 `_auth.ts` |
| 2 | `api/positions.ts`, `api/exchange/balance.ts` | body에서 apiKey/apiSecret 직접 수신 | 서버에서 userId로 Supabase 복호화 |
| 3 | `api/user-accounts.ts:43` | `?? 'default_dev_key...'` | 미설정 시 `throw` |
| 4 | `api/user-accounts.ts:44` | 고정 salt `'accounts_salt_v1'` | 레코드별 랜덤 salt |
| 5 | `api/*.ts` (6파일) | `Allow-Origin: *` | 앱 도메인 화이트리스트 |
| 6 | `api/cron/positions.ts:237` | `if (cronSecret) { ... }` | `if (!cronSecret) throw` |
| 7 | `api/cron/positions.ts:267` | HTTP로 apiKey 평문 전송 | cron 내부에서 직접 ICT 분석 실행 |
| 8 | `store/accounts.tsx:397` | 5초 `setInterval` | WebSocket 또는 30초+ 폴링 |
| 9 | `store/accounts.tsx:162` | `profitRate` 합산 | 투자금 가중평균 |
| 10 | `client.ts:103` | `resolve`만 있는 queue | `resolve + reject` queue |
| 11-13 | `api/*.ts` | `getUserId`, `gateSign`, `getUsdtKrwRate` 복붙 | `_auth.ts`, `_gate.ts`, `_rate.ts` |
| 14 | `positions.ts:255` | 모듈 전역 `__binanceLastDebug` | 함수 내부 변수 |
| 15 | `analysis/index.tsx:601` | `[sortBy, tickers, accounts]` | accounts 참조 안정화 |
| 16 | `balance-history.ts:165` | N+1 orphan rebind 쿼리 | 단일 SQL (Supabase RPC) |
| 20 | `cron/positions.ts:140` | 데드 `runIctAnalysis()` | 삭제 |

---

### 21. [Medium / Bug] Gate.io 잔고 `futuresPnl` 이중 계산

**파일**: `api/exchange/balance.ts:388`

```typescript
const totalUsdt = spotTotalUsdt + futuresTotalUsdt + futuresPnl;
```

Gate.io의 `futures.total` 필드는 이미 미실현 손익을 포함한다. `futuresPnl`을 추가로 더하면 미실현 손익이 이중 계산된다.

**After**:
```typescript
const totalUsdt = spotTotalUsdt + futuresTotalUsdt;  // total 이미 PnL 포함
```

---

### 22. [Medium / Bug] Gate.io spot ticker API — 콤마 구분 pairs 미지원

**파일**: `api/exchange/balance.ts:357`

```typescript
const pairs = others.map((a) => `${a.currency}_USDT`).join(',');
const pr = await fetch(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pairs}`);
```

Gate.io `/api/v4/spot/tickers`의 `currency_pair` 파라미터는 단일 페어만 받는다. 콤마 구분 목록을 보내면 첫 번째 페어만 반환되거나 400 에러가 발생한다. 파라미터 없이 전체 조회하거나 개별 호출해야 한다.

---

### 23. [High / Bug] Bot — `gateClient.js:255` dead ternary — 포지션 메타데이터 소실

**파일**: `bot/src/api/gateClient.js:255`

```javascript
return singleParsed && singleParsed.size === 0 ? null : null;
```

양쪽 분기 모두 `null`을 반환하는 데드 코드. size가 0인 포지션의 메타데이터(레버리지, 모드 등)가 항상 버려진다. 호출자가 포지션 모드를 판별하지 못해 SL/TP 배치 시 단방향/양방향 모드를 잘못 감지할 수 있다.

**Before**:
```javascript
return singleParsed && singleParsed.size === 0 ? null : null;
```

**After**:
```javascript
return singleParsed && singleParsed.size === 0 ? null : singleParsed;
```

---

### 24. [High / Bug] Bot — SL override가 maxRiskPct 가드를 우회

**파일**: `bot/src/strategies/ictStrategy.js:701, 746`

구조적 SL 후보가 `price` 이상일 때 고정 % fallback으로 override하는데, 이 fallback 값은 `maxRiskPct` 검증을 거치지 않는다. 부동소수점 오차로 구조적 SL이 price를 미세하게 초과하면, risk cap을 넘는 SL이 설정될 수 있다.

---

### 25. [Medium / Bug] Bot — tick size 계산이 과학적 표기법에서 실패

**파일**: `bot/src/api/gateClient.js:387-388`

```javascript
const decimals = (tick.toString().split('.')[1] || '').length;
```

`tick = 1e-8`이면 `toString()`이 `"1e-8"`을 반환하고, split 결과 `decimals = 3`이 된다 (정답은 8). `toFixed(decimals)`가 잘못된 소수점 자릿수로 반올림하여 주문이 거부될 수 있다.

**After**:
```javascript
const decimals = -Math.floor(Math.log10(tick));
```

---

### 26. [Medium / Performance] Binance spot 잔고 — 코인별 개별 ticker 호출 (N+1)

**파일**: `api/exchange/balance.ts:200-215`

비-USDT 코인마다 별도로 `/api/v3/ticker/price` 호출. 코인 20개면 20회 HTTP 호출. Binance `/api/v3/ticker/price` (파라미터 없이 호출) 또는 `/api/v3/ticker/price?symbols=[...]`로 일괄 조회 가능.

---

### 27. [Medium / Bug] `candlesticks.ts` — contract 파라미터 URL 인코딩 미적용

**파일**: `api/candlesticks.ts`

사용자가 보낸 `contract` 쿼리 파라미터를 `encodeURIComponent()` 없이 Gate.io URL에 직접 삽입. 특수문자가 포함되면 URL이 깨지거나 의도치 않은 경로로 요청이 갈 수 있다.

---

### 28. [Medium / Bug] cron — 사용자 순차 처리로 타임아웃 위험

**파일**: `api/cron/positions.ts:252`

모든 사용자를 `for...of` 순차 루프로 처리. 사용자 N명 × 포지션 M개 = N*(1+M+1)회 순차 API 호출. Vercel Hobby 타임아웃(60초) 내 완료 불가.

**After**: 사용자별 Promise.allSettled로 병렬 처리.

---

## 리팩토링 제안 (노션용)

### Phase 1: 보안 긴급 패치 (1-2일)
1. `api/_auth.ts` 추출 — `jwt.verify()` 사용하는 공통 인증 모듈
2. `/api/positions`, `/api/exchange/balance` — body에서 API 키 수신 제거 → 서버 사이드 복호화
3. 암호화 키 fallback 제거 (throw로 변경)
4. CRON_SECRET 필수화
5. CORS 도메인 화이트리스트

### Phase 2: 구조 개선 (3-5일)
1. `api/_gate.ts` — Gate.io 서명/요청 공통 모듈
2. `api/_rate.ts` — 환율 조회 공통 모듈 (60초 메모리 캐시)
3. `api/cron/positions.ts` 데드 코드 제거
4. `balance-history.ts` PATCH → 단일 SQL
5. `client.ts` refresh queue 에러 처리

### Phase 3: 성능 최적화 (1주)
1. 5초 폴링 → WebSocket 또는 30초 폴링 + 수동 새로고침
2. 분석 페이지 ICT 스캔 useEffect 의존성 최적화
3. localStorage 토큰 감지 → StorageEvent
4. `sumBalances` profitRate 가중평균 수정

### Phase 4: Bot 수정 (1-2일)
1. `gateClient.js:255` dead ternary 수정
2. `ictStrategy.js:701,746` SL override의 maxRiskPct 가드 추가
3. `gateClient.js:387` tick size 과학적 표기법 대응
4. `gateClient.js:418` TP 실패 시 SL rollback의 에러 처리

### Phase 5: 유지보수 (지속)
1. 분석 페이지 내 중복 컴포넌트 → 기존 공통 컴포넌트 import
2. `frontend/api/` 레거시 디렉토리 제거
3. 중첩 디렉토리 (`design-system/design-system/` 등) 정리
4. Supabase 마이그레이션 파일 정비
5. 프로덕션 console.log 제거
6. `(position as any)` 타입 단언 → Position 인터페이스 확장
