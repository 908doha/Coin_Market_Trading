# Osprey - Coin Market Trading

## Overview
암호화폐 선물 트레이딩 포트폴리오 관리 앱. Gate.io 선물 API를 통해 실시간 포지션, 잔고, 거래 내역을 조회하고 ICT(Inner Circle Trader) 분석을 제공한다.

- **앱 이름**: Osprey
- **언어**: 한국어 UI, KRW 기본 통화 (USD 토글 가능)
- **플랫폼**: Expo (React Native) — 웹 배포 (Vercel), 모바일 가능
- **백엔드**: Vercel Serverless Functions (TypeScript)
- **DB**: Supabase (PostgreSQL)
- **거래소**: Gate.io 선물 (USDT-M)

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
| Cron | Vercel Cron (`api/cron/positions.ts`, 5분 간격) |
| Deploy | Vercel (vercel.json 설정) |

## Project Structure

```
Coin_Market_Trading/
├── api/                          # Vercel Serverless Functions
│   ├── _ict.ts                   # ICT 분석 공유 유틸 (HTF/MTF/LTF 분석)
│   ├── _jwt.ts                   # JWT 생성/검증 헬퍼
│   ├── positions.ts              # POST /api/positions — Gate.io 실시간 포지션
│   ├── trades.ts                 # POST /api/trades — Gate.io 거래 내역
│   ├── ict-analyze.ts            # POST /api/ict-analyze — ICT 분석 실행
│   ├── ict-snapshot.ts           # ICT 스냅샷 CRUD (Supabase)
│   ├── candlesticks.ts           # GET /api/candlesticks — Gate.io 캔들 데이터
│   ├── balance-history.ts        # 잔고 이력 API (Supabase)
│   ├── market-scan.ts            # 시장 스캔
│   ├── user-accounts.ts          # 사용자 거래소 계정 관리
│   ├── agents.ts                 # AI 에이전트 설정
│   ├── bot/                      # 봇 관련 API
│   ├── cron/
│   │   └── positions.ts          # Vercel Cron: 5분마다 ICT 스냅샷 + 잔고 저장
│   └── exchange/
│       └── balance.ts            # 거래소 잔고 조회
│
├── frontend/
│   ├── app/                      # Expo Router 파일 기반 라우팅
│   │   ├── _layout.tsx           # 루트 레이아웃
│   │   ├── index.tsx             # 초기 리다이렉트
│   │   ├── onboarding.tsx        # 온보딩
│   │   ├── (auth)/               # 인증 그룹
│   │   │   ├── login.tsx
│   │   │   └── signup.tsx
│   │   ├── (main)/               # 메인 탭 그룹
│   │   │   ├── _layout.tsx       # 탭 네비게이터
│   │   │   ├── home.tsx          # 홈 (총자산 차트 + 포지션 요약)
│   │   │   ├── positions/        # 포지션 탭
│   │   │   │   ├── index.tsx     # 포지션 목록
│   │   │   │   └── [id].tsx      # 포지션 상세
│   │   │   ├── analysis/         # 수익분석 탭
│   │   │   └── account/          # 계정 관리
│   │   ├── history/
│   │   │   └── [id].tsx          # 거래 상세 (청산된 포지션)
│   │   └── positions/
│   │       └── [id].tsx          # 포지션 상세 (홈에서 접근용)
│   │
│   └── src/
│       ├── design-system/        # 디자인 시스템
│       │   ├── index.ts          # 전체 export
│       │   ├── tokens/           # 색상, 타이포, 간격, 그림자, 애니메이션
│       │   └── components/       # 20개 공통 컴포넌트
│       │       ├── AnimatedNumber/
│       │       ├── Button/
│       │       ├── Card/ (GlassCard)
│       │       ├── Input/
│       │       ├── Skeleton/     # 스켈레톤 로딩 UI
│       │       ├── Text/
│       │       └── ...
│       │
│       ├── components/           # 비즈니스 컴포넌트
│       │   ├── PositionDetailCard.tsx   # PnlCard, CoinHeaderCard, TpSlPathChart, PriceChart
│       │   ├── PositionDetailView.tsx   # 포지션/거래 상세 공통 레이아웃
│       │   └── IctAnalysisCard.tsx      # ICT 분석 카드
│       │
│       ├── services/             # API 클라이언트 (fetch 기반)
│       │   ├── client.ts         # 공통 HTTP 클라이언트 + 토큰 관리
│       │   ├── positions.service.ts
│       │   ├── trades.service.ts
│       │   ├── account.service.ts
│       │   └── ...
│       │
│       ├── store/
│       │   ├── accounts.tsx      # 거래소 계정 + 잔고 + 포지션 Context (5초 폴링)
│       │   └── auth.tsx          # 인증 상태 Context
│       │
│       └── utils/
│           ├── format.ts         # KRW/USD 포맷팅
│           ├── positionSnapshot.ts  # localStorage 포지션 스냅샷 (레버리지, TP/SL 보존)
│           ├── ictSnapshot.ts    # localStorage + Supabase ICT 분석 스냅샷
│           ├── priceHistory.ts   # localStorage 가격 이력
│           └── balanceHistory.ts # localStorage + Supabase 잔고 이력
│
├── vercel.json                   # Vercel 배포 설정 + Cron
├── package.json                  # 루트 (Expo)
└── supabase/migrations/          # DB 마이그레이션
```

## Key Architecture Decisions

### 1. Gate.io API 인증
- HMAC-SHA512 서명 (`gateSign` 함수)
- `api/positions.ts`, `api/trades.ts` 등에서 동일 패턴 사용
- 환율: Upbit KRW-USDT 시세 실시간 조회, fallback 1350원

### 2. 데이터 흐름
```
Gate.io API ← Vercel Serverless ← Frontend fetch
                    ↓
              Supabase (ICT 스냅샷, 잔고 이력, 계정 암호화 저장)
```
- `accounts.tsx` 스토어가 5초마다 폴링하여 포지션/잔고 갱신
- Vercel Cron이 5분마다 서버사이드에서 ICT 분석 + 잔고 스냅샷 저장

### 3. 포지션 스냅샷 시스템
포지션이 활성 상태일 때 localStorage에 스냅샷 저장 (`positionSnapshot.ts`):
- 레버리지, 청산가, TP/SL, 증거금, 코인 수량
- 청산 후 `history/[id].tsx`에서 이 데이터를 복원하여 상세 정보 표시
- `entryTs` 기준으로 진입 시점 매칭 (120초 허용)

### 4. ICT 분석
- `_ict.ts`: HTF(4h)/MTF(1h)/LTF(15m) 캔들 분석
- Swing highs/lows, MSS, Order Blocks, FVG, IOFED, Session Ranges
- 점수 체계: 0-100 (방향 확신도)
- 포지션 진입 시 스냅샷 저장 → 청산 후 거래 상세에서 복원

### 5. 차트
- **TpSlPathChart**: SVG 시계열 차트 (캔들 데이터 기반, TP/SL 구간 표시)
- **PriceChart**: 정적 TP/SL 차트 (시계열 데이터 없을 때 fallback)
- **CombinedChart**: 홈 자산 차트 (선 + 막대, 기간별 전환)

### 6. 네비게이션 구조 (Expo Router)
```
/ (index) → 리다이렉트
├── /(auth)/login, signup
├── /(main)/                      # 탭 네비게이터
│   ├── home                      # 홈 탭
│   ├── positions/                # 포지션 탭
│   │   ├── index                 # 목록
│   │   └── [id]                  # 상세 (from=home이면 뒤로가기→홈)
│   ├── analysis/                 # 수익분석 탭
│   └── account/                  # 계정 탭
├── /history/[id]                 # 거래 상세
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

- `exchange_accounts`: 거래소 API 키 (AES-256-GCM 암호화)
- `ict_snapshots`: ICT 분석 결과
- `balance_history`: 잔고 이력 (5분 간격)
- `users`: 사용자 (Supabase Auth 연동)

## Environment Variables (Vercel)

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET` — 사용자 인증
- `ACCOUNTS_ENCRYPTION_KEY` — API 키 AES 암호화 키
- `CRON_SECRET` — Vercel Cron 인증 (Pro 플랜 필요)

## Vercel Configuration

```json
{
  "buildCommand": "cd frontend && npm install --legacy-peer-deps && npx expo export -p web",
  "outputDirectory": "frontend/dist",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/:path*", "destination": "/index.html" }
  ],
  "crons": [{ "path": "/api/cron/positions", "schedule": "*/5 * * * *" }]
}
```

## Development

```bash
# 프론트엔드 개발 서버
cd frontend && npm install --legacy-peer-deps && npx expo start --web

# API는 Vercel에서만 동작 (로컬에서는 vercel dev 필요)
```

## Git Branch

- 개발 브랜치: `claude/design-system-setup-x3KQF`
- GitHub: `openclaw4286-code/coin_market_trading`
