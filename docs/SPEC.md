# Gate.io ICT 선물 자동매매 트레이딩 봇 - 기능명세서

> 버전: 1.0.0  
> 작성일: 2026-04-04  
> 프로젝트: Coin_Market_Trading

---

## 1. 프로젝트 개요

### 1.1 목적
Gate.io 거래소의 USDT 마진 선물 시장에서 ICT(Inner Circle Trading) 전략을 기반으로 자동 매매를 수행하는 트레이딩 봇.

### 1.2 기술 스택
| 구분 | 기술 |
|------|------|
| 런타임 | Node.js 20 LTS |
| 거래소 API | gate-api (Gate.io 공식 SDK) |
| 프로세스 관리 | PM2 |
| 알림 | node-telegram-bot-api |
| 로깅 | Winston |
| 스케줄링 | node-cron |
| 인프라 | Oracle Cloud VM.Standard.E2.1.Micro (무료) |

### 1.3 프로젝트 구조
```
Coin_Market_Trading/
├── src/
│   ├── config/index.js          # 환경변수 기반 설정
│   ├── api/gateClient.js         # Gate.io 선물 API 클라이언트
│   ├── strategies/ictStrategy.js # ICT 멀티 타임프레임 전략
│   ├── services/
│   │   ├── orderManager.js       # 주문 실행 및 리스크 관리
│   │   └── telegram.js           # 텔레그램 알림 및 명령어
│   ├── utils/
│   │   ├── indicators.js         # ICT 기술적 지표 엔진
│   │   └── logger.js             # 로깅
│   └── bot.js                    # 메인 봇 루프
├── scripts/setup-server.sh       # 서버 초기 설정 스크립트
├── ecosystem.config.js           # PM2 배포 설정
├── .env.example                  # 환경변수 템플릿
└── package.json
```

---

## 2. 핵심 기능

### 2.1 멀티 타임프레임 ICT 전략 분석

3단계 타임프레임 분석을 통해 높은 정확도의 매매 신호를 생성한다.

| 단계 | 타임프레임 | 역할 | 분석 내용 |
|------|-----------|------|----------|
| HTF (상위) | 4h (기본) | 방향 판단 | HH/HL(상승), LH/LL(하락) 구조 판별 |
| MTF (중위) | 1h (기본) | 구조 확인 | MSS + Order Block / FVG 존재 여부 |
| LTF (하위) | 15m (기본) | 진입 타이밍 | Kill Zone + OTE / Liquidity Sweep / MSS |

#### 진입 조건 (Long)
1. HTF: Bullish 트렌드 (Higher High + Higher Low) 또는 Bullish MSS
2. MTF: Bullish MSS 확인 + Bullish OB 또는 FVG 존재
3. LTF: Kill Zone 시간대 내 + OTE 구간 진입 / Liquidity Sweep / MSS / FVG

#### 진입 조건 (Short)
1. HTF: Bearish 트렌드 (Lower High + Lower Low) 또는 Bearish MSS
2. MTF: Bearish MSS 확인 + Bearish OB 또는 FVG 존재
3. LTF: Kill Zone 시간대 내 + OTE 구간 진입 / Liquidity Sweep / MSS / FVG

#### 미진입 조건
- Kill Zone 시간대 외
- HTF 방향 불명확 (횡보 구간)
- MTF 구조 미확인 (MSS 또는 POI 부족)
- LTF 진입 조건 미충족
- 일일 최대 손실 한도 도달
- 기존 포지션 보유 중
- 잔고 부족

---

### 2.2 ICT 기술적 지표

| 지표 | 설명 | 파라미터 |
|------|------|---------|
| **Swing High/Low** | 양쪽 n개 봉 대비 최고/최저점 탐색 | structureShiftBars: 5 |
| **Market Structure Shift (MSS)** | 직전 스윙 하이/로우 돌파 시 추세 전환 감지 | - |
| **Order Block (OB)** | 강한 반전이 시작된 마지막 봉 영역 (기관 매집/분배) | orderBlockLookback: 50, 최소 0.2% 변동 |
| **Fair Value Gap (FVG)** | 3봉 패턴에서 1번봉과 3번봉 사이의 가격 불균형 갭 | fvgMinGapPercent: 0.05% |
| **Optimal Trade Entry (OTE)** | 피보나치 되돌림 0.62~0.79 구간 | oteFibLow: 0.62, oteFibHigh: 0.79 |
| **Liquidity Sweep** | 스윙 포인트 일시 돌파 후 복귀 (스탑 헌팅 패턴) | 최근 3개 스윙 포인트 검사 |
| **Kill Zone** | 변동성 높은 세션 시간대 (UTC) | 아래 표 참조 |

#### Kill Zone 시간대 (UTC)
| Kill Zone | 시작 | 종료 |
|-----------|------|------|
| Asian Open | 00:00 | 04:00 |
| London Open | 07:00 | 10:00 |
| NY Open | 12:00 | 15:00 |
| London Close | 15:00 | 17:00 |

---

### 2.3 주문 실행

| 기능 | 설명 |
|------|------|
| 시장가 주문 | IOC(Immediate or Cancel) 방식 즉시 체결 |
| 지정가 주문 | GTC(Good Till Cancel) 방식 |
| 포지션 수량 계산 | 설정 금액(USDT) x 레버리지 / 계약 가치 자동 계산 |
| 레버리지 설정 | 주문 전 자동 설정 |
| 포지션 청산 | 반대 방향 시장가 주문으로 전량 청산 |
| 미체결 주문 취소 | 전체 미체결 주문 일괄 취소 |

---

### 2.4 리스크 관리

| 항목 | 설명 | 기본값 |
|------|------|--------|
| 손절 (SL) | MTF Order Block 하단/상단 기반 또는 고정 비율 | 1% |
| 익절 (TP) | R:R = 1:3 (리스크 대비 3배 수익) | 3% |
| 일일 최대 손실 | 한도 도달 시 당일 매매 자동 중단 | 10 USDT |
| 포지션 크기 | 잔고의 일부만 사용 | 30 USDT |
| 단일 포지션 | 기존 포지션 보유 시 추가 진입 불가 | - |
| 자동 SL/TP 모니터링 | 매 틱마다 현재가 vs SL/TP 비교 후 자동 청산 | - |

#### SL/TP 계산 로직
- **Long SL**: MTF OB 하단 x (1 - SL% x 0.3) 또는 LTF 스윙 로우 아래 또는 진입가 x (1 - SL%)
- **Short SL**: MTF OB 상단 x (1 + SL% x 0.3) 또는 LTF 스윙 하이 위 또는 진입가 x (1 + SL%)
- **TP**: 리스크(진입가 - SL) x 3 만큼 수익 방향으로 설정

---

### 2.5 텔레그램 연동

#### 자동 알림
| 이벤트 | 알림 내용 |
|--------|----------|
| 봇 시작 | 시작 상태 메시지 |
| 포지션 진입 | 방향, 진입가, SL, TP, 수량, 컨플루언스 상세 |
| 익절 청산 | 청산가, PnL |
| 손절 청산 | 청산가, PnL |
| 일일 손실 한도 도달 | 일일 PnL, 한도, 매매 중단 안내 |
| 에러 발생 | 오류 메시지 |
| 봇 종료 | 종료 상태 메시지 |

#### 사용자 명령어
| 명령어 | 기능 |
|--------|------|
| `/status` | 봇 실행 상태, 거래쌍, 레버리지, 타임프레임, 포지션 요약 |
| `/position` | 현재 포지션 상세 (방향, 수량, 진입가, 현재가, 미실현 PnL) |
| `/balance` | 총 잔고, 가용 잔고, 미실현 PnL |
| `/pnl` | 일일 PnL, 일일 손실 한도 사용률 |
| `/close` | 현재 포지션 즉시 청산 |
| `/stop` | 봇 매매 정지 (포지션 유지) |
| `/start` | 봇 매매 재개 |
| `/help` | 명령어 목록 표시 |

#### 보안
- 등록된 Telegram Chat ID만 명령어 허용
- 미인증 사용자 접근 시 "권한 없음" 응답

---

### 2.6 Gate.io 선물 API 연동

| API 기능 | 메서드 | 용도 |
|----------|--------|------|
| 캔들 조회 | `listFuturesCandlesticks` | OHLCV 데이터 (HTF/MTF/LTF) |
| 티커 조회 | `listFuturesTickers` | 현재가, 마크가, 인덱스가 |
| 계약 정보 | `getFuturesContract` | 계약 승수, 최소 주문량 |
| 레버리지 설정 | `updateDualModePositionLeverage` | 포지션 레버리지 |
| 주문 생성 | `createFuturesOrder` | 시장가/지정가 주문 |
| 포지션 조회 | `getPosition` | 현재 포지션 상태 |
| 잔고 조회 | `listFuturesAccounts` | USDT 선물 계좌 잔고 |
| 주문 취소 | `cancelFuturesOrders` | 미체결 주문 일괄 취소 |

- 마진 유형: USDT 마진 (settle = 'usdt')
- 3개 타임프레임 캔들 동시 조회 (Promise.all)

---

## 3. 실행 흐름

```
[봇 시작]
  ├─ API 키 검증
  ├─ 잔고 확인
  ├─ 기존 포지션 확인
  ├─ 텔레그램 봇 초기화
  └─ 크론 스케줄 등록 (매 1분)
        │
        ▼
[매 틱 (1분마다)]
  ├─ 포지션 보유 중?
  │   ├─ YES → SL/TP 모니터링
  │   │         ├─ SL 도달 → 청산 + 텔레그램 알림
  │   │         ├─ TP 도달 → 청산 + 텔레그램 알림
  │   │         └─ 유지 중 → 다음 틱 대기
  │   └─ NO → 아래 진행
  │
  ├─ 캔들 데이터 조회 (4h + 1h + 15m 동시)
  │
  ├─ ICT 멀티 타임프레임 분석
  │   ├─ HTF(4h): 방향 판단 (HH/HL vs LH/LL)
  │   ├─ MTF(1h): 구조 확인 (MSS + OB/FVG)
  │   └─ LTF(15m): 진입 조건 (Kill Zone + OTE/Sweep)
  │
  ├─ 신호 없음 → 다음 틱 대기
  │
  └─ 신호 있음 → 주문 실행
        ├─ 일일 손실 한도 확인
        ├─ 잔고 확인
        ├─ 레버리지 설정
        ├─ 수량 계산
        ├─ 시장가 주문 체결
        └─ 텔레그램 진입 알림
```

---

## 4. 환경 설정

### 4.1 환경변수 (.env)
| 변수 | 설명 | 기본값 |
|------|------|--------|
| `GATEIO_API_KEY` | Gate.io API 키 | (필수) |
| `GATEIO_API_SECRET` | Gate.io API 시크릿 | (필수) |
| `TRADE_PAIR` | 거래쌍 | BTC_USDT |
| `LEVERAGE` | 레버리지 배수 | 5 |
| `POSITION_SIZE_USDT` | 1회 포지션 크기 (USDT) | 100 |
| `MAX_POSITIONS` | 최대 동시 포지션 수 | 3 |
| `STOP_LOSS_PERCENT` | 손절 비율 (%) | 2 |
| `TAKE_PROFIT_PERCENT` | 익절 비율 (%) | 4 |
| `MAX_DAILY_LOSS_USDT` | 일일 최대 손실 (USDT) | 300 |
| `TELEGRAM_BOT_TOKEN` | 텔레그램 봇 토큰 | (선택) |
| `TELEGRAM_CHAT_ID` | 텔레그램 채팅 ID | (선택) |
| `HTF_INTERVAL` | 상위 타임프레임 | 4h |
| `MTF_INTERVAL` | 중위 타임프레임 | 1h |
| `LTF_INTERVAL` | 하위 타임프레임 | 15m |
| `BOT_CRON_SCHEDULE` | 실행 주기 (크론 표현식) | */1 * * * * |
| `LOG_LEVEL` | 로그 레벨 | info |

### 4.2 100 USDT 소액 추천 설정
| 변수 | 추천값 | 이유 |
|------|--------|------|
| `LEVERAGE` | 10 | 소액 효율 극대화 |
| `POSITION_SIZE_USDT` | 30 | 잔고의 30%, 연속 손절 대비 |
| `STOP_LOSS_PERCENT` | 1 | 1건당 약 3 USDT 손실 |
| `TAKE_PROFIT_PERCENT` | 3 | R:R = 1:3, 승률 30%도 수익 |
| `MAX_DAILY_LOSS_USDT` | 10 | 잔고의 10% 일일 한도 |

---

## 5. 배포 환경

### 5.1 인프라
| 항목 | 사양 |
|------|------|
| 클라우드 | Oracle Cloud Infrastructure |
| 인스턴스 | VM.Standard.E2.1.Micro |
| OS | Ubuntu 22.04 LTS |
| CPU | 1 OCPU (AMD x86) |
| RAM | 1 GB |
| 저장소 | 50 GB |
| 비용 | 무료 (Always Free Tier) |

### 5.2 PM2 프로세스 관리
| 설정 | 값 | 설명 |
|------|---|------|
| 인스턴스 수 | 1 | 단일 프로세스 |
| 자동 재시작 | true | 크래시 시 자동 복구 |
| 메모리 제한 | 256MB | 초과 시 재시작 |
| 재시작 딜레이 | 5초 | 연속 크래시 방지 |
| 최대 재시작 | 15회/10분 | 무한 루프 방지 |

### 5.3 로깅
| 파일 | 내용 |
|------|------|
| `logs/combined.log` | 전체 로그 |
| `logs/error.log` | 에러 로그만 |
| `logs/pm2-out.log` | PM2 stdout |
| `logs/pm2-error.log` | PM2 stderr |

---

## 6. 보안 요구사항

| 항목 | 상태 | 설명 |
|------|------|------|
| API 키 환경변수 관리 | 적용 | .env 파일 (gitignore 처리) |
| Gate.io IP 화이트리스트 | 필수 | API 설정에서 서버 IP만 허용 |
| Gate.io 출금 권한 비활성화 | 필수 | 선물 거래 권한만 활성화 |
| 텔레그램 Chat ID 인증 | 적용 | 등록된 ID만 명령어 허용 |
| GitHub 비공개 저장소 | 적용 | 코드 외부 노출 방지 |
| SSH 키 기반 서버 접속 | 적용 | 비밀번호 접속 비활성화 |

---

## 7. 모니터링 및 운영

### 7.1 서버 관리 명령어
| 명령어 | 기능 |
|--------|------|
| `pm2 status` | 봇 프로세스 상태 확인 |
| `pm2 logs` | 실시간 로그 확인 |
| `pm2 restart ict-trading-bot` | 봇 재시작 |
| `pm2 stop ict-trading-bot` | 봇 정지 |
| `pm2 start ecosystem.config.js` | 봇 시작 |

### 7.2 텔레그램 원격 관리
핸드폰 텔레그램 앱에서 `/status`, `/position`, `/balance`, `/pnl` 명령어로 실시간 모니터링 가능. `/close`로 긴급 청산, `/stop`으로 매매 중단 가능.

---

## 8. 제약사항 및 주의사항

1. **단일 거래쌍**: 현재 1개 거래쌍만 동시 거래 가능
2. **단일 포지션**: 기존 포지션 보유 시 추가 진입 불가
3. **Kill Zone 의존**: Kill Zone 시간대 외에는 진입하지 않음
4. **API Rate Limit**: Gate.io API 호출 제한에 따라 과도한 요청 시 차단 가능
5. **실거래 전 소액 테스트 필수**: 전략 검증 없이 큰 금액 투입 금지
6. **서버 네트워크 의존**: 서버 다운 또는 네트워크 장애 시 SL/TP 모니터링 중단
