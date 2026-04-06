# Gate.io ICT 선물 자동매매 트레이딩 봇 - 통합 명세서

> 버전: 2.0.0
> 작성일: 2026-04-06
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
│   ├── strategies/ictStrategy.js # ICT v2 멀티 타임프레임 전략
│   ├── services/
│   │   ├── orderManager.js       # 주문 실행 및 리스크 관리
│   │   └── telegram.js           # 텔레그램 알림 및 명령어
│   ├── utils/
│   │   ├── indicators.js         # ICT 기술적 지표 엔진 v2
│   │   └── logger.js             # 로깅
│   └── bot.js                    # 메인 봇 루프
├── scripts/setup-server.sh       # 서버 초기 설정 스크립트
├── ecosystem.config.js           # PM2 배포 설정
├── .env.example                  # 환경변수 템플릿
└── package.json
```

---

## 2. ICT 전략 v2 개요

ICT(Inner Circle Trading)는 기관 트레이더의 매매 행동 패턴을 분석하여 유동성 흐름과 가격 불균형을 포착하는 전략이다.

### 2.1 핵심 개념

| 개념 | 설명 | 역할 |
|------|------|------|
| Market Structure Shift (MSS) | 스윙 구조 돌파를 통한 추세 전환 감지 | 방향 전환 확인 |
| Order Block (OB) | 기관의 대량 매집/분배가 발생한 가격 영역 | 핵심 지지/저항 |
| Fair Value Gap (FVG) | 급격한 가격 변동으로 생긴 불균형 갭 | 되돌림 목표 |
| FVG CE (Consequent Encroachment) | FVG의 정확히 50% 지점 | 기관 진입 포인트 |
| IOFED | 연속 봉 후 반전 (기관 주문 흐름 전환) | 진입 트리거 |
| PDH/PDL | 전일 고가/저가 | 유동성 타겟 |
| Session Range | 세션별 고가/저가 | 유동성 기준 |
| Liquidity Sweep | 스윙 포인트 일시 돌파 후 복귀 | 역전 진입 신호 |

---

## 3. 멀티 타임프레임 분석 (4h → 15m → 5m)

### 3.1 분석 흐름

```
┌──────────────────────────────────────────────┐
│  STEP 1: HTF (4h) - 방향 판단 + PDH/PDL      │
│                                              │
│  ✓ HH + HL → BULLISH                        │
│  ✓ LH + LL → BEARISH                        │
│  ✓ HTF MSS / PDH·PDL Sweep → 방향 전환       │
│  ✗ 횡보 구간 → 진입 안 함                      │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  STEP 2: MTF (15m) - 구조 확인               │
│                                              │
│  ✓ HTF 방향과 동일한 MSS 확인                  │
│  ✓ 같은 방향의 OB 존재                        │
│  ✓ 같은 방향의 미메움 FVG 존재 (CE 표시)       │
│  ✗ MSS도 POI도 없으면 → 진입 안 함            │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│  STEP 3: LTF (5m) - 정밀 진입                │
│                                              │
│  필수: 활성 세션 내 (점심·주말 제외)            │
│  + 아래 중 하나 이상:                          │
│    ✓ FVG CE (50% 지점) 도달                   │
│    ✓ FVG Fill (50%+ 채움)                    │
│    ✓ IOFED (연속봉 후 반전)                    │
│    ✓ Liquidity Sweep                         │
└──────────────────┬───────────────────────────┘
                   ▼
            ┌──────────────┐
            │   주문 실행    │
            └──────────────┘
```

### 3.2 타임프레임 설정

| 단계 | 기본값 | 환경변수 | 역할 |
|------|--------|---------|------|
| HTF | 4h | HTF_INTERVAL | 방향 판단 + PDH/PDL |
| MTF | 15m | MTF_INTERVAL | 구조 확인 (MSS + OB/FVG) |
| LTF | 5m | LTF_INTERVAL | 정밀 진입 (FVG CE/Fill/IOFED) |

---

## 4. 세션 시스템

### 4.1 세션 시간표 (UTC / KST)

| 세션 | AM (UTC) | 점심 제외 | PM (UTC) | KST |
|------|---------|----------|---------|-----|
| Asian | 00:00~03:00 | 03:00~04:00 | 04:00~06:30 | 09:00~15:30 |
| London | 07:00~10:30 | 10:30~11:30 | 11:30~14:00 | 16:00~23:00 |
| New York | 13:30~16:00 | 16:00~17:00 | 17:00~19:30 | 22:30~04:30 |

- 주말(토/일) 자동 제외
- 각 세션 점심시간 자동 제외

---

## 5. ICT 지표 상세

### 5.1 Swing High / Low
- Swing High: 양쪽 n개 봉보다 높은 고가 (lookback: 5)
- Swing Low: 양쪽 n개 봉보다 낮은 저가

### 5.2 Market Structure Shift (MSS)
- Bullish MSS: 하락 구조에서 직전 스윙 하이를 종가 상방 돌파
- Bearish MSS: 상승 구조에서 직전 스윙 로우를 종가 하방 돌파

### 5.3 Order Block (OB)
- Bullish OB: 음봉 → 강한 양봉 (0.2%+ 변동), 음봉 영역이 OB
- Bearish OB: 양봉 → 강한 음봉 (0.2%+ 변동), 양봉 영역이 OB
- 탐색 범위: 최근 50봉

### 5.4 Fair Value Gap (FVG) + CE + Fill
- Bullish FVG: 1번봉 고가 < 3번봉 저가 (상승 갭)
- Bearish FVG: 1번봉 저가 > 3번봉 고가 (하락 갭)
- CE (Consequent Encroachment): FVG의 정확히 50% 지점
- Fill: 이후 캔들이 FVG를 얼마나 채웠는지 (100% = 완전 메움)
- 최소 갭: 0.05%, CE 진입 허용 오차: 1%

### 5.5 IOFED (Institutional Order Flow Entry Drill)
- Bullish IOFED: 3봉+ 연속 음봉 후 양봉 전환
- Bearish IOFED: 3봉+ 연속 양봉 후 음봉 전환
- 최근 5봉 내의 IOFED만 유효

### 5.6 PDH/PDL (Previous Day High/Low)
- 전일 캔들 데이터에서 고가/저가 추출
- PDH/PDL Sweep 감지 (일시 돌파 후 복귀)
- HTF 방향 보강 및 SL 기준으로 활용

### 5.7 Session Range
- 각 세션(Asian/London/NY)의 당일 고가/저가
- Session Range Sweep 감지
- 유동성 기준으로 활용

### 5.8 Liquidity Sweep
- Bullish Sweep: 스윙 로우 아래 wick 후 종가 복귀
- Bearish Sweep: 스윙 하이 위 wick 후 종가 복귀
- 최근 3개 스윙 포인트 검사

---

## 6. 진입 조건

### 6.1 Long 진입 체크리스트
```
[HTF 4h] 다음 중 하나:
  ☐ HH + HL (상승 구조)
  ☐ Bullish MSS
  ☐ PDL Sweep 반전

[MTF 15m] 모두 충족:
  ☐ 구조: Bullish MSS 또는 Bullish OB 존재
  ☐ POI: Bullish OB 또는 미메움 Bullish FVG 존재

[LTF 5m] 필수 + 선택:
  ☐ [필수] 활성 세션 내 (점심·주말 제외)
  ☐ [1개+] FVG CE 도달 (50% 지점)
  ☐ [1개+] FVG Fill (50%+ 채움)
  ☐ [1개+] Bullish IOFED (연속 음봉 후 양봉)
  ☐ [1개+] Bullish Liquidity Sweep
```

### 6.2 Short 진입 체크리스트
```
[HTF 4h] 다음 중 하나:
  ☐ LH + LL (하락 구조)
  ☐ Bearish MSS
  ☐ PDH Sweep 반전

[MTF 15m] 모두 충족:
  ☐ 구조: Bearish MSS 또는 Bearish OB 존재
  ☐ POI: Bearish OB 또는 미메움 Bearish FVG 존재

[LTF 5m] 필수 + 선택:
  ☐ [필수] 활성 세션 내 (점심·주말 제외)
  ☐ [1개+] FVG CE 도달 (50% 지점)
  ☐ [1개+] FVG Fill (50%+ 채움)
  ☐ [1개+] Bearish IOFED (연속 양봉 후 음봉)
  ☐ [1개+] Bearish Liquidity Sweep
```

### 6.3 미진입 조건
| 조건 | 설명 |
|------|------|
| HTF 횡보 | 방향 불명확 |
| 세션 외 / 점심 / 주말 | 비활성 시간 |
| MTF 구조 부족 | MSS·OB·FVG 없음 |
| LTF 진입 없음 | CE/Fill/IOFED/Sweep 없음 |
| 기존 포지션 보유 | 중복 진입 방지 |
| 일일 손실 한도 | 리스크 관리 |
| 잔고 부족 | 주문 불가 |

---

## 7. SL/TP 계산

### 7.1 SL 우선순위

| 우선순위 | Long SL | Short SL |
|---------|---------|----------|
| 1 | MTF OB 하단 × (1 - SL% × 0.3) | MTF OB 상단 × (1 + SL% × 0.3) |
| 2 | LTF 스윙 로우 × (1 - 0.1%) | LTF 스윙 하이 × (1 + 0.1%) |
| 3 | PDL × (1 - 0.1%) | PDH × (1 + 0.1%) |
| 4 | 진입가 × (1 - SL%) | 진입가 × (1 + SL%) |

### 7.2 TP 계산
```
리스크 = |진입가 - SL|
TP = 진입가 ± 리스크 × 3  (R:R = 1:3)
```

### 7.3 SL/TP 실행 방식
- Gate.io Price Trigger Order (조건부 지정가)로 거래소에 등록
- 봇이 꺼져도 SL/TP는 거래소에서 자동 작동
- SL 체결 시 TP 자동 취소, TP 체결 시 SL 자동 취소
- 등록 실패 시 최대 3회 재시도

---

## 8. 주문 실행

| 기능 | 설명 |
|------|------|
| 진입 | 시장가 IOC 즉시 체결 |
| SL/TP | 조건부 지정가 (Price Trigger Order) |
| 수량 계산 | 설정 USDT × 레버리지 / 계약 가치 |
| 레버리지 | 싱글/듀얼/크로스 모드 자동 대응 |
| 포지션 조회 | 싱글/듀얼 모드 자동 대응 |
| 청산 | 반대 방향 시장가 + 조건부 주문 취소 |

---

## 9. 컨플루언스 시스템

| 단계 | 컨플루언스 | 예시 |
|------|----------|------|
| 세션 | 활성 세션 | `세션: London AM` |
| HTF | 방향 | `HTF(4h) BULLISH` |
| HTF | PDH/PDL Sweep | `PDL Sweep (82000.00)` |
| MTF | MSS | `MTF(15m) bullish MSS` |
| MTF | OB | `MTF OB [83200-83500]` |
| MTF | FVG + CE | `MTF FVG [...] CE:83350` |
| LTF | FVG CE | `LTF FVG CE @ 83300 (40% filled)` |
| LTF | FVG Fill | `LTF FVG Fill @ 55%` |
| LTF | IOFED | `IOFED bullish (4연속봉 후 반전)` |
| LTF | Sweep | `LTF Sweep @ 82800` |
| LTF | Session Range | `London Range Sweep` |

---

## 10. 텔레그램 연동

### 10.1 자동 알림
| 이벤트 | 내용 |
|--------|------|
| 봇 시작/종료 | 상태 메시지 |
| 포지션 진입 | 방향, 가격, SL/TP, 컨플루언스 |
| 익절/손절 | 청산가, PnL |
| 일일 한도 도달 | 매매 중단 안내 |
| 에러 | 오류 메시지 |

### 10.2 명령어
| 명령어 | 기능 |
|--------|------|
| /status | 봇 상태 조회 |
| /position | 포지션 상세 |
| /balance | 잔고 조회 |
| /pnl | 오늘 손익 |
| /analyze | ICT v2 실시간 분석 |
| /close | 포지션 청산 + SL/TP 취소 |
| /stop | 봇 정지 |
| /start | 봇 재개 |
| /help | 명령어 목록 |

### 10.3 보안
- 등록된 Chat ID만 명령어 허용

---

## 11. 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| GATEIO_API_KEY | API 키 | (필수) |
| GATEIO_API_SECRET | API 시크릿 | (필수) |
| TRADE_PAIR | 거래쌍 | BTC_USDT |
| LEVERAGE | 레버리지 | 5 |
| POSITION_SIZE_USDT | 포지션 크기 | 100 |
| STOP_LOSS_PERCENT | 손절 비율 | 2 |
| TAKE_PROFIT_PERCENT | 익절 비율 | 4 |
| MAX_DAILY_LOSS_USDT | 일일 최대 손실 | 300 |
| TELEGRAM_BOT_TOKEN | 텔레그램 토큰 | (선택) |
| TELEGRAM_CHAT_ID | 텔레그램 Chat ID | (선택) |
| HTF_INTERVAL | 상위 타임프레임 | 4h |
| MTF_INTERVAL | 중위 타임프레임 | 15m |
| LTF_INTERVAL | 하위 타임프레임 | 5m |
| BOT_CRON_SCHEDULE | 실행 주기 | */1 * * * * |
| LOG_LEVEL | 로그 레벨 | info |

### 100 USDT 소액 추천 설정
| 변수 | 값 | 이유 |
|------|---|------|
| LEVERAGE | 10 | 소액 효율 |
| POSITION_SIZE_USDT | 30 | 잔고 30% |
| STOP_LOSS_PERCENT | 1 | 건당 ~3 USDT |
| MAX_DAILY_LOSS_USDT | 10 | 잔고 10% |

---

## 12. 배포

### 12.1 인프라
| 항목 | 사양 |
|------|------|
| Oracle Cloud | VM.Standard.E2.1.Micro |
| OS | Ubuntu 22.04 |
| CPU/RAM | 1 OCPU / 1 GB |
| 비용 | 무료 (Always Free) |

### 12.2 PM2
| 설정 | 값 |
|------|---|
| 자동 재시작 | true |
| 메모리 제한 | 256MB |
| 재시작 딜레이 | 5초 |
| 최대 재시작 | 15회/10분 |

---

## 13. 보안

| 항목 | 상태 |
|------|------|
| API 키 .env 관리 | 적용 (.gitignore) |
| Gate.io IP 화이트리스트 | 필수 |
| 출금 권한 비활성화 | 필수 |
| 텔레그램 Chat ID 인증 | 적용 |
| GitHub 비공개 저장소 | 적용 |
| SSH 키 서버 접속 | 적용 |

---

## 14. ICT 전략 파라미터

| 파라미터 | 값 | 설명 |
|---------|---|------|
| swingLookback | 20 | 스윙 탐색 범위 |
| structureShiftBars | 5 | 스윙 판별 봉 수 |
| fvgMinGapPercent | 0.05% | FVG 최소 갭 |
| fvgCeThreshold | 1% | CE 진입 허용 오차 |
| iofedMinBars | 3 | IOFED 최소 연속 봉 |
| oteFibLow | 0.62 | OTE 하한 |
| oteFibHigh | 0.79 | OTE 상한 |
| orderBlockLookback | 50 | OB/FVG 탐색 범위 |

---

## 15. 제약사항

1. 단일 거래쌍만 동시 거래 가능
2. 기존 포지션 보유 시 추가 진입 불가
3. 세션 외/점심/주말에는 진입 안 함
4. 과거 캔들 데이터 기반 (실시간 오더북 미사용)
5. mitigated OB 필터링 미지원
6. 뉴스 이벤트 미고려
7. API Rate Limit 주의
8. 실거래 전 소액 테스트 필수
