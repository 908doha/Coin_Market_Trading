# 코드 리뷰 — 2026-10-28

## 총평

프로덕션에 **인증 우회(JWT 미검증)**, **암호화키 하드코딩**, **CRON 엔드포인트 무인증** 등 **즉시 수정이 필요한 보안 취약점 3건**이 있다. 이 세 가지가 결합되면 "임의 사용자의 거래소 API 키 탈취" 경로가 열린다. 성능/유지보수 측면에서는 Gate.io 서명 로직 5중 복붙, React.memo가 무효화되는 컴포넌트 구조, 토큰 리프레시 레이스 컨디션이 가장 큰 문제다.

**우선순위**: 🔴 CRITICAL > 🟠 HIGH > 🟡 MEDIUM > ⚪ LOW

---

## 문제점 리스트

### 🔴 CRITICAL

#### C-1. JWT 서명 미검증 — 전체 인증 우회
- **파일**: `api/user-accounts.ts:19`, `api/balance-history.ts:34`, `api/ict-snapshot.ts:30`
- `decodeJwtPayload()`가 서명을 검증하지 않고 base64 디코드만 수행
- 공격자가 임의 `user_id`로 JWT를 조작하면 다른 사용자의 거래소 API 키(AES 복호화 포함) 탈취 가능

**Before:**
```ts
function decodeJwtPayload(token: string) {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const pad = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
  const decoded = Buffer.from(pad(parts[1]), 'base64url').toString('utf8');
  return JSON.parse(decoded);
}
```

**After:**
```ts
// api/_auth.ts
import crypto from 'crypto';

export function verifyJwt(token: string): Record<string, any> | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  const pad = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
  const payload = JSON.parse(Buffer.from(pad(parts[1]), 'base64url').toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
```

---

#### C-2. CRON_SECRET 미설정 시 인증 건너뜀
- **파일**: `api/cron/positions.ts:236-244`
- `if (cronSecret)` 조건부이므로 환경변수 누락 시 **모든 사용자의 복호화된 API 키**로 거래소를 호출하고 결과를 반환

**Before:**
```ts
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

**After:**
```ts
import { timingSafeEqual } from 'crypto';

const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) {
  return res.status(500).json({ error: 'CRON_SECRET not configured' });
}
const auth = (req.headers?.authorization ?? '') as string;
const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
const a = Buffer.from(token);
const b = Buffer.from(cronSecret);
if (a.length !== b.length || !timingSafeEqual(a, b)) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

---

#### C-3. AES 암호화키 하드코딩 fallback
- **파일**: `api/user-accounts.ts:43`, `api/cron/positions.ts:29`
- `ACCOUNTS_ENCRYPTION_KEY` 미설정 시 소스코드에 박힌 `'default_dev_key_change_in_prod!!'`로 암호화

**Before:**
```ts
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY ?? 'default_dev_key_change_in_prod!!';
```

**After:**
```ts
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY;
if (!secret) throw new Error('ACCOUNTS_ENCRYPTION_KEY is required');
```

---

### 🟠 HIGH

#### H-1. Host 헤더 기반 URL → SSRF로 API 키 유출
- **파일**: `api/cron/positions.ts:246`
- `req.headers.host` 기반으로 내부 API를 호출하며 복호화된 API 키를 body에 전송
- 공격자가 Host 헤더를 조작하면 자신의 서버로 키가 전송됨

**Before:** `const baseUrl = \`https://${req.headers.host}\`;`
**After:** `const baseUrl = \`https://${process.env.VERCEL_URL || 'your-app.vercel.app'}\`;`

#### H-2. 토큰 리프레시 레이스 컨디션 — 요청 영구 대기
- **파일**: `frontend/src/services/client.ts:64-115`
- `refreshAccessToken()` 실패 시 `refreshQueue`의 Promise가 resolve/reject되지 않아 대기 중인 모든 API 요청이 영구 hang

**Before:**
```ts
try {
  const newToken = await refreshAccessToken();
  refreshQueue.forEach((cb) => cb(newToken));
} finally {
  isRefreshing = false;
}
```

**After:**
```ts
let refreshQueue: Array<{ resolve: (t: string) => void; reject: (e: any) => void }> = [];

try {
  const newToken = await refreshAccessToken();
  refreshQueue.forEach(({ resolve }) => resolve(newToken));
} catch (err) {
  refreshQueue.forEach(({ reject }) => reject(err));
  throw err;
} finally {
  refreshQueue = [];
  isRefreshing = false;
}
```

#### H-3. API 키 평문 전송 + 에러 메시지로 유출 가능
- **파일**: `api/positions.ts:435`, `api/trades.ts:270`, `api/ict-analyze.ts:588`
- `req.body`에서 `apiKey`/`apiSecret`을 직접 받고, `catch`에서 `err.message`를 502로 반환
- 거래소 에러 메시지에 인증 정보 fragment가 포함될 수 있음

**After** (에러 응답):
```ts
} catch (err: any) {
  console.error('[positions]', err?.message?.slice(0, 200));
  res.status(502).json({ error: 'Exchange API error' });
}
```

#### H-4. Analysis 페이지 — React.memo 무효화
- **파일**: `frontend/app/(main)/analysis/index.tsx`
- `TickerRow`가 부모 컴포넌트 내부에 정의되어 매 렌더마다 새 함수 참조 생성 → `React.memo` 무효

**After:** `TickerRow`를 모듈 스코프로 이동, 모든 의존값을 props로 전달

---

### 🟡 MEDIUM

#### M-1. `gateSign`/`gateGet` 5중 복붙
- **파일**: `api/positions.ts`, `api/trades.ts`, `api/ict-analyze.ts`, `api/cron/positions.ts`, `api/exchange/balance.ts`
- 동일 HMAC 로직이 5곳에 복사. 서명 로직 수정 시 5곳 동시 수정 필요
- **After:** `api/_gate.ts`로 추출

#### M-2. `sumBalances`가 수익률을 합산 (%)
- **파일**: `frontend/src/store/accounts.tsx:153-169`
- 계좌 A: 5%, 계좌 B: 3% → 총합이 8%로 표시됨. 가중평균이어야 함

**After:**
```ts
sum.profitRate = sum.invested > 0 ? (sum.profitTotal / sum.invested) * 100 : 0;
sum.profitTodayRate = sum.total > 0 ? (sum.profitToday / sum.total) * 100 : 0;
```

#### M-3. PnL 비율 — 0 나누기
- **파일**: `frontend/src/components/PositionDetailCard.tsx:142`
- `margin === 0`이면 `Infinity%` 표시

**After:** `const pnlPercent = margin !== 0 ? (unrealizedPnl / margin) * 100 : 0;`

#### M-4. `formatCurrency` NaN 전파
- **파일**: `frontend/src/utils/format.ts:8-35`
- `"N/A"` 등이 입력되면 `NaN.toLocaleString()` → UI에 "NaN" 노출

**After:**
```ts
const num = typeof value === 'string' ? parseFloat(value) : value;
if (!Number.isFinite(num)) return currency === 'KRW' ? '₩0' : '$0.00';
```

#### M-5. CORS `Access-Control-Allow-Origin: *` (인증 엔드포인트 6곳)
- **파일**: `user-accounts.ts`, `balance-history.ts`, `ict-snapshot.ts`, `ict-analyze.ts`, `candlesticks.ts`, `market-scan.ts`
- **After:** `process.env.CORS_ORIGIN`으로 제한

#### M-6. localStorage 잔고 이력 무한 누적
- **파일**: `frontend/src/utils/balanceHistory.ts:20-45`
- 삭제 없이 push만 반복 → 수개월 후 5-10MB quota 초과

**After:** `MAX_LOCAL_ENTRIES = 2000` 초과 시 오래된 항목 제거

#### M-7. `__binanceLastDebug` 모듈 레벨 전역 변수
- **파일**: `api/positions.ts:255`
- Warm Lambda에서 동시 요청 간 디버그 데이터가 교차 오염

**After:** 반환값에 포함하여 리턴

---

### ⚪ LOW

| # | 문제 | 파일 |
|---|------|------|
| L-1 | HTTP 메서드 미검증 (`candlesticks.ts` 등) | 여러 API 파일 |
| L-2 | AES decrypt 에러 메시지 노출 | `user-accounts.ts` |
| L-3 | ICT 스냅샷 저장 실패 silent swallow | `ictSnapshot.ts:30` |
| L-4 | `getSupabase()` 매 호출마다 새 클라이언트 생성 | 4개 API 파일 |
| L-5 | 76개 `any` 타입 (API 핸들러) | 전체 API |
| L-6 | 중복 디렉토리 (`design-system/design-system/` 등) | 5개 경로 |
| L-7 | `cron/positions.ts:140` `runIctAnalysis` 데드 코드 | `cron/positions.ts` |
| L-8 | USDT/KRW 환율 중복 조회 (cron 1회 실행 중 3회+) | 여러 파일 |
| L-9 | `exchange` 파라미터 검증 누락 — 에러 메시지에 사용자 입력 반영 | `exchange/balance.ts` |

---

## 리팩토링 제안 (노션 정리용)

### Phase 1 — 즉시 (보안)
1. `api/_auth.ts` 생성: JWT 서명 검증 + `getUserIdFromReq()` 공용 헬퍼
2. `user-accounts.ts`, `balance-history.ts`, `ict-snapshot.ts`에서 import 교체
3. `cron/positions.ts`: `CRON_SECRET` 필수화 + `timingSafeEqual`
4. 암호화키 fallback 제거 (환경변수 필수)
5. `Host` 헤더 대신 `VERCEL_URL` 사용
6. 에러 응답에서 외부 API 메시지 제거 (generic 메시지만 반환)

### Phase 2 — 이번 주 (버그/성능)
1. `api/_gate.ts` 추출 (gateSign/gateGet 통합)
2. `api/_supabase.ts` 추출 (Supabase 클라이언트 싱글톤)
3. `client.ts` refreshQueue에 reject 경로 추가
4. `sumBalances` 수익률 가중평균 수정
5. `formatCurrency` NaN 가드
6. `PositionDetailCard` 0 나누기 방어
7. CORS origin 제한

### Phase 3 — 이번 스프린트 (유지보수/성능)
1. `analysis/index.tsx` TickerRow 모듈 스코프 이동
2. `ExchangeLogo`, `AccountBottomSheet` 중복 제거 (공용 컴포넌트 import)
3. `balanceHistory.ts` localStorage 용량 관리
4. `__binanceLastDebug` 제거 (반환값으로 전환)
5. `any` 타입 → VercelRequest/VercelResponse + 인터페이스
6. 중복 디렉토리 정리 (import 전수 조사 후)
7. 데드 코드 삭제 (`runIctAnalysis`, `frontend/api/`)
