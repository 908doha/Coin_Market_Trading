# Osprey 코드 리뷰 — 2026-11-09

## 총평

보안 취약점이 가장 긴급하다. JWT 서명 미검증으로 **인증이 완전히 무력화**되어 있고, API 키가 프론트엔드에서 매 요청마다 평문으로 전송된다. 암호화 키 하드코딩 fallback, CORS 와일드카드, cron 인증 바이패스까지 합치면 공격 표면이 넓다. 버그/성능/유지보수 이슈도 다수 있으나 보안 수정이 선행되어야 한다.

**발견 건수**: 총 45건 (중복 제거 후 36건)
- 보안: 10건 (CRITICAL 2, HIGH 4, MEDIUM 4)
- 버그: 11건
- 성능: 5건
- 유지보수성: 7건
- 가독성/타입: 3건

---

## P0 — 즉시 대응 (보안/CRITICAL)

### 1. JWT 서명 미검증 — 인증 우회
**파일**: `api/balance-history.ts:34-46`, `api/user-accounts.ts:19-29`

JWT payload를 base64 디코딩만 하고 서명을 검증하지 않는다. 공격자가 임의의 `user_id`를 담은 가짜 JWT를 만들어 다른 사용자의 거래소 API 키를 탈취할 수 있다.

**Before**:
```ts
function getUserId(req: any): string | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const pad     = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
  const payload = JSON.parse(Buffer.from(pad(parts[1]), 'base64url').toString('utf8'));
  const id      = payload.user_id ?? payload.id ?? payload.sub;
  return id != null ? String(id) : null;
}
```

**After** (`api/_auth.ts`로 공유 모듈 추출):
```ts
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;

export function getUserId(req: any): string | null {
  if (!JWT_SECRET) return null;
  try {
    const auth  = (req.headers?.authorization ?? '') as string;
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;
    const expected = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');
    if (expected !== sigB64) return null;

    const pad     = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
    const payload = JSON.parse(Buffer.from(pad(payloadB64), 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    const id = payload.user_id ?? payload.id ?? payload.sub;
    return id != null ? String(id) : null;
  } catch { return null; }
}
```

---

### 2. API 키 프론트엔드에서 평문 전송 (매 요청)
**파일**: `api/positions.ts:431-439`, `api/ict-analyze.ts:580-697`, `frontend/src/store/accounts.tsx:261-265`, `frontend/app/(main)/analysis/index.tsx:555-558`

프론트엔드가 `{ apiKey, apiSecret }`을 POST body에 넣어 서버로 전송. 5초 폴링 + ICT 스캔으로 분당 수십 회. DevTools Network 탭에서 평문 노출.

**Before**:
```tsx
body: JSON.stringify({ apiKey: account.apiKey, apiSecret: account.apiSecret, contract }),
```

**After** (서버에서 계정 ID + JWT로 복호화):
```tsx
body: JSON.stringify({ accountId: account.id, contract }),
headers: { Authorization: `Bearer ${token}` },
```
서버: `accountId` + JWT의 `userId`로 Supabase에서 암호화된 키를 복호화하여 사용.

---

## P0 — 즉시 대응 (보안/HIGH)

### 3. 암호화 키 하드코딩 fallback
**파일**: `api/user-accounts.ts:43`, `api/cron/positions.ts:29`

`ACCOUNTS_ENCRYPTION_KEY` 미설정 시 `'default_dev_key_change_in_prod!!'`로 fallback. 프로덕션에서 환경변수 누락 시 공개 키로 암호화됨.

**Before**:
```ts
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY ?? 'default_dev_key_change_in_prod!!';
```

**After**:
```ts
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY;
if (!secret) throw new Error('ACCOUNTS_ENCRYPTION_KEY is not set');
```

---

### 4. CORS 와일드카드 on 민감 엔드포인트
**파일**: `api/user-accounts.ts:100`, `api/balance-history.ts:58`, `api/ict-analyze.ts:581`, `api/market-scan.ts:60`

인증이 필요한 엔드포인트에 `Access-Control-Allow-Origin: *` 설정. 임의 도메인에서 사용자 토큰으로 데이터 탈취 가능.

**After**:
```ts
const allowed = process.env.CORS_ORIGIN || 'https://your-app.vercel.app';
res.setHeader('Access-Control-Allow-Origin', allowed);
```

---

### 5. Cron 인증 바이패스
**파일**: `api/cron/positions.ts:236-244`

`CRON_SECRET` 미설정이면 인증을 완전히 건너뜀. 외부에서 호출하여 전체 사용자의 API 키를 사용하게 만들 수 있음.

**Before**:
```ts
const cronSecret = process.env.CRON_SECRET;
if (cronSecret) {
  // ... 비교
}
```

**After**:
```ts
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) { res.status(500).json({ error: 'CRON_SECRET not configured' }); return; }
```

---

### 6. Cron secret 비교 시 timing attack 취약
**파일**: `api/cron/positions.ts:241`

`token !== cronSecret` 문자열 비교는 timing attack에 취약.

**After**: `crypto.timingSafeEqual` 사용 (길이 비교 선행 필수).

---

## P1 — 단기 대응 (버그)

### 7. Token refresh 큐에서 새 토큰 무시
**파일**: `frontend/src/services/client.ts:103-104`

`refreshQueue`에서 대기하던 요청이 `newToken`을 받지만 재시도 시 `tokenStorage.getAccess()`를 다시 호출. Race condition으로 stale 토큰 사용 가능.

**Before**:
```ts
const newToken = await new Promise<string>((resolve) => refreshQueue.push(resolve));
return request<T>(path, options, false);
```

**After**:
```ts
const newToken = await new Promise<string>((resolve) => refreshQueue.push(resolve));
const retryHeaders = { ...options.headers, Authorization: `Bearer ${newToken}` };
return request<T>(path, { ...options, headers: retryHeaders }, false);
```

---

### 8. refreshQueue가 에러 시 영구 대기 (메모리 누수)
**파일**: `frontend/src/services/client.ts:107-113`

`refreshAccessToken()` 실패 시 큐의 Promise들이 영구히 resolve/reject되지 않음.

**After**: catch 블록에서 `reject` 호출 추가. 큐 타입을 `{ resolve, reject }` 으로 변경.

---

### 9. `sumBalances`에서 profitRate 단순 합산 (가중 평균 아님)
**파일**: `frontend/src/store/accounts.tsx:164`

수익률을 계좌 간 단순 합산. Gate.io +5%, Binance -3%면 2%가 되지만 자산 규모별 가중 평균이어야 함.

**Before**:
```ts
profitRate: acc.profitRate + b.profitRate,
```

**After**:
```ts
const totalAmt = valid.reduce((s, b) => s + b.total, 0);
const profitRate = totalAmt > 0
  ? valid.reduce((s, b) => s + b.profitRate * (b.total / totalAmt), 0)
  : 0;
```

---

### 10. ICT FVG CE entry에 `inRange` 가드 누락
**파일**: `api/ict-analyze.ts:463-464`

봇의 `ictStrategy.js:535`에서는 `fvg.atCE && fvg.inRange`를 확인하지만, API 서버에서는 `f.atCE`만 확인. 잘못된 entry 신호 발생 가능 (ICT-01 버그 — 봇에서만 수정됨).

**Before**:
```ts
if (f.atCE) {
```

**After**:
```ts
if (f.atCE && f.inRange) {
```

---

### 11. `rr` 계산 시 0으로 나누기
**파일**: `api/ict-analyze.ts:631-632`

`Math.abs(entry - sl)`이 0이면 `Infinity`. 봇에는 가드가 있지만 API에는 없음.

**After**:
```ts
const risk = Math.abs(entry - sl);
rr = risk > 0 ? (Math.abs(tp - entry) / risk).toFixed(2) : null;
```

---

### 12. `formatKRW`가 음수 부호 삭제
**파일**: `frontend/src/utils/format.ts:3`

`Math.abs(value)` 사용으로 `-50000`이 `"50,000원"`이 됨. 마진 거래에서 음수 잔고 표시 오류.

**After**:
```ts
export function formatKRW(value: number): string {
  const prefix = value < 0 ? '-' : '';
  return `${prefix}${Math.round(Math.abs(value)).toLocaleString('ko-KR')}원`;
}
```

---

### 13. `positions/[id].tsx` useEffect deps에 `id` 누락
**파일**: `frontend/app/(main)/positions/[id].tsx:84, 101`

같은 심볼의 다른 포지션으로 네비게이션하면 symbol이 같아서 effect가 재실행되지 않음.

**After**: `}, [id, position?.symbol]);`

---

### 14. 캔들 0개일 때 200 OK 반환
**파일**: `api/ict-analyze.ts:604-605`

클라이언트가 HTTP 상태만 체크하면 성공으로 오인.

**After**: `res.status(422).json({ error: '캔들 데이터 없음' });`

---

### 15. Dead code — 항상 null 반환
**파일**: `bot/src/api/gateClient.js:255`

```js
return singleParsed && singleParsed.size === 0 ? null : null;
```
조건 무관하게 항상 `null`.

**After**: `return null;`

---

### 16. `positions.ts` 전역 변수 동시성 — 디버그 정보 cross-request 누출
**파일**: `api/positions.ts:255`

`__binanceLastDebug` 모듈 스코프 변수가 다른 요청의 응답 헤더로 누출 가능.

**After**: 함수 반환값으로 전달.

---

### 17. `balance-history.ts` Supabase `.in()` 대량 배열 제한
**파일**: `api/balance-history.ts:175-181`

수천 개 `tsList`가 URL 길이 제한을 초과할 수 있음.

**After**: 500개 단위 청크 처리.

---

## P2 — 중기 대응 (성능/유지보수)

### 18. 5초 폴링 — API 키 분당 수십 회 평문 전송
**파일**: `frontend/src/store/accounts.tsx:396-402`

CLAUDE.md에 "5초 폴링 제거" 커밋이 있으나 코드에 여전히 남아있음.

**After**: 수동 새로고침 또는 WebSocket으로 전환.

---

### 19. ICT 스캔 30종목 순차 API 호출 (90회 Gate.io)
**파일**: `frontend/app/(main)/analysis/index.tsx:500-598`

동시성 5로 30종목, 각각 서버에서 3개 타임프레임 캔들 fetch. 서버 배치 엔드포인트 필요.

---

### 20. cron 순차 처리 — Vercel 10초 타임아웃 위험
**파일**: `api/cron/positions.ts:252-284`

모든 계정을 `for...of`로 순차 처리. `Promise.allSettled` + 데드라인 가드 필요.

---

### 21. Binance Spot 코인별 개별 가격 API 호출
**파일**: `api/exchange/balance.ts:201-210`

코인 20개면 20번 HTTP. Binance `/api/v3/ticker/price` 배치 API로 1회로 축소 가능.

---

### 22. `scryptSync` 매 요청마다 반복
**파일**: `api/user-accounts.ts:42-45`

의도적으로 느린 KDF가 매 암복호화마다 실행. 모듈 레벨 캐싱 필요.

---

### 23. `gateSign`/`gateGet` 4곳 복사
**파일**: `api/positions.ts`, `api/ict-analyze.ts`, `api/cron/positions.ts`, `api/exchange/balance.ts`

**After**: `api/_gate.ts` 공유 모듈 추출.

---

### 24. `decrypt`/`getKey` 2곳 복사
**파일**: `api/user-accounts.ts`, `api/cron/positions.ts`

**After**: `api/_crypto.ts` 추출.

---

### 25. `getSupabase()` 3곳 복사
**파일**: `api/balance-history.ts`, `api/user-accounts.ts`, `api/cron/positions.ts`

**After**: `api/_supabase.ts` 추출.

---

### 26. ICT 지표 함수 9개 인라인 중복
**파일**: `api/ict-analyze.ts:136-356` ↔ `bot/src/utils/indicators`

698줄 파일에 봇과 동일 로직이 인라인. 공유 모듈로 추출하면 #10, #11 같은 동기화 누락도 방지.

---

### 27. `home.tsx` 1259줄 — 차트 빌더 + 8개 서브 컴포넌트
**파일**: `frontend/app/(main)/home.tsx`

`buildChartFromSnapshots`, `SlidingPillTabs`, `CombinedChart`, `ExchangeLogo` 등을 `utils/`와 `components/`로 분리 필요.

---

### 28. ExchangeLogo 3중 복사, AccountBottomSheet 2중 복사
**파일**: `analysis/index.tsx`, `positions/index.tsx`, `home.tsx`

공통 컴포넌트가 이미 `src/components/`에 존재하는데 사용하지 않고 각 파일에 별도 버전 유지.

---

### 29. 환율 fetch 중복
**파일**: `api/exchange/balance.ts:123,240,281,334`

거래소별 함수가 각각 `getUsdtKrwRate()` 독립 호출. handler에서 1회 호출 후 인자로 전달.

---

### 30. 토큰 폴링 1초 간격 → storage 이벤트
**파일**: `frontend/src/store/accounts.tsx:241`

`setInterval` 1초 → `window.addEventListener('storage')` 또는 로그인 콜백에서 직접 호출.

---

### 31. 서버 에러 메시지 클라이언트 노출
**파일**: `api/positions.ts:462`

Gate.io/Binance 에러 메시지에 내부 정보 포함 가능.

**After**: `res.status(502).json({ error: '거래소 연결 실패' });`

---

### 32. `catch(() => {})` 패턴 남용
**파일**: `api/positions.ts:86,98`, `api/ict-analyze.ts:113,117`, `api/cron/positions.ts:101,206`

에러를 무시하면 디버깅 불가. 최소 `console.warn` 필요.

---

### 33. 전 API 핸들러 `req: any, res: any`
**파일**: 모든 API 핸들러

`VercelRequest`/`VercelResponse` 타입으로 교체.

---

### 34. `analysis/index.tsx` useEffect deps에 `accounts` 배열 참조
**파일**: `frontend/app/(main)/analysis/index.tsx:601`

5초 폴링마다 새 참조 생성 → 불필요한 effect 재실행. `firstApiAccount?.id`로 교체.

---

### 35. Binance 디버그 정보 응답 헤더 노출
**파일**: `api/positions.ts:449-451`

프로덕션에서 제거하거나 디버그 토큰으로 게이팅.

---

### 36. Gate.io `futuresPnl` 이중 합산 가능성
**파일**: `api/exchange/balance.ts:388`

`total`이 이미 unrealised PnL 포함이면 이중 계산. Gate.io 문서 확인 필요.

---

## 노션 리팩토링 제안 (우선순위순)

| 우선순위 | 범위 | 작업 | 예상 공수 |
|---------|------|------|----------|
| P0 | 보안 | JWT 서명 검증 도입 (`api/_auth.ts` 공유) | 2h |
| P0 | 보안 | API 키 평문 전송 제거 → 서버사이드 계정 조회 | 4h |
| P0 | 보안 | 암호화 키 fallback 제거 + cron 인증 필수화 | 1h |
| P0 | 보안 | CORS 와일드카드 → 도메인 허용목록 | 1h |
| P1 | 버그 | `client.ts` refreshQueue reject + 토큰 전달 수정 | 1h |
| P1 | 버그 | `ict-analyze.ts` inRange 가드 + rr 0-div 가드 | 30m |
| P1 | 버그 | `formatKRW` 음수 처리 + positions useEffect deps | 30m |
| P1 | 버그 | `ict-analyze.ts` 캔들 없음 시 422 반환 | 15m |
| P2 | 유지보수 | `gateSign`/`decrypt`/`getSupabase` 공유 모듈 추출 | 3h |
| P2 | 유지보수 | ICT 지표 함수 공유 모듈화 (봇/API 통합) | 4h |
| P2 | 유지보수 | ExchangeLogo/AccountBottomSheet 공통 컴포넌트 사용 | 1h |
| P2 | 성능 | Binance 가격 배치 API + 환율 1회 fetch | 1h |
| P2 | 성능 | cron 병렬 처리 + 타임아웃 가드 | 2h |
| P2 | 성능 | scryptSync 캐싱 | 15m |
| P3 | 가독성 | home.tsx 분리 + ict-analyze.ts 분리 | 3h |
| P3 | 타입 | `any` → `VercelRequest`/`VercelResponse` 전환 | 2h |
