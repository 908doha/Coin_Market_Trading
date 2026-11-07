# Osprey 코드 리뷰 리포트 — 2026-11-07

## 총평

최근 5개 커밋 (Binance TP/SL 견고화, ICT 5-Pillar 시각화, 5초 폴링 제거 + 수동 새로고침, TickerRow memo 등) 기준으로 전체 코드베이스를 API / 프론트엔드 / 봇 전략 3개 영역으로 나누어 리뷰함.

**가장 심각한 이슈**: JWT 서명 미검증(인증 우회), API 키 프론트엔드 평문 전송, 암호화 키 하드코딩 fallback, 봇 듀얼 모드 포지션 누락, `profitRate` 합산 버그. 이 5건은 **보안 사고 또는 금전 손실**로 직결되므로 즉시 수정이 필요하다.

---

## 문제점 리스트 (심각도 순)

### P0 — 즉시 수정 필요

| # | 영역 | 이슈 | 파일 |
|---|------|------|------|
| 1 | API 보안 | JWT 서명 미검증 — payload 디코딩만 수행, 인증 우회 가능 | `balance-history.ts:34`, `user-accounts.ts:19` |
| 2 | API 보안 | 암호화 키 하드코딩 fallback (`'default_dev_key_change_in_prod!!'`) | `user-accounts.ts:43`, `cron/positions.ts:29` |
| 3 | API 보안 | CRON_SECRET 미설정 시 인증 체크 전체 스킵 | `cron/positions.ts:236-244` |
| 4 | 보안 | API 키가 프론트엔드 → 서버로 POST body에 평문 전송 | `analysis/index.tsx:556`, `accounts.tsx:367` |
| 5 | 봇 버그 | 듀얼 모드에서 양방향 포지션 중 하나만 반환, 다른 쪽 무시 | `gateClient.js:236-252` |
| 6 | 프론트 버그 | `sumBalances`에서 `profitRate` 단순 합산 — 수익률 왜곡 | `accounts.tsx:164` |

### P1 — 빠른 시일 내 수정

| # | 영역 | 이슈 | 파일 |
|---|------|------|------|
| 7 | API 보안 | Host 헤더 조작으로 SSRF — API 키가 공격자 서버로 전송될 수 있음 | `cron/positions.ts:246` |
| 8 | API 보안 | CORS `Access-Control-Allow-Origin: *` — 민감 API에 부적절 | 전체 API |
| 9 | API 보안 | Cron 토큰 비교 `===` — 타이밍 공격 취약 | `cron/positions.ts` |
| 10 | 봇 버그 | SL 반올림(`toFixed(2)`) 후 SL이 진입가를 넘어 즉시 청산 가능 | `ictStrategy.js:162` |
| 11 | 봇 버그 | 주문 제출 실패 시 `activePositions` 상태 미롤백 → 유령 포지션 | `ictStrategy.js` |
| 12 | 봇 버그 | ATR=0일 때 TP/SL이 진입가와 동일 → 즉시 청산 | `ictStrategy.js:200-230` |
| 13 | 봇 버그 | `cancelAllOrders` ask/bid 순차 취소 — 한쪽만 취소되는 비대칭 상태 | `gateClient.js:341-342` |
| 14 | 프론트 버그 | `accounts.length` 의존성 — 계정 교체 시 갱신 안됨 | `analysis/index.tsx:424` |

### P2 — 계획 수립 후 수정

| # | 영역 | 이슈 | 파일 |
|---|------|------|------|
| 15 | API 성능 | 외부 API 호출에 타임아웃 없음 — 서버리스 함수 hang | 전체 API |
| 16 | API 성능 | Cron이 계정을 직렬 처리 | `cron/positions.ts:252` |
| 17 | API 성능 | USDT/KRW 환율 매 요청마다 fetch — 인메모리 캐시 필요 | `positions.ts:133` 등 |
| 18 | API 유지보수 | `gateSign` / `gateApiFetch` / `decrypt` 4개 파일 중복 | positions, trades, ict-analyze, cron |
| 19 | 봇 유지보수 | 매직 넘버 산재 (65, 0.001, 5.0, 1.0 등) — CONFIG 객체로 승격 | `ictStrategy.js` 전역 |
| 20 | 봇 보안 | 에러 로그에 API 키/응답 전체 출력 | `gateClient.js:486` |
| 21 | 프론트 성능 | 토큰 폴링 `setInterval(1초)` — `storage` 이벤트로 대체 | `accounts.tsx:237-251` |
| 22 | 프론트 성능 | `Math.max(...prices)` 스택 오버플로 위험 (수천 캔들) | `PositionDetailCard.tsx:366` |
| 23 | 프론트 성능 | CombinedChart 터치 시 650줄 전체 재렌더 — useMemo 필요 | `home.tsx:411-654` |
| 24 | 프론트 유지보수 | `ExchangeLogo` 컴포넌트 3중 중복 | analysis, home, components |
| 25 | 프론트 버그 | ICT 스캔 effect에서 `accounts` 의존성 → 무한 재실행 위험 | `analysis/index.tsx:601` |

---

## 개선 코드 (Before / After)

### 1. JWT 서명 미검증 (P0)

`balance-history.ts:34`, `user-accounts.ts:19` — 동일 패턴

```typescript
// ❌ Before — payload 디코딩만, 서명 검증 없음
function getUserId(req: any): string | null {
  try {
    const auth  = (req.headers?.authorization ?? '') as string;
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;
    const parts   = token.split('.');
    if (parts.length < 2) return null;
    const pad     = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
    const payload = JSON.parse(Buffer.from(pad(parts[1]), 'base64url').toString('utf8'));
    const id      = payload.user_id ?? payload.id ?? payload.sub;
    return id != null ? String(id) : null;
  } catch { return null; }
}
```

```typescript
// ✅ After — JWT 서명 검증 추가
import jwt from 'jsonwebtoken';

function getUserId(req: any): string | null {
  try {
    const auth  = (req.headers?.authorization ?? '') as string;
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    const payload = jwt.verify(token, secret) as any;
    const id = payload.user_id ?? payload.id ?? payload.sub;
    return id != null ? String(id) : null;
  } catch { return null; }
}
```

---

### 2. 암호화 키 하드코딩 fallback (P0)

`user-accounts.ts:43`

```typescript
// ❌ Before
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY ?? 'default_dev_key_change_in_prod!!';
```

```typescript
// ✅ After
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY;
if (!secret) throw new Error('ACCOUNTS_ENCRYPTION_KEY 환경변수 미설정');
```

---

### 3. CRON_SECRET 미설정 시 인증 스킵 (P0)

`cron/positions.ts:236-244`

```typescript
// ❌ Before
const cronSecret = process.env.CRON_SECRET;
if (cronSecret) {
  const auth = (req.headers?.authorization ?? '') as string;
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== cronSecret) { res.status(401).json({ error: 'Unauthorized' }); return; }
}
```

```typescript
// ✅ After
import { timingSafeEqual } from 'crypto';

const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) { res.status(500).json({ error: 'server config error' }); return; }
const auth = (req.headers?.authorization ?? '') as string;
const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
if (token.length !== cronSecret.length ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret))) {
  res.status(401).json({ error: 'Unauthorized' }); return;
}
```

---

### 4. profitRate 합산 버그 (P0)

`frontend/src/store/accounts.tsx:153-169`

```typescript
// ❌ Before — 수익률을 단순 합산 (5% + 3% = 8%로 표시)
return valid.reduce<Balance>(
  (acc, b) => ({
    ...acc,
    profitRate:      acc.profitRate      + b.profitRate,
    profitTodayRate: acc.profitTodayRate + b.profitTodayRate,
  }),
  { total: 0, invested: 0, ... profitRate: 0, profitTodayRate: 0 },
);
```

```typescript
// ✅ After — 자산 가중평균
function sumBalances(bals: (Balance | null)[]): Balance | null {
  const valid = bals.filter((b): b is Balance => b !== null);
  if (!valid.length) return null;
  const sum = valid.reduce<Balance>(
    (acc, b) => ({
      total:       acc.total       + b.total,
      invested:    acc.invested    + b.invested,
      available:   acc.available   + b.available,
      profitTotal: acc.profitTotal + b.profitTotal,
      profitRate:  0,
      profitToday:     acc.profitToday     + b.profitToday,
      profitTodayRate: 0,
    }),
    { total: 0, invested: 0, available: 0, profitTotal: 0, profitRate: 0, profitToday: 0, profitTodayRate: 0 },
  );
  const base = sum.invested || sum.total;
  sum.profitRate      = base > 0 ? (sum.profitTotal / base) * 100 : 0;
  sum.profitTodayRate = base > 0 ? (sum.profitToday / base) * 100 : 0;
  return sum;
}
```

---

### 5. 듀얼 모드 양방향 포지션 누락 (P0)

`bot/src/api/gateClient.js:239-246`

```javascript
// ❌ Before — 첫 non-zero만 반환
if (Array.isArray(body)) {
  for (const pos of body) {
    const parsed = parsePosition(pos);
    if (parsed.size !== 0) return parsed;
  }
}
```

```javascript
// ✅ After — 양방향 감지 + 큰 쪽 반환
if (Array.isArray(body)) {
  const active = body.map(parsePosition).filter(p => p.size !== 0);
  if (active.length > 1) {
    logger.warn(`듀얼 양방향 포지션 감지: ${active.map(p => p.size).join(', ')}`);
  }
  if (active.length > 0) {
    return active.reduce((a, b) => Math.abs(a.size) >= Math.abs(b.size) ? a : b);
  }
}
```

---

### 6. Host 헤더 SSRF (P1)

`cron/positions.ts:246`

```typescript
// ❌ Before — Host 헤더 조작 시 API 키가 공격자 서버로 전송
const baseUrl = `https://${req.headers.host}`;
```

```typescript
// ✅ After
const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : `https://${req.headers.host}`;
```

---

### 7. 외부 API 타임아웃 추가 (P2)

전체 API — 대표 예시

```typescript
// ❌ Before
const raw = await fetch(url, { method, headers });
```

```typescript
// ✅ After
const raw = await fetch(url, {
  method,
  headers,
  signal: AbortSignal.timeout(10_000),
});
```

---

### 8. Math.max spread 스택 오버플로 (P2)

`frontend/src/components/PositionDetailCard.tsx:366, 375-383`

```typescript
// ❌ Before — 수천 캔들 시 스택 오버플로
hi = Math.max(...prices, entry) * 1.003;
lo = Math.min(...prices, entry) * 0.997;
```

```typescript
// ✅ After
let hi = entry, lo = entry;
for (const pt of allPts) {
  if (pt.p > hi) hi = pt.p;
  if (pt.p < lo) lo = pt.p;
}
hi *= 1.003;
lo *= 0.997;
```

---

### 9. cancelAllOrders 비대칭 취소 (P1)

`bot/src/api/gateClient.js:340-348`

```javascript
// ❌ Before — ask 취소 후 bid 취소 실패 시 비대칭
await this.futuresApi.cancelFuturesOrders(SETTLE, contract, { side: 'ask' });
await this.futuresApi.cancelFuturesOrders(SETTLE, contract, { side: 'bid' });
```

```javascript
// ✅ After
const results = await Promise.allSettled([
  this.futuresApi.cancelFuturesOrders(SETTLE, contract, { side: 'ask' }),
  this.futuresApi.cancelFuturesOrders(SETTLE, contract, { side: 'bid' }),
]);
const failed = results.filter(r => r.status === 'rejected');
if (failed.length > 0) {
  logger.error(`주문 취소 일부 실패 [${contract}]: ${failed.map(r => r.reason?.message).join(', ')}`);
  throw failed[0].reason;
}
```

---

### 10. ICT 스캔 effect 무한 재실행 (P2)

`frontend/app/(main)/analysis/index.tsx:601`

```typescript
// ❌ Before — accounts 배열 참조가 폴링마다 변경
}, [sortBy, tickers, accounts]);
```

```typescript
// ✅ After — 안정적 ID 참조
const scanAccountId = useMemo(
  () => accounts.find(a => a.apiKey && a.apiSecret)?.id,
  [accounts],
);
// ...
}, [sortBy, tickers, scanAccountId]);
```

---

## 노션 리팩토링 제안

| 우선순위 | 항목 | 예상 작업 | 비고 |
|---------|------|----------|------|
| **P0** | JWT 서명 검증 추가 | 2h | `api/_jwt.ts` 공통 모듈로 추출 |
| **P0** | 암호화 키 fallback 제거 | 15m | 환경변수 필수화 |
| **P0** | CRON_SECRET 필수화 + timingSafeEqual | 30m | |
| **P0** | API 키 서버사이드 복호화 전환 | 4h | 프론트 + API 양쪽 변경 |
| **P0** | profitRate 가중평균 수정 | 30m | |
| **P0** | 듀얼 모드 양방향 포지션 처리 | 1h | |
| **P1** | Host 헤더 SSRF 수정 | 15m | VERCEL_URL 사용 |
| **P1** | CORS origin 제한 | 1h | 환경변수로 허용 origin 관리 |
| **P1** | SL 반올림 후 재검증 | 30m | |
| **P1** | 주문 실패 시 상태 롤백 | 1h | |
| **P1** | ATR=0 가드 추가 | 15m | |
| **P1** | cancelAllOrders Promise.allSettled | 30m | |
| **P1** | accounts.length 의존성 수정 | 15m | |
| **P2** | gateSign 등 4파일 공통 모듈 추출 | 2h | `api/_gate.ts` |
| **P2** | 외부 API 타임아웃 추가 | 1h | AbortSignal.timeout |
| **P2** | USDT/KRW 환율 인메모리 캐시 | 30m | 30초 TTL |
| **P2** | Cron 병렬 처리 | 1h | Promise.allSettled + 배치 |
| **P2** | 매직 넘버 CONFIG 객체 승격 | 1h | ictStrategy.js |
| **P2** | 에러 로그 민감정보 필터링 | 30m | gateClient.js |
| **P2** | 토큰 폴링 → storage 이벤트 | 30m | accounts.tsx |
| **P2** | Math.max spread → reduce | 15m | PositionDetailCard |
| **P2** | CombinedChart useMemo 분리 | 1h | home.tsx |
| **P2** | ExchangeLogo 중복 제거 | 30m | 공통 컴포넌트 1개로 |
| **P2** | ICT 스캔 effect 의존성 안정화 | 15m | analysis/index.tsx |

**총 예상 작업량**: ~20시간 (P0만 ~8시간)
