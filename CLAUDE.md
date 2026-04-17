# Osprey - Coin Market Trading

## Overview
암호화폐 선물 트레이딩 포트폴리오 관리 앱. Gate.io 선물 API를 통해 실시간 포지션, 잔고, 거래 내역을 조회하고 ICT(Inner Circle Trader) 분석을 제공한다.

- **앱 이름**: Osprey
- **언어**: 한국어 UI, KRW 기본 통화 (USD 토글 가능)
- **플랫폼**: Expo (React Native) — 웹 배포 (Vercel), 모바일 가능
- **백엔드**: Vercel Serverless Functions (TypeScript)
- **DB**: Supabase (PostgreSQL)
- **거래소**: Gate.io 선물 (USDT-M) — 크립토 + 원자재 perp (XBR/XTI/XAU/XAG 포함)

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Expo 52, React Native 0.76, expo-router 4 |
| UI | 커스텀 디자인 시스템 (`frontend/src/design-system/`) |
| Animation | react-native-reanimated, react-native-svg |
| Backend | Vercel Serverless Functions (Node.js, TypeScript) |
| Auth | Supabase Auth + 커스텀 JWT (`api/_jwt.ts`) |
| DB | Supabase PostgreSQL |
| Exchange API | Gate.io v4 REST (HMAC-SHA512 서명) |
| Cron | 외부 cron-job.org → `/api/cron/positions` (2분 간격) |
| Deploy | Vercel Hobby (vercel.json 설정, 내장 cron 미사용) |

## Project Structure

```
Coin_Market_Trading/
├── api/                          # Vercel Serverless Functions (루트만 서빙)
│   ├── _jwt.ts                   # JWT 생성/검증 헬퍼
│   ├── positions.ts              # POST /api/positions — Gate.io 실시간 포지션
│   ├── trades.ts                 # POST /api/trades — Gate.io 거래 내역
│   ├── ict-analyze.ts            # POST /api/ict-analyze — HTF/MTF/LTF ICT 분석
│   ├── ict-snapshot.ts           # ICT 스냅샷 CRUD (Supabase)
│   ├── candlesticks.ts           # GET /api/candlesticks — Gate.io 캔들 (mark price fallback)
│   ├── balance-history.ts        # GET/POST/PATCH — 잔고 이력 (orphan rebind 지원)
│   ├── market-scan.ts            # 시장 스캔
│   ├── user-accounts.ts          # 사용자 거래소 계정 관리 (AES-256-GCM)
│   ├── agents.ts                 # AI 에이전트 설정
│   ├── bot/                      # 봇 관련 API
│   ├── cron/
│   │   └── positions.ts          # 외부 cron 호출: 2분마다 ICT 스냅샷 + 잔고 저장
│   └── exchange/
│       └── balance.ts            # 거래소 잔고 조회
│
├── frontend/
│   ├── api/                      # 레거시 중복 디렉토리 (Vercel은 루트 api/만 서빙 — 데드 코드)
│   ├── app/                      # Expo Router 파일 기반 라우팅
│   │   ├── _layout.tsx
│   │   ├── index.tsx             # 초기 리다이렉트
│   │   ├── onboarding.tsx
│   │   ├── (auth)/               # 인증 그룹 (login, signup)
│   │   ├── (main)/               # 메인 탭
│   │   │   ├── _layout.tsx       # 탭 네비게이터
│   │   │   ├── home.tsx          # 홈 (총자산 차트 + 포지션 요약)
│   │   │   ├── positions/
│   │   │   │   ├── index.tsx     # 포지션 목록
│   │   │   │   └── [id].tsx      # 포지션 상세
│   │   │   ├── analysis/         # 수익분석 탭
│   │   │   └── account/          # 계정 관리
│   │   ├── history/
│   │   │   └── [id].tsx          # 거래 상세 (청산된 포지션)
│   │   └── positions/
│   │       └── [id].tsx          # (main)/positions/[id] 재export (홈 deep-link 호환)
│   │
│   └── src/
│       ├── design-system/        # 디자인 시스템
│       │   ├── index.ts
│       │   ├── tokens/           # 색상/타이포/간격/그림자/애니메이션
│       │   ├── components/       # 20개 공통 컴포넌트
│       │   └── design-system/    # 레거시 중첩 경로 (현 임포트 일부가 여전히 참조)
│       │
│       ├── components/           # 비즈니스 컴포넌트
│       │   ├── PositionDetailCard.tsx   # PnlCard, TpSlPathChart, PriceChart
│       │   ├── PositionDetailView.tsx
│       │   ├── IctAnalysisCard.tsx
│       │   ├── ExchangeLogo.tsx         # 공통 거래소 로고
│       │   └── AccountBottomSheet.tsx   # 공통 계좌 선택 시트
│       │
│       ├── services/             # API 클라이언트
│       │   ├── client.ts         # 공통 HTTP + 토큰 관리
│       │   ├── positions.service.ts, trades.service.ts, account.service.ts 등
│       │
│       ├── store/
│       │   ├── accounts.tsx      # 계정/잔고/포지션 Context (5초 폴링)
│       │   └── auth.tsx
│       │
│       ├── constants/, hooks/, mock/   # 일부 레거시 중첩 경로 동반
│       │
│       └── utils/
│           ├── format.ts
│           ├── positionSnapshot.ts  # localStorage 포지션 스냅샷
│           ├── ictSnapshot.ts       # localStorage + Supabase ICT 스냅샷
│           ├── priceHistory.ts      # localStorage 가격 이력
│           └── balanceHistory.ts    # localStorage + Supabase 잔고 이력 (orphan 흡수 포함)
│
├── vercel.json                   # Vercel 배포 설정 (cron 없음, Hobby 플랜)
├── package.json                  # 루트 (Expo)
└── supabase/migrations/          # DB 마이그레이션 (현재 trades 1건; 나머지는 수동 생성)
```

## Key Architecture Decisions

### 1. Gate.io API 인증
- HMAC-SHA512 서명 (`gateSign` 함수 — `api/positions.ts`, `api/trades.ts`, `api/ict-analyze.ts`, `api/cron/positions.ts`에서 동일 패턴)
- 환율: Upbit KRW-USDT 시세 실시간, fallback 1350원

### 2. 데이터 흐름
```
Gate.io API ← Vercel Serverless ← Frontend fetch (5초 폴링)
                    ↓
              Supabase (ICT 스냅샷, 잔고 이력, 거래 내역, 계정 AES 암호화 저장)
                    ↑
외부 cron-job.org → /api/cron/positions (2분) → 서버사이드 ICT + 잔고 기록
```
- `accounts.tsx` 스토어가 5초마다 폴링하여 포지션/잔고 갱신
- 외부 cron이 2분마다 `/api/cron/positions`를 쳐서 ICT 스냅샷 + `balance_history` 저장 (Vercel Hobby 플랜이라 내장 cron 미사용)

### 3. 포지션 스냅샷 시스템
포지션 활성 중 localStorage에 스냅샷 저장 (`positionSnapshot.ts`):
- 레버리지, 청산가, TP/SL, 증거금, 코인 수량
- 청산 후 `history/[id].tsx`에서 복원하여 상세 정보 표시
- `entryTs` 기준 진입 시점 매칭 (120초 허용)

### 4. ICT 분석
- `ict-analyze.ts`: HTF(4h) / MTF(15m) / LTF(5m) 캔들 분석
- Swing highs/lows, MSS, Order Blocks, FVG, IOFED, Session Ranges
- 점수 체계: 0-100 (방향 확신도)
- 포지션 진입 시 `ict_snapshots` 저장 (`(user_id, contract, entry_ts)` 고유 제약) → 영구 보관, 청산 후 거래 상세에서 복원
- **저유동성 perp 지원**: `gateGetCandles()` 헬퍼가 체결 캔들이 10개 미만이면 `mark_<contract>` 캔들로 자동 fallback. XBR/XTI/XAU/XAG 같은 원자재 perp도 BTC/ETH와 동일한 UX

### 5. 차트
- **TpSlPathChart**: SVG 시계열 차트 (캔들 데이터 기반, TP/SL 구간 표시)
- **PriceChart**: 정적 TP/SL 차트 (ICT 분석 카드 전용)
- **CombinedChart**: 홈 자산 차트 (선 + 막대, 기간별)
- 캔들 출처: `/api/candlesticks` — 체결 캔들 → `mark_<contract>` → `mark_<contract>` 1h 순서로 fallback, `Cache-Control: no-store`로 빈 응답 캐시 방지

### 6. 네비게이션 구조 (Expo Router)
```
/ (index) → 리다이렉트
├── /(auth)/login, signup
├── /(main)/                      # 탭 네비게이터
│   ├── home                      # 홈 탭
│   ├── positions/
│   │   ├── index                 # 목록
│   │   └── [id]                  # 상세 (from=home이면 뒤로가기→홈)
│   ├── analysis/                 # 수익분석
│   └── account/
├── /history/[id]                 # 거래 상세
├── /positions/[id]               # (main)/positions/[id] 재export (deep-link 호환)
└── /onboarding
```

## Design System

커스텀 디자인 시스템 (`frontend/src/design-system/`):

**토큰**: `colors`, `spacing`, `borderRadius`, `textStyles`, `shadows`, `animation`
- 라이트 테마 전용
- 배경: `colors.bg.elevated = #F5F5F5`, `colors.bg.default = #FFFFFF`
- 시장 색상: `colors.market.rise` (빨강), `colors.market.fall` (파랑) — 한국 주식 관례

**컴포넌트** (20개):
`Text`, `Button`, `Input`, `GlassCard`, `AnimatedNumber`, `Skeleton`, `Badge`, `Chip`, `Toggle`, `Avatar`, `Divider`, `Toast`, `PressableScale`, `FadeTabView`, `PageHeader`, `SubPageHeader`, `CurrencyToggle`, `PeriodSelector`, `ScreenTransition`

**스켈레톤**: `AssetCardSkeleton`, `PositionRowSkeleton`, `StatRowSkeleton`, `BalanceCardsSkeleton`, `PositionDetailSkeleton`, `TradeDetailSkeleton`, `TradeHistoryListSkeleton`, `AgentSettingsSkeleton`

## Supabase Tables

| Table | Key | 용도 |
|-------|-----|-----|
| `exchange_accounts` | `user_id` | 거래소 API 키 (AES-256-GCM 암호화된 JSON) |
| `ict_snapshots` | `(user_id, contract, entry_ts)` | 진입 시점 ICT 분석 결과, 영구 보관 |
| `balance_history` | `(user_id, account_id, ts)` | 잔고 이력. `account_id=''`는 총자산, 그 외는 계좌별 |
| `trades` | `(id, account_key)` | 거래 내역 (account_key = `sha256(apiKey).slice(0,16)`) |
| `users` | — | Supabase Auth 연동 |

### 계좌 재등록 시 orphan balance_history 흡수
`exchange_accounts`가 초기화돼도 `balance_history`는 그대로 남음. 계좌를 새로 추가하면 랜덤 `account_id`가 새로 부여되는데, `PATCH /api/balance-history` (`claimOrphanBalanceHistory` 헬퍼)가 기존 orphan `account_id`를 신규 id로 rebind해서 계좌별 차트 연속성을 복구. 총자산 차트(`account_id=''`)는 `user_id`만 같으면 자동 복원.

## Environment Variables (Vercel)

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET` — 사용자 인증
- `ACCOUNTS_ENCRYPTION_KEY` — API 키 AES 암호화 키 (32자 이상)
- `CRON_SECRET` — 외부 cron의 `Authorization: Bearer <secret>` 검증

## Vercel Configuration

```json
{
  "installCommand": "npm install",
  "buildCommand": "cd frontend && npm install --legacy-peer-deps && npx expo export -p web",
  "outputDirectory": "frontend/dist",
  "framework": null,
  "rewrites": [
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

**주의사항**:
- `crons` 섹션을 두면 안 됨 — Hobby 플랜은 5분 간격 cron 미지원, 배포 자체가 실패함. 2분 주기 cron은 cron-job.org 같은 외부 서비스가 `/api/cron/positions`를 치도록 설정.
- `rewrites`는 `/api/`로 시작하는 경로를 **명시적으로 제외**해야 함. `{ "source": "/:path*", "destination": "/index.html" }` 같은 catch-all을 넣으면 API 미매치 시 HTML이 반환되는 버그 재발.

## Development

```bash
# 프론트엔드 개발 서버
cd frontend && npm install --legacy-peer-deps && npx expo start --web

# API는 Vercel에서만 동작 (로컬 테스트 시 vercel dev 필요)
```

## Git Workflow

- GitHub: `openclaw4286-code/coin_market_trading`
- 기본적으로 `main` 브랜치에서 직접 작업 — feature branch 최소화
- feature branch 필요 시 **반드시 최신 `main`에서 분기**, 작업 즉시 머지
- 오래된 feature branch 재사용 금지 — main의 최근 수정이 빠져서 버그 재발

## 알려진 기술 부채

- `frontend/api/` 디렉토리는 Vercel이 서빙하지 않는 데드 코드. 제거 시 루트 `api/`와 import 충돌 없는지 확인 필요.
- `frontend/src/design-system/design-system/`, `frontend/src/store/store/`, `constants/constants/`, `hooks/hooks/`, `mock/mock/`처럼 이름 중첩된 디렉토리가 남아있음. 일부 import가 여전히 참조하므로 단순 삭제하면 빌드 실패. 정리하려면 import 경로 전수 조사 후 진행.
- `supabase/migrations/`에 `trades` 테이블 외 마이그레이션 없음. `exchange_accounts`, `ict_snapshots`, `balance_history`는 SQL Editor에서 수동 생성됨. PostgREST 스키마 캐시 staleness 시 `NOTIFY pgrst, 'reload schema';`로 해소.
