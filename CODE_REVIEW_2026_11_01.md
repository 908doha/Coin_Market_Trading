# Osprey 코드 리뷰 — 2026-11-01

## 총평

보안, 성능, 유지보수성 전반에 걸쳐 **치명적 1건, 심각 7건, 중간 14건, 낮음 10건** — 총 32건을 발견했다.

**즉시 조치 필요 (P0):**
1. **JWT 서명 미검증** — `api/user-accounts.ts`, `api/balance-history.ts`, `api/ict-snapshot.ts` 3곳에서 JWT payload를 Base64 디코딩만 하고 서명을 확인하지 않는다. 공격자가 임의의 `user_id`로 JWT를 조작하면 **다른 사용자의 거래소 API 키를 탈취**할 수 있다.
2. **AES 암호화 키 하드코딩 fallback** — 환경변수 미설정 시 소스코드에 공개된 기본 키로 모든 API 키가 복호화 가능
3. **CRON_SECRET 미설정 시 인증 우회** + 타이밍 공격 취약점
4. **API 키가 프론트엔드→서버 HTTP body로 평문 전송** — 브라우저 DevTools에서 노출

**주요 유지보수 부채:**
5. **gateSign() 6중 복사붙이기** — 서명 로직 변경 시 6개 파일을 동시에 수정해야 하는 폭탄
6. **getUserId/getSupabase/decrypt 각각 3~5곳 복사** — 보안 패치 적용이 일관되지 못할 위험

---

## 문제점 리스트

### [S-00] 🔴🔴 JWT 서명 미검증 — 임의 사용자 위장 가능 (CRITICAL)
- **파일**: `api/user-accounts.ts:19-28`, `api/balance-history.ts:34-46`, `api/ict-snapshot.ts:30-42`
- **심각도**: 치명적 (보안)
- **설명**: `getUserId()` / `decodeJwtPayload()`가 JWT 토큰의 **서명을 검증하지 않고** Base64 payload만 디코딩하여 `user_id`를 추출한다. 공격자가 `{"user_id":"victim_id"}` payload를 담은 가짜 JWT를 만들어 보내면, 피해자의 **암호화된 거래소 API 키를 탈취**하거나 덮어쓸 수 있다. 이 함수가 3곳에 동일하게 복사되어 있어 3개 엔드포인트 모두 취약하다.

**Before** (`api/user-accounts.ts:19-28`):
```typescript
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

**After** (`api/_jwt.ts` 공유 모듈로 추출):
```typescript
import crypto from 'crypto';

export function verifyAndGetUserId(req: any): string | null {
  const auth  = (req.headers?.authorization ?? '') as string;
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;

  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  // 서명 검증 (HMAC-SHA256)
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest('base64url');

  if (!crypto.timingSafeEqual(
    Buffer.from(expectedSig), Buffer.from(parts[2])
  )) return null;

  const pad     = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
  const payload = JSON.parse(Buffer.from(pad(parts[1]), 'base64url').toString('utf8'));

  // 만료 검증
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  const id = payload.user_id ?? payload.id ?? payload.sub;
  return id != null ? String(id) : null;
}
```

---

### [S-01] 🔴 CRON_SECRET 타이밍 공격 취약점
- **파일**: `api/cron/positions.ts:240`
- **심각도**: 높음 (보안)
- **설명**: `token !== cronSecret` 은 문자열 길이에 비례하는 시간에 비교를 수행한다. 외부 공격자가 응답 시간 차이를 측정해 토큰을 1바이트씩 추출할 수 있다.

**Before**:
```typescript
if (token !== cronSecret) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}
```

**After**:
```typescript
import { timingSafeEqual } from 'crypto';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ...handler 내부
if (!safeCompare(token, cronSecret)) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}
```

---

### [S-02] 🔴 Cron→ICT 내부 호출 시 API 키 평문 전송
- **파일**: `api/cron/positions.ts:217-220`
- **심각도**: 높음 (보안)
- **설명**: `fetchIctViaHttp()`가 사용자의 `apiKey`, `apiSecret`을 JSON body로 자기 자신의 `/api/ict-analyze` 엔드포인트에 POST한다. Vercel 내부라도 네트워크 로그에 평문 키가 남을 수 있고, `baseUrl`이 `req.headers.host`에서 오므로 Host 헤더 조작 시 외부로 키가 유출될 수 있다.

**Before**:
```typescript
const baseUrl = `https://${req.headers.host}`;
// ...
body: JSON.stringify({ apiKey, apiSecret, contract }),
```

**After**:
```typescript
// 방법 1: ict-analyze 로직을 공유 모듈로 추출하여 직접 호출 (권장)
import { analyzeIct } from '../_shared/ict-analyzer';
const analysis = await analyzeIct(apiKey, apiSecret, contract);

// 방법 2: 최소한 baseUrl을 환경변수로 고정
const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : `https://${req.headers.host}`;
```

---

### [S-03] 🔴 CRON_SECRET 미설정 시 인증 우회
- **파일**: `api/cron/positions.ts:237`
- **심각도**: 높음 (보안)
- **설명**: `if (cronSecret)` — 환경변수가 없으면 인증 체크 자체를 건너뛴다. 개발 편의를 위한 것이겠지만, 프로덕션에서 실수로 환경변수를 빠뜨리면 누구나 cron 엔드포인트를 호출하여 모든 사용자의 포지션/잔고를 조회할 수 있다.

**Before**:
```typescript
const cronSecret = process.env.CRON_SECRET;
if (cronSecret) {
  // 인증 체크
}
```

**After**:
```typescript
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) {
  console.error('CRON_SECRET 환경변수 미설정');
  res.status(500).json({ error: 'Server misconfigured' });
  return;
}
```

---

### [S-04] 🔴 AES 암호화 기본 키 하드코딩
- **파일**: `api/cron/positions.ts:29`
- **심각도**: 높음 (보안)
- **설명**: `ACCOUNTS_ENCRYPTION_KEY`가 없으면 `'default_dev_key_change_in_prod!!'` 를 사용한다. 이 값은 소스코드에 공개되어 있으므로, 환경변수 미설정 시 모든 저장된 API 키를 누구나 복호화할 수 있다.

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

### [M-01] 🟡 gateSign() 5중 복사붙이기
- **파일**: `api/positions.ts:41`, `api/trades.ts`, `api/ict-analyze.ts`, `api/cron/positions.ts:48`, `bot/src/api/gateClient.js`
- **심각도**: 높음 (유지보수성)
- **설명**: 동일한 HMAC-SHA512 서명 함수가 5개 파일에 복사되어 있다. Gate.io가 서명 스키마를 변경하면 5곳 모두 수정해야 하며, 한 곳이라도 빠지면 프로덕션 장애.

**After**:
```typescript
// api/_shared/gate.ts (신규 공유 모듈)
import crypto from 'crypto';

export function gateSign(
  apiSecret: string, method: string, path: string,
  query: string, ts: string, body = ''
): string {
  const bodyHash = crypto.createHash('sha512').update(body).digest('hex');
  return crypto.createHmac('sha512', apiSecret)
    .update(`${method}\n${path}\n${query}\n${bodyHash}\n${ts}`)
    .digest('hex');
}

export async function gateGet(
  apiKey: string, apiSecret: string, path: string, query: string
): Promise<any> {
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

### [M-02] 🟡 KRW 환율 중복 조회 (매 API 호출마다)
- **파일**: `api/positions.ts:133`, `api/cron/positions.ts:204`, `api/exchange/balance.ts`
- **심각도**: 중간 (성능)
- **설명**: 모든 API 호출이 Upbit 환율을 개별 fetch한다. 동시에 여러 사용자의 포지션을 처리할 때 불필요한 중복 호출이 발생하고, Upbit API rate limit에 걸릴 수 있다.

**After**:
```typescript
// api/_shared/exchange-rate.ts
let cached: { rate: number; ts: number } | null = null;
const TTL = 30_000; // 30초

export async function getUsdtKrw(): Promise<number> {
  if (cached && Date.now() - cached.ts < TTL) return cached.rate;
  try {
    const [t] = await (await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT')).json();
    cached = { rate: t.trade_price, ts: Date.now() };
    return cached.rate;
  } catch {
    return cached?.rate ?? 1350;
  }
}
```

---

### [M-03] 🟡 5초 폴링이 여전히 활성 (코드 모순)
- **파일**: `frontend/src/store/accounts.tsx:394-402`
- **심각도**: 중간 (성능/버그)
- **설명**: 커밋 `bfcdaa1` 메시지는 "5초 자동 폴링 제거 + 수동 새로고침 버튼 복귀"라고 하지만, 실제 코드에는 5초 `setInterval`이 그대로 남아있다. 매 5초마다 잔고 + 포지션 API를 모든 계정에 대해 호출하므로, 계정 3개 기준 초당 1.2개의 Gate.io API 호출이 발생한다.

**Before** (`accounts.tsx:394-402`):
```typescript
useEffect(() => {
  if (isLoading || accounts.length === 0) return;
  const id = setInterval(() => {
    refreshBalances();
    refreshPositions();
  }, 5_000);
  return () => clearInterval(id);
}, [isLoading, accounts.length, refreshBalances, refreshPositions]);
```

**After** (수동 새로고침 전용으로 변경하거나, 최소 30초로 늘리기):
```typescript
// 자동 갱신이 필요하다면 최소 30초 간격
useEffect(() => {
  if (isLoading || accounts.length === 0) return;
  const id = setInterval(() => {
    refreshBalances();
    refreshPositions();
  }, 30_000);
  return () => clearInterval(id);
}, [isLoading, accounts.length, refreshBalances, refreshPositions]);
```

---

### [M-04] 🟡 refreshBalances/refreshPositions 디바운스 없음
- **파일**: `frontend/src/store/accounts.tsx:254, 303`
- **심각도**: 중간 (버그)
- **설명**: 수동 새로고침 버튼을 빠르게 연타하면 병렬 API 호출이 쏟아진다. `setBalances()`가 동시에 여러 번 호출되면서 이전 결과가 최신 결과를 덮어쓸 수 있다.

**After**:
```typescript
const refreshBalances = useCallback(async () => {
  if (refreshInProgressRef.current) return;
  refreshInProgressRef.current = true;
  try {
    // ... 기존 로직
  } finally {
    refreshInProgressRef.current = false;
  }
}, []);
```

---

### [M-05] 🟡 토큰 폴링으로 로그인 감지 (1초 setInterval)
- **파일**: `frontend/src/store/accounts.tsx:237-251`
- **심각도**: 중간 (성능/설계)
- **설명**: localStorage를 1초마다 폴링하여 JWT 토큰 변경을 감지한다. 이벤트 기반(BroadcastChannel, storage 이벤트) 대비 불필요한 CPU 소비.

**After**:
```typescript
useEffect(() => {
  if (Platform.OS !== 'web') return;
  const handler = (e: StorageEvent) => {
    if (e.key === TOKEN_KEY && e.newValue) {
      syncFromBackend();
    }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}, [syncFromBackend]);
```
> `storage` 이벤트는 다른 탭에서의 변경만 감지하므로, 같은 탭에서의 로그인은 auth store에서 직접 `syncFromBackend()`를 호출하도록 연동해야 한다.

---

### [M-06] 🟡 Cron에서 계정별 순차 처리
- **파일**: `api/cron/positions.ts:252-283`
- **심각도**: 중간 (성능)
- **설명**: `for (const acc of accounts)` 루프가 모든 계정을 순차 처리한다. 사용자가 10명이면 각각의 포지션 조회 + ICT 분석 + 잔고 조회가 직렬로 실행되어 Vercel 함수 10초 타임아웃에 걸릴 수 있다.

**After**:
```typescript
const results = await Promise.allSettled(
  accounts.map(async (acc) => {
    // ... 기존 per-account 로직
  })
);
```

---

### [M-07] 🟡 Binance 디버그 정보가 전역 변수
- **파일**: `api/positions.ts:255`
- **심각도**: 중간 (버그)
- **설명**: `let __binanceLastDebug: string = ''` 이 모듈 스코프 전역 변수다. Vercel Serverless는 함수 인스턴스를 재사용하므로, 사용자 A의 Binance 디버그 정보가 사용자 B의 응답 헤더에 노출될 수 있다.

**After**:
```typescript
// handler 내부 로컬 변수로 변경
export default async function handler(req: any, res: any) {
  let binanceDebug = '';
  // ... binanceDebug를 fetchBinancePositions에 파라미터로 전달
}
```

---

### [M-08] 🟡 analysis/index.tsx 427줄 단일 컴포넌트
- **파일**: `frontend/app/(main)/analysis/index.tsx`
- **심각도**: 중간 (유지보수성)
- **설명**: Kelly 계산, ICT 스코어 시각화, 정렬 드롭다운, 종목 리스트, 스캔 결과 등이 모두 하나의 파일에 있다. 각 섹션을 독립 컴포넌트로 분리하면 테스트와 수정이 용이해진다.

---

### [M-09] 🟡 ICT 전략 파일 537줄 + 깊은 중첩
- **파일**: `bot/src/strategies/ictStrategy.js`
- **심각도**: 중간 (유지보수성/가독성)
- **설명**: `analyzeMultiTimeframe()`, `calculateConfluenceScore()` 등 핵심 함수가 100줄 이상이며, if/else 중첩이 8레벨까지 간다. 각 타임프레임 분석을 독립 함수로 분리하고, 점수 계산은 룩업 테이블/가중치 객체로 단순화해야 한다.

---

### [M-10] 🟡 positions.ts에서 req.body의 apiKey/apiSecret 직접 사용
- **파일**: `api/positions.ts:435`
- **심각도**: 중간 (보안)
- **설명**: 클라이언트가 POST body로 보내는 `apiKey`, `apiSecret`을 그대로 Gate.io API에 전달한다. 이는 사용자가 임의의 API 키로 이 엔드포인트를 프록시처럼 사용할 수 있다는 뜻이다. 인증된 사용자의 저장된 키만 사용하도록 변경하는 것이 좋다.

**After** (개선안):
```typescript
// JWT에서 user_id 추출 → Supabase에서 해당 사용자의 암호화된 키 조회 → 복호화 후 사용
// positions.ts가 직접 키를 받지 않고 accountId만 받는 구조로 변경
```

---

### [M-11] 🟡 빈 catch 블록 다수
- **파일**: `api/cron/positions.ts:101`, `api/positions.ts:86,98,135`, `frontend/src/store/accounts.tsx:380`
- **심각도**: 중간 (버그 가능성)
- **설명**: `catch {}` 또는 `catch(() => {})` 가 오류를 완전히 삼키고 있어, 프로덕션에서 문제 발생 시 디버깅이 불가능하다. 최소한 `console.error`로 로깅해야 한다.

---

### [M-12] 🟡 DB 마이그레이션 부재
- **파일**: `supabase/migrations/`
- **심각도**: 중간 (유지보수성)
- **설명**: 5개 테이블 중 `trades`만 마이그레이션이 있고, 나머지 4개(`exchange_accounts`, `ict_snapshots`, `balance_history`, `users`)는 SQL Editor로 수동 생성. 환경을 재현할 수 없고, 스키마 변경 추적이 불가능하다.

---

### [L-01] 🟢 DOW 배열 반복 선언
- **파일**: `api/positions.ts:184`, `api/cron/positions.ts:124`
- **심각도**: 낮음 (가독성)
- **설명**: `const DOW = ['일', '월', '화', '수', '목', '금', '토']` 와 KST 변환 로직이 두 파일에 동일하게 존재.

---

### [L-02] 🟢 format.ts 중복 패턴
- **파일**: `frontend/src/utils/format.ts`
- **심각도**: 낮음 (유지보수성)
- **설명**: `formatKRW`, `formatPnl`, `formatPercent`, `formatUsdPrice` 등이 거의 동일한 구조(소수점 자릿수 + 접두사 + 부호만 다름). 단일 configurable 포매터로 통합 가능.

---

### [L-03] 🟢 IctAnalysisCard 인라인 핸들러
- **파일**: `frontend/src/components/IctAnalysisCard.tsx`
- **심각도**: 낮음 (성능)
- **설명**: FlatList 아이템 내에서 `onPress={() => ...}` 인라인 함수 사용. 리스트 아이템이 많을 경우 불필요한 리렌더 유발.

---

### [L-04] 🟢 positionSnapshot entryTs 120초 허용 윈도우
- **파일**: `frontend/src/utils/positionSnapshot.ts`
- **심각도**: 낮음 (버그 가능성)
- **설명**: 같은 contract에 120초 내 두 번 진입하면 스냅샷이 잘못된 포지션에 매칭될 수 있다. 빈번하지는 않지만 스캘핑 트레이더에겐 현실적 시나리오.

---

### [L-05] 🟢 Vercel 보안 헤더 미설정
- **파일**: `vercel.json`
- **심각도**: 낮음 (보안)
- **설명**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options 등 보안 헤더가 없다. XSS나 클릭재킹 방어가 기본으로 되지 않는다.

**After** (vercel.json에 추가):
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" }
      ]
    }
  ]
}
```

---

### [L-06] 🟢 sumBalances에서 profitRate 단순 합산
- **파일**: `frontend/src/store/accounts.tsx:163`
- **심각도**: 낮음 (버그)
- **설명**: 여러 계좌의 `profitRate`를 단순 더하고 있다. 수익률은 가중평균이어야 한다.

**Before**:
```typescript
profitRate: acc.profitRate + b.profitRate,
```

**After**:
```typescript
// 투자금 가중 평균 수익률
profitRate: acc.invested + b.invested > 0
  ? (acc.profitRate * acc.invested + b.profitRate * b.invested) / (acc.invested + b.invested)
  : 0,
```

---

### [L-07] 🟢 makeId() 충돌 가능성
- **파일**: `frontend/src/store/accounts.tsx:69-71`
- **심각도**: 낮음
- **설명**: `Math.random().toString(36).slice(2) + Date.now().toString(36)` — 엔트로피가 낮다. `crypto.randomUUID()` 사용 권장.

---

### [L-08] 🟢 candlesticks.ts 빈 응답 무시
- **파일**: `api/candlesticks.ts`
- **심각도**: 낮음 (UX)
- **설명**: 체결 캔들 → mark 캔들 → mark 1h 캔들 3단 fallback이 모두 실패하면 빈 배열을 반환한다. 프론트엔드에서 "데이터 없음" 상태와 "네트워크 오류" 상태를 구분할 수 없다.

---

### [S-05] 🔴 positions.ts / trades.ts에 JWT 인증 없음
- **파일**: `api/positions.ts:431-439`, `api/trades.ts`
- **심각도**: 높음 (보안)
- **설명**: 이 엔드포인트는 body에서 `apiKey`/`apiSecret`을 직접 받아 거래소 API를 호출한다. JWT 인증이 없으므로 아무나 엔드포인트를 호출 가능. API 키를 알면 이 서버를 프록시처럼 사용할 수 있다.

---

### [S-06] 🔴 모든 API에 CORS `Access-Control-Allow-Origin: *`
- **파일**: `api/candlesticks.ts`, `api/market-scan.ts`, `api/ict-snapshot.ts`, `api/balance-history.ts`, `api/ict-analyze.ts`, `api/user-accounts.ts`
- **심각도**: 높음 (보안)
- **설명**: JWT 검증 없는 엔드포인트(S-00)와 결합되면 악의적 사이트에서 인증된 사용자의 데이터를 읽을 수 있다.

**After** (공통 CORS 헬퍼):
```typescript
const ALLOWED_ORIGINS = [process.env.FRONTEND_URL, 'http://localhost:8081'].filter(Boolean);
export function setCors(req: any, res: any) {
  const origin = req.headers?.origin ?? '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}
```

---

### [M-13] 🟡 getSupabase() 5곳 복사
- **파일**: `api/trades.ts`, `api/balance-history.ts`, `api/ict-snapshot.ts`, `api/user-accounts.ts`, `api/cron/positions.ts`
- **심각도**: 중간 (유지보수성)
- **설명**: 동일한 Supabase 클라이언트 초기화 로직이 5개 파일에 복사. `api/_supabase.ts`로 통합 필요.

---

### [M-14] 🟡 bot의 주말 판정이 UTC 기반 (NY 타임존 불일치)
- **파일**: `bot/src/utils/indicators.js`
- **심각도**: 중간 (버그)
- **설명**: `getActiveSession`에서 `now.getUTCDay()`로 주말을 판단하지만 ICT 세션은 NY 기준. 금요일 NY 21:00(= UTC 토요일 02:00)이 "주말"로 오판되어 거래 가능 시간에 봇이 멈춘다. `isInWeekendFlattenWindow`는 `Intl.DateTimeFormat`으로 올바르게 NY 요일을 구하므로 불일치.

**After**:
```javascript
const nyWeekday = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short',
}).format(now);
if (nyWeekday === 'Sat' || nyWeekday === 'Sun') {
  return { active: false, session: null, reason: '주말 - 세션 휴장' };
}
```

---

### [L-09] 🟢 ExchangeLogo 컴포넌트 3중 복사
- **파일**: `frontend/app/(main)/home.tsx`, `frontend/app/(main)/positions/index.tsx`, `frontend/app/(main)/analysis/index.tsx`
- **심각도**: 낮음 (유지보수성)
- **설명**: 동일한 SVG 로고 컴포넌트가 3곳에 복사. `frontend/src/components/ExchangeLogo.tsx`에 이미 공통 버전이 있으므로 import하면 됨.

---

### [L-10] 🟢 totalBalance가 매 렌더마다 재계산
- **파일**: `frontend/src/store/accounts.tsx:404-406`
- **심각도**: 낮음 (성능)
- **설명**: Provider body에 직접 있어 어떤 state가 변경되든 매번 실행됨. `useMemo`로 감싸야 함.

**After**:
```typescript
const totalBalance = useMemo(
  () => accounts.length ? sumBalances(accounts.map((a) => balances[a.id] ?? null)) : null,
  [accounts, balances],
);
```

---

## 리팩토링 제안 (우선순위)

| 순위 | 항목 | 예상 공수 | 영향도 |
|------|------|----------|--------|
| **1** | **S-00: JWT 서명 검증 추가 + `api/_jwt.ts` 공유 모듈** | **1h** | **치명적 — 사용자 데이터 탈취 가능** |
| **2** | **S-04+S-03: AES 키 fallback 제거 + CRON_SECRET 필수화** | **30m** | **환경변수 누락 시 전면 노출** |
| **3** | **S-01: timingSafeEqual 적용 (cron + bot)** | **30m** | **타이밍 사이드채널 차단** |
| 4 | S-05+S-06: API 인증 + CORS 정책 강화 | 3h | 프론트엔드→서버 보안 아키텍처 |
| 5 | S-02+M-10: API 키 전달 구조 개선 (서버사이드 복호화) | 4h | 키 평문 전송 제거 |
| 6 | M-01+M-13: gateSign/gateGet/getSupabase 공유 모듈 추출 | 3h | 6개 파일 중복 제거 |
| 7 | M-02: 환율 캐시 레이어 | 1h | API 성능 |
| 8 | M-03+M-04: 폴링 주기 조정 + 디바운스 | 1h | 프론트엔드 성능 |
| 9 | M-06: cron 병렬 처리 | 1h | cron 안정성 |
| 10 | M-07: 전역 변수 제거 | 30m | 데이터 유출 방지 |
| 11 | M-14: bot 주말 판정 NY timezone 수정 | 30m | 거래 시간 오판 방지 |
| 12 | M-12: DB 마이그레이션 정리 | 2h | 재현성 |
| 13 | M-08+M-09: 대형 파일 분할 | 3h | 유지보수성 |
| 14 | L-01~L-10: 소소한 개선 | 2h | 코드 품질 |
