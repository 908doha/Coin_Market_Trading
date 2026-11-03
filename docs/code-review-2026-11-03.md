# 코드 리뷰 리포트 — 2026-11-03

## 총평

**보안이 가장 취약한 계층이다.** JWT 서명 검증이 전혀 없어 누구든 임의의 `user_id`로 API를 호출할 수 있고, cron 인증도 타이밍 공격에 노출되어 있다. 프론트엔드에서 API 키가 평문으로 전송되는 구조는 서버 로그에 크리덴셜이 남는 치명적 위험이 있다. 봇 쪽은 `getExistingOrders()`의 에러 시 빈 배열 반환이 중복 주문으로 이어질 수 있어 금전적 손실 가능성이 있다.

유지보수 면에서는 `gateSign` 함수가 4개 파일에 복사-붙이기로 존재하고, JWT 디코딩 로직도 3곳에서 중복된다. 프론트엔드 `accounts.tsx`의 5초 폴링은 이전 요청 완료를 확인하지 않아 느린 네트워크에서 요청이 쌓인다.

---

## 문제점 리스트

### CRITICAL

#### 1. JWT 서명 검증 없음 — 인증 우회
**파일**: `api/user-accounts.ts:19-29`, `api/balance-history.ts:34-46`
**카테고리**: 보안

JWT 토큰의 페이로드만 Base64 디코딩하고 서명을 전혀 검증하지 않는다. 공격자가 `{"user_id":"victim_id"}`를 Base64 인코딩한 가짜 토큰으로 다른 사용자의 암호화된 API 키를 조회/덮어쓰기 가능하다.

**Before:**
```typescript
// api/user-accounts.ts
function decodeJwtPayload(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const pad = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
    const decoded = Buffer.from(pad(parts[1]), 'base64url').toString('utf8');
    return JSON.parse(decoded);
  } catch { return null; }
}
```

**After:**
```typescript
import jwt from 'jsonwebtoken';

function verifyJwt(token: string): { user_id?: string; id?: string; sub?: string } | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;
  } catch {
    return null;
  }
}
```

---

#### 2. Cron 시크릿 비교가 타이밍 공격에 취약
**파일**: `api/cron/positions.ts:237-244`
**카테고리**: 보안

`===` 비교는 문자열 길이에 비례하는 시간이 걸려, 공격자가 한 바이트씩 시크릿을 추측 가능하다.

**Before:**
```typescript
if (token !== cronSecret) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}
```

**After:**
```typescript
import crypto from 'crypto';

const expected = Buffer.from(cronSecret, 'utf8');
const received = Buffer.from(token, 'utf8');
if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}
```

---

#### 3. API 키가 POST body로 프론트엔드 → 서버 간 매 요청마다 평문 전송
**파일**: `api/positions.ts:434-439`, `frontend/src/store/accounts.tsx:367-369`
**카테고리**: 보안

포지션/ICT 분석 요청마다 `apiKey`와 `apiSecret`이 POST body로 전송된다. Vercel의 function 로그, 에러 트래킹(Sentry 등), CDN 중간자 등에 크리덴셜이 기록될 수 있다. `exchange_accounts` 테이블에 암호화 저장하는 의미가 퇴색된다.

**After (설계 변경 필요):**
- 프론트엔드는 `accountId`만 전송
- 서버 측에서 `exchange_accounts` 테이블에서 복호화하여 사용
- API 키가 클라이언트 ↔ 서버 간 네트워크를 타지 않도록 변경

```typescript
// api/positions.ts — 요청에서 accountId만 받고 서버에서 키 복호화
const { exchange, accountId } = req.body ?? {};
const credentials = await getDecryptedCredentials(userId, accountId);
```

---

#### 4. 봇: `getExistingOrders()` 에러 시 빈 배열 → 중복 주문 위험
**파일**: `bot/src/api/gateClient.js:509-518` (`listTriggerOrders`)
**카테고리**: 금전적 위험

`listTriggerOrders`가 에러 시 빈 배열을 반환한다. 호출측이 "기존 주문 없음"으로 해석하여 이미 존재하는 SL/TP 위에 중복 주문을 등록, 포지션 사이즈가 의도치 않게 배증될 수 있다.

**Before:**
```javascript
async listTriggerOrders(contract, status = 'open') {
  try {
    // ...
  } catch (err) {
    logger.error(`조건부 주문 목록 조회 실패 [${contract}]: ${err.message}`);
    return []; // ← 에러를 "빈 결과"와 구분 불가
  }
}
```

**After:**
```javascript
async listTriggerOrders(contract, status = 'open') {
  try {
    const { body } = await this.futuresApi.listPriceTriggeredOrders(SETTLE, status, { contract });
    if (!Array.isArray(body)) return [];
    return body.filter((o) => o && o.initial && o.initial.contract === contract);
  } catch (err) {
    logger.error(`조건부 주문 목록 조회 실패 [${contract}]: ${err.message}`);
    throw err; // 호출측에서 catch하여 주문을 건너뛰도록
  }
}
```

---

### HIGH

#### 5. AES 암호화 키 하드코딩 폴백
**파일**: `api/user-accounts.ts:43`, `api/cron/positions.ts:29`
**카테고리**: 보안

`ACCOUNTS_ENCRYPTION_KEY` 미설정 시 `'default_dev_key_change_in_prod!!'`로 폴백. 환경변수 누락 시 모든 사용자의 API 키가 알려진 키로 암호화된다.

**Before:**
```typescript
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY ?? 'default_dev_key_change_in_prod!!';
```

**After:**
```typescript
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY;
if (!secret) throw new Error('ACCOUNTS_ENCRYPTION_KEY 환경변수 필수');
```

---

#### 6. 5초 폴링이 이전 요청 완료를 확인하지 않음
**파일**: `frontend/src/store/accounts.tsx:396-402`
**카테고리**: 성능 / 버그

`setInterval` 5초마다 `refreshBalances()` + `refreshPositions()`를 호출하지만, 이전 요청이 아직 진행 중인지 확인하지 않는다. 네트워크가 느리면 요청이 누적되어 브라우저 커넥션 풀이 고갈되고 UI가 멈출 수 있다.

**Before:**
```typescript
const id = setInterval(() => {
  refreshBalances();
  refreshPositions();
}, 5_000);
```

**After:**
```typescript
const inFlightRef = useRef(false);
// ...
const id = setInterval(async () => {
  if (inFlightRef.current) return;
  inFlightRef.current = true;
  try {
    await Promise.all([refreshBalances(), refreshPositions()]);
  } finally {
    inFlightRef.current = false;
  }
}, 5_000);
```

---

#### 7. `gateSign` 함수가 4곳에 복사-붙이기
**파일**: `api/positions.ts:41-46`, `api/cron/positions.ts:48-53`, `api/ict-analyze.ts`, `api/candlesticks.ts`
**카테고리**: 유지보수

HMAC 서명 로직이 동일한데 4파일에 중복. 서명 방식 변경 시 한 곳이라도 놓치면 인증 실패.

**After:**
```typescript
// api/_gate.ts — 공통 모듈
import crypto from 'crypto';

export function gateSign(apiSecret: string, method: string, path: string, query: string, ts: string): string {
  const bodyHash = crypto.createHash('sha512').update('').digest('hex');
  return crypto.createHmac('sha512', apiSecret)
    .update(`${method}\n${path}\n${query}\n${bodyHash}\n${ts}`)
    .digest('hex');
}

export async function gateGet(apiKey: string, apiSecret: string, path: string, query: string): Promise<any> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = gateSign(apiSecret, 'GET', path, query, ts);
  const res = await fetch(`https://api.gateio.ws${path}${query ? '?' + query : ''}`, {
    method: 'GET',
    headers: { KEY: apiKey, Timestamp: ts, SIGN: sig, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Gate.io ${path}: ${res.status}`);
  return res.json();
}
```

---

#### 8. Cron이 API 키를 HTTP 평문으로 self-call
**파일**: `api/cron/positions.ts:215-228`
**카테고리**: 보안

`fetchIctViaHttp`가 복호화된 `apiKey`/`apiSecret`을 HTTP body로 자기 서버에 POST한다. Vercel function 로그에 기록될 수 있고, 내부 호출이라도 네트워크를 타기 때문에 중간자 위험이 있다.

**After (설계 제안):**
ICT 분석 로직을 공유 모듈로 추출하여 직접 호출, HTTP 전송 제거.

---

#### 9. 에러 메시지에 내부 정보 노출
**파일**: `api/user-accounts.ts:140-143`, `api/balance-history.ts:214-217`
**카테고리**: 보안

catch 블록에서 `err.message`를 그대로 응답에 포함. Supabase 에러 메시지에 테이블명, 컬럼명 등 내부 스키마 정보가 포함될 수 있다.

**Before:**
```typescript
res.status(502).json({ error: err?.message ?? 'Internal error' });
```

**After:**
```typescript
console.error('[user-accounts]', err);
res.status(502).json({ error: '서버 오류가 발생했어요' });
```

---

#### 10. `CORS: Access-Control-Allow-Origin: *` — 크리덴셜 API에 와일드카드
**파일**: `api/user-accounts.ts:100`, `api/balance-history.ts:58`
**카테고리**: 보안

암호화된 API 키를 반환하는 엔드포인트에 `*` CORS. 악성 사이트에서 피해자 브라우저의 인증 쿠키/토큰으로 요청 가능.

**After:**
```typescript
const allowed = process.env.ALLOWED_ORIGINS?.split(',') ?? ['https://your-app.vercel.app'];
const origin = req.headers.origin ?? '';
if (allowed.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}
```

---

### MEDIUM

#### 11. 봇: 포지션 청산에 동시성 제어 없음
**파일**: `bot/src/api/gateClient.js:264-281` (`closePosition`)
**카테고리**: 금전적 위험

두 시그널이 동시에 `closePosition`을 호출하면 둘 다 `getPosition`에서 활성 포지션을 보고 청산 주문을 제출한다. 첫 번째가 청산에 성공한 뒤 두 번째가 실행되면 반대 포지션이 열릴 수 있다 (reduce_only가 있어 완화되지만, autoSize와 조합 시 edge case 존재).

**After:**
```javascript
const closeLocks = new Map();

async closePosition(contract) {
  if (closeLocks.has(contract)) return closeLocks.get(contract);
  const promise = this._doClose(contract).finally(() => closeLocks.delete(contract));
  closeLocks.set(contract, promise);
  return promise;
}
```

---

#### 12. `scryptSync` 매 요청마다 호출 — CPU 바운드
**파일**: `api/user-accounts.ts:42-45`, `api/cron/positions.ts:28-31`
**카테고리**: 성능

`crypto.scryptSync`는 의도적으로 느린 KDF. Vercel serverless에서 매 요청마다 호출하면 cold start + 응답 지연이 생긴다.

**After:**
```typescript
let _cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const secret = process.env.ACCOUNTS_ENCRYPTION_KEY;
  if (!secret) throw new Error('ACCOUNTS_ENCRYPTION_KEY 필수');
  _cachedKey = crypto.scryptSync(secret, 'accounts_salt_v1', 32);
  return _cachedKey;
}
```

---

#### 13. `localStorage` 포지션 스냅샷 무한 성장
**파일**: `frontend/src/utils/positionSnapshot.ts` (via `accounts.tsx:328`)
**카테고리**: 버그

매 폴링마다 `savePositionSnapshotWithHistory`로 스냅샷을 저장하지만, 청산된 포지션의 스냅샷을 정리하는 로직이 없다. 장기 사용 시 localStorage 용량 제한(5-10MB)에 도달하면 모든 저장이 실패한다.

**After:**
청산 감지 시 (포지션 목록에서 사라진 contract) 해당 스냅샷 키를 삭제하는 cleanup 로직 추가.

---

#### 14. Upbit 환율 실패 시 하드코딩 1350원 폴백
**파일**: `api/cron/positions.ts:202-206`, `api/positions.ts:133-135`
**카테고리**: 버그

Upbit API 장애 시 환율이 1350원으로 고정된다. 실제 USDT/KRW가 1450원이면 잔고가 7% 과소 표시되고, 잘못된 값이 `balance_history`에 영구 저장된다.

**After:**
```typescript
let usdtKrw = 0;
try {
  const [t] = await (await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT')).json();
  usdtKrw = t.trade_price;
} catch {}
if (!usdtKrw) {
  // fallback: Binance P2P rate or cached last known rate
  try {
    const cached = await sb.from('app_config').select('value').eq('key', 'usdt_krw').single();
    usdtKrw = Number(cached.data?.value) || 0;
  } catch {}
}
if (!usdtKrw) throw new Error('환율 조회 실패 — 스냅샷 저장 건너뜀');
```

---

#### 15. Cron 빈 catch 블록이 복호화 실패를 숨김
**파일**: `api/cron/positions.ts:101`
**카테고리**: 유지보수

`getAllAccounts()`에서 `decrypt` 실패 시 빈 catch로 무시. 암호화 키 변경이나 데이터 손상을 감지할 수 없다.

**Before:**
```typescript
try {
  const decrypted = decrypt(row.data);
  // ...
} catch {}
```

**After:**
```typescript
try {
  const decrypted = decrypt(row.data);
  // ...
} catch (e) {
  console.error(`[cron] user_id=${row.user_id} 복호화 실패:`, e);
}
```

---

### LOW

#### 16. Binance 디버그 정보가 모듈 레벨 변수에 저장
**파일**: `api/positions.ts:255`
**카테고리**: 버그 가능성

`let __binanceLastDebug` 모듈 레벨 변수는 Vercel serverless에서 같은 인스턴스가 여러 요청을 처리할 때 이전 요청의 디버그 정보가 다음 요청에 노출될 수 있다.

---

#### 17. `sumBalances`에서 profitRate 단순 합산
**파일**: `frontend/src/store/accounts.tsx:153-169`
**카테고리**: 버그

`profitRate`를 단순 합산하고 있어 계좌가 2개 이상이면 수익률이 의미 없는 값이 된다. 가중 평균이어야 한다.

**Before:**
```typescript
profitRate: acc.profitRate + b.profitRate,
```

**After:**
```typescript
// sumBalances 외부에서 가중 평균 계산
const totalInvested = valid.reduce((s, b) => s + b.invested, 0);
const profitRate = totalInvested > 0
  ? valid.reduce((s, b) => s + b.profitRate * (b.invested / totalInvested), 0)
  : 0;
```

---

## 노션 리팩토링 제안

| 우선순위 | 작업 | 예상 공수 | 영향 |
|---------|------|----------|------|
| P0 | JWT 서명 검증 도입 (`jsonwebtoken` 사용) | 2h | 인증 우회 차단 |
| P0 | API 키 서버사이드 조회로 전환 (클라이언트에서 키 전송 제거) | 4h | 크리덴셜 네트워크 노출 차단 |
| P0 | Cron 시크릿 `timingSafeEqual` 적용 | 30m | 타이밍 공격 차단 |
| P0 | 암호화 키 하드코딩 폴백 제거 | 30m | 기본 키로 암호화되는 사고 방지 |
| P1 | `gateSign`/`gateGet`/JWT 디코딩 공통 모듈 추출 | 2h | 4파일 중복 제거, 변경 시 일관성 |
| P1 | Cron self-call 제거 → ICT 분석 로직 공유 모듈화 | 3h | 내부 HTTP로 키 전송 제거 |
| P1 | 폴링 in-flight 가드 추가 | 1h | 느린 네트워크에서 요청 누적 방지 |
| P1 | CORS 오리진 화이트리스트 | 1h | 크리덴셜 API 보호 |
| P1 | 에러 응답에서 내부 메시지 제거 | 1h | 정보 노출 방지 |
| P2 | `scryptSync` 결과 캐싱 | 30m | Cold start 성능 개선 |
| P2 | 봇 `listTriggerOrders` 에러 시 throw | 1h | 중복 주문 방지 |
| P2 | 봇 `closePosition` 동시성 제어 | 1h | 동시 청산 시 반대 포지션 방지 |
| P2 | 환율 폴백 개선 (캐싱 or 다중 소스) | 2h | 잘못된 잔고 기록 방지 |
| P3 | localStorage 스냅샷 cleanup | 1h | 장기 사용 시 저장 실패 방지 |
| P3 | `profitRate` 가중 평균 수정 | 30m | 다중 계좌 수익률 표시 정확도 |
