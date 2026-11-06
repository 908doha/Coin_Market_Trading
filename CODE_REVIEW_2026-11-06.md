# Osprey 코드 리뷰 — 2026-11-06

## 총평

코드베이스 전반에 걸쳐 **Critical 4건, High 12건, Medium 23건, Low 13건** 총 52건의 문제를 발견했다.

가장 심각한 문제는 **(1) JWT 서명 미검증으로 인한 인증 우회**, **(2) 하드코딩된 암호화 키 폴백**, **(3) 클라이언트→서버 API 키 평문 전송**, **(4) 봇 세션 범위 sweep 로직이 항상 false**이다. 이 4건은 즉시 수정이 필요하다.

구조적으로는 `gateSign`/`gateGet` 5개 파일 복사, `ExchangeLogo`/`AccountBottomSheet` 3중 복사, `getUserId()` JWT 디코딩 3중 복사 등 코드 중복이 심하여 유지보수 비용이 높다.

---

## 문제점 리스트

### Critical (즉시 수정)

#### C-1. JWT 서명 미검증 — 인증 우회
- **파일**: `api/balance-history.ts:34-46`, `api/user-accounts.ts:19-29`, `api/ict-snapshot.ts:30-42`
- **카테고리**: 보안
- **설명**: `getUserId()`가 JWT payload를 Base64 디코딩만 하고 서명을 검증하지 않는다. 공격자가 `{"user_id":"victim_id"}`를 Base64로 인코딩해서 Bearer 토큰으로 보내면 타 사용자의 잔고 이력, 거래소 API 키(AES 블롭), ICT 스냅샷에 접근/수정 가능.

**Before:**
```typescript
function getUserId(req: any): string | null {
  const token = auth.slice(7);
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(pad(parts[1]), 'base64url').toString('utf8'));
  return payload.user_id ?? payload.id ?? payload.sub;
}
```

**After:**
```typescript
// api/_auth.ts — 공통 모듈
import crypto from 'crypto';
const JWT_SECRET = process.env.JWT_SECRET;

export function verifyAndGetUserId(req: any): string | null {
  if (!JWT_SECRET) return null;
  const auth = (req.headers?.authorization ?? '') as string;
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const sigInput = `${parts[0]}.${parts[1]}`;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(sigInput).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return String(payload.user_id ?? payload.id ?? payload.sub ?? '');
  } catch { return null; }
}
```

---

#### C-2. 하드코딩된 암호화 키 폴백
- **파일**: `api/user-accounts.ts:43`, `api/cron/positions.ts:29`
- **카테고리**: 보안
- **설명**: `ACCOUNTS_ENCRYPTION_KEY` 미설정 시 `'default_dev_key_change_in_prod!!'`를 사용. Public repo이므로 env var 미설정 시 모든 거래소 API 키가 알려진 키로 암호화된다.

**Before:**
```typescript
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY ?? 'default_dev_key_change_in_prod!!';
```

**After:**
```typescript
const secret = process.env.ACCOUNTS_ENCRYPTION_KEY;
if (!secret) throw new Error('ACCOUNTS_ENCRYPTION_KEY is not configured');
```

---

#### C-3. 봇 Session Range Sweep이 항상 false
- **파일**: `bot/src/strategies/indicators.js:580-585`
- **카테고리**: 버그 (트레이딩 로직)
- **설명**: `high`/`low`는 해당 세션 캔들의 max/min으로 설정됨. 따라서 `c.high > high`는 정의상 항상 false. `highSweep`과 `lowSweep`은 **데드 코드**이며, 이 값에 의존하는 ICT 점수/신호가 무의미.

**Before:**
```js
for (const c of candles) {
  if (c.high > high && c.close < high) highSweep = true;   // 항상 false
  if (c.low  < low  && c.close > low)  lowSweep  = true;   // 항상 false
}
```

**After:** 이전 세션의 high/low를 기준으로 sweep 감지하도록 재설계 필요.

---

#### C-4. 봇 SL = Entry 가격 시 0 나눗셈 → 무한대 포지션
- **파일**: `bot/src/strategies/ictStrategy.js:~155`
- **카테고리**: 버그 (금융 로직)
- **설명**: `entryPrice - stopLoss`가 0이면 `Infinity` 포지션 사이즈가 계산되어 비정상 주문 실행 가능.

**Before:**
```js
const positionSize = riskAmount / (entryPrice - stopLoss);
```

**After:**
```js
const slDistance = Math.abs(entryPrice - stopLoss);
if (slDistance < Number.EPSILON) return null;
const positionSize = riskAmount / slDistance;
```

---

### High (1주 내 수정)

#### H-1. 클라이언트→서버 API 키 평문 전송
- **파일**: `api/positions.ts:435`, `api/trades.ts:270`, `api/exchange/balance.ts:412`, `api/ict-analyze.ts:587`, `frontend/src/services/*.service.ts`
- **카테고리**: 보안
- **설명**: 프론트엔드가 매 요청마다 거래소 API 키/시크릿을 POST body로 전송. 브라우저 DevTools, 확장 프로그램, Vercel 로그에 평문 노출.
- **수정**: `accountId` + JWT만 전송, 서버에서 Supabase 복호화.

#### H-2. CORS `*` on 인증 엔드포인트
- **파일**: `api/ict-analyze.ts:581`, `api/balance-history.ts:58`, `api/user-accounts.ts:100`, `api/ict-snapshot.ts:53`
- **카테고리**: 보안
- **수정**: 환경변수 기반 origin 화이트리스트.

#### H-3. CRON_SECRET 미설정 시 인증 바이패스
- **파일**: `api/cron/positions.ts:236-244`
- **카테고리**: 보안
- **수정**: 미설정 시 503 반환 + `timingSafeEqual` 비교.

#### H-4. Cron 응답에 모든 사용자 자산 현황 노출
- **파일**: `api/cron/positions.ts:285`
- **카테고리**: 보안
- **수정**: 응답에서 `results` 배열 제거.

#### H-5. Cron이 API 키 평문을 HTTP body로 내부 전송
- **파일**: `api/cron/positions.ts:215-228`
- **카테고리**: 보안
- **수정**: ICT 분석 로직을 공유 모듈로 추출, 함수 호출로 변경.

#### H-6. client.ts 토큰 리프레시 실패 시 Promise 영구 미해결
- **파일**: `frontend/src/services/client.ts:102-114`
- **카테고리**: 버그 (메모리 누수)
- **설명**: `refreshAccessToken()` 실패 시 `refreshQueue`의 Promise들이 resolve도 reject도 안 됨.

**Before:**
```typescript
refreshQueue.push(resolve);  // reject 없음
```

**After:**
```typescript
refreshQueue.push({ resolve, reject });
// catch에서: refreshQueue.forEach(q => q.reject(err));
```

#### H-7. `sumBalances`에서 수익률(%) 단순 합산
- **파일**: `frontend/src/store/accounts.tsx:157-159`
- **카테고리**: 버그
- **설명**: 비율 값을 산술 합산. 계좌별 투자금 가중 평균이 필요.

**Before:**
```typescript
profitRate: acc.profitRate + b.profitRate,
```

**After:**
```typescript
// 합산 후 계산:
const base = sum.total - sum.profitTotal;
sum.profitRate = base > 0 ? (sum.profitTotal / base) * 100 : 0;
```

#### H-8. 분석 페이지 인라인 함수로 React.memo 무효화
- **파일**: `frontend/app/(main)/analysis/index.tsx:~180-250`
- **카테고리**: 성능
- **수정**: `useCallback`으로 함수 안정화, contract를 TickerRow에 직접 전달.

#### H-9. 분석 페이지 전체 티커를 ScrollView로 렌더링
- **파일**: `frontend/app/(main)/analysis/index.tsx:787-808`
- **카테고리**: 성능
- **수정**: `FlatList`로 가상화.

#### H-10. 디자인 시스템 컴포넌트 30+곳에서 토큰 대신 하드코딩 색상
- **파일**: `Toggle`, `PeriodSelector`, `Toast`, `SubPageHeader`, `PageHeader`, `Skeleton`, `CurrencyToggle` 등
- **카테고리**: 유지보수
- **설명**: `#191919`가 `colors.text.primary = #000000`과 다른 색. 토큰과 실제 렌더 불일치.

#### H-11. `design-system/design-system/` 중복 디렉토리
- **파일**: `frontend/src/design-system/design-system/` 전체
- **카테고리**: 유지보수
- **설명**: 중복 디렉토리의 토큰 값이 원본과 동기화 보장 없음. import 실수 시 다른 토큰 적용.

#### H-12. 봇 `calculatePositionSize`에서 size=0을 강제로 min=1로 올림
- **파일**: `bot/src/strategies/orderManager.js:444`
- **카테고리**: 버그 (금융 로직)
- **설명**: 잔고 부족 등으로 size=0이어야 하는 상황에서 최소 사이즈 진입 유발.

---

### Medium (2주 내 수정)

| # | 파일 | 카테고리 | 요약 |
|---|------|---------|------|
| M-1 | `api/positions.ts:255` | 버그 | 모듈 스코프 변수로 동시 요청 간 상태 오염 |
| M-2 | `api/ict-analyze.ts:55-80` | 성능 | 캔들 3 timeframe 직렬 호출 → `Promise.all` |
| M-3 | `api/balance-history.ts:165-205` | 성능 | Orphan rebind N+1 쿼리 → RPC 단일 호출 |
| M-4 | `api/exchange/balance.ts:200-215` | 성능 | Binance N+1 가격 조회 → 전체 시세 1회 |
| M-5 | `api/ict-analyze.ts:111` | 버그 | `contract` URL 파라미터 미이스케이프 |
| M-6 | `api/cron/positions.ts:241` | 보안 | 타이밍 공격 취약 문자열 비교 |
| M-7 | `api/positions.ts:56` 등 | 보안 | 에러 메시지에 Gate.io 응답 전문 노출 |
| M-8 | `frontend/src/store/accounts.tsx:~100` | 버그 | 폴링 중 언마운트 시 stale state 업데이트 |
| M-9 | `frontend/src/store/accounts.tsx:~85` | 버그 | 계정 전환 시 이전 데이터 잔류 |
| M-10 | `frontend/src/store/accounts.tsx:397` | 성능 | `setInterval` 요청 적체 → `setTimeout` 체인 |
| M-11 | `frontend/src/utils/format.ts:3` | 버그 | `formatKRW`가 음수 부호 제거 |
| M-12 | `frontend/src/utils/balanceHistory.ts:~30` | 버그 | localStorage QuotaExceededError 미처리 |
| M-13 | `frontend/src/utils/positionSnapshot.ts:~10` | 버그 | 스냅샷 키에 userId/accountId 없음 → 덮어쓰기 |
| M-14 | `frontend/src/utils/priceHistory.ts` | 성능 | 무제한 데이터 축적 → localStorage 한도 도달 |
| M-15 | `frontend/app/(main)/positions/[id].tsx:~45` | 버그 | useEffect async 에러 미처리 → 무한 로딩 |
| M-16 | `frontend/app/(main)/home.tsx:~80` | 성능 | 차트 데이터 매 렌더마다 재계산 → `useMemo` |
| M-17 | `frontend/app/(main)/history/[id].tsx:~30` | 버그 | entryTs 120초 허용으로 잘못된 스냅샷 매칭 |
| M-18 | `frontend/app/(main)/analysis/ict/[contract].tsx:~25` | 성능 | 동시 ICT 요청 중복 → AbortController |
| M-19 | `bot/src/strategies/indicators.js:157-169` | 성능 | OB broken 검사 O(n²) → suffix array O(n) |
| M-20 | `bot/src/api/gateClient.js:~60` | 버그 | API 응답 에러 코드 미검증 |
| M-21 | `bot/src/strategies/ictStrategy.js:162` | 버그 | SL/TP `toFixed(2)` 이중 반올림 |
| M-22 | `vercel.json` | 보안 | 보안 헤더 미설정 (X-Frame-Options 등) |
| M-23 | `frontend/src/design-system/components/AnimatedNumber` | 버그 | useEffect dependency 누락 |

### Low (백로그)

| # | 파일 | 카테고리 | 요약 |
|---|------|---------|------|
| L-1 | `api/candlesticks.ts:30` | 성능 | 에러 응답에 Cache-Control 미설정 |
| L-2 | `api/positions.ts:444` | 버그 | exchange 미지정 시 빈 결과 |
| L-3 | `frontend/src/utils/ictSnapshot.ts:~15` | 버그 | JSON.parse 에러 미처리 |
| L-4 | `frontend/src/utils/clipboard.ts:~5` | 버그 | Clipboard API 가용성 미확인 |
| L-5 | `frontend/src/store/auth.tsx:88` | 버그 | 앱 시작 시 토큰 만료 미검증 |
| L-6 | `frontend/src/store/accounts.tsx:241` | 성능 | 1초 폴링 토큰 감지 → `storage` 이벤트 |
| L-7 | `frontend/src/components/IctAnalysisCard.tsx:~90` | 버그 | 클립보드 복사 실패 시 성공 Toast |
| L-8 | `frontend/src/components/PositionDetailCard.tsx:~120` | 버그 | TpSlPathChart에 key 없음 |
| L-9 | `frontend/src/components/AccountBottomSheet.tsx:~50` | UX | 닫힐 때 키보드 미해제 |
| L-10 | `frontend/src/design-system/tokens/shadows.ts:6` | 유지보수 | 미사용 Platform import |
| L-11 | `frontend/src/design-system/components/Glass` | 유지보수 | `blur` prop 선언만 있고 사용 안 됨 |
| L-12 | `bot/src/strategies/orderManager.js:516` | 유지보수 | 매직 넘버 다수 |
| L-13 | `bot/src/strategies/ictStrategy.js:646-851` | 유지보수 | `_calculateSLTP` 200줄 bullish/bearish 중복 |

---

## 노션 리팩토링 제안

| 우선순위 | 제안 | 영향 범위 | 예상 공수 |
|---------|------|----------|----------|
| **P0** | JWT 서명 검증 + 공통 `_auth.ts` 모듈 추출 | `balance-history`, `user-accounts`, `ict-snapshot` + 3개 파일 | 4h |
| **P0** | 하드코딩 암호화 키 폴백 제거 | `user-accounts`, `cron/positions` | 30m |
| **P0** | API 키 서버사이드 복호화로 전환 | 전체 API + 전체 서비스 레이어 | 2d |
| **P0** | 봇 Session Range Sweep 로직 재설계 | `indicators.js`, 관련 테스트 | 1d |
| **P0** | SL=Entry 0 나눗셈 가드 + `calculatePositionSize` min=1 수정 | `ictStrategy.js`, `orderManager.js` | 2h |
| **P1** | `gateSign`/`gateGet` → `api/_gate.ts` 공통 모듈 | API 파일 5개 | 3h |
| **P1** | `ExchangeLogo` + `AccountBottomSheet` 3중 복사 통합 | `home`, `positions`, `analysis` | 3h |
| **P1** | `sumBalances` 수익률 가중 평균 수정 | `accounts.tsx` | 1h |
| **P1** | CORS origin 화이트리스트 + Cron 인증 강화 | API 전체 | 2h |
| **P1** | `client.ts` 토큰 리프레시 Promise reject 처리 | `client.ts` | 1h |
| **P2** | 분석 페이지 FlatList 가상화 + useCallback 최적화 | `analysis/index.tsx` | 4h |
| **P2** | localStorage 유틸 정비 (TTL, 용량 관리, 키 네임스페이스) | `utils/*.ts` 전체 | 4h |
| **P2** | `vercel.json` 보안 헤더 추가 | `vercel.json` | 30m |
| **P2** | 디자인 토큰 하드코딩 색상 정리 | 디자인 시스템 컴포넌트 10+개 | 4h |
| **P2** | 봇 OB/FVG O(n²) → suffix array O(n) 최적화 | `indicators.js` | 2h |
| **P3** | `design-system/design-system/` 중복 디렉토리 삭제 | import 경로 전수 조사 필요 | 4h |
| **P3** | useEffect 의존성 + cleanup 일괄 정비 | `positions/[id]`, `history/[id]`, `home`, `analysis/ict/[contract]` | 3h |
| **P3** | 봇 bearish 방향 + `_verifySLTPExists` + weekend flatten 테스트 추가 | `bot/tests/` | 1d |
| **P3** | `--legacy-peer-deps` 의존성 충돌 해소 | `package.json` | 4h |
