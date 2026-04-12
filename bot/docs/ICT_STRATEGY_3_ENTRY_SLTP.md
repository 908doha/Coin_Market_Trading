# ICT 전략 시리즈 3: 진입 / SL-TP / 리스크 관리

> v3.0.0 | 2026-04-12 | ictStrategy.js + orderManager.js 기준

---

## 1. 5단계 진입 프로세스

```
Step 0: 세션 활성?
  -> No: 스킵 (자동 매매 안 함)
  -> Yes: 다음 단계

Step 1: HTF (4h) 방향 판단
  -> 방향 불명확: 스킵
  -> Bullish 또는 Bearish 확정: 다음 단계

Step 2: MTF (15m) 구조 확인
  -> 구조+POI 미충족: 스킵
  -> 확인됨: 다음 단계

Step 3: LTF (5m) 진입 트리거
  -> FVG CE / FVG Fill / IOFED / BSL-SSL 중 1개 이상: 다음 단계
  -> 없음: 스킵

Step 4: SL/TP 구조적 계산 + R:R 필터
  -> R:R < 최소 기준: 스킵
  -> R:R 충족: 진입 확정

Step 5: Setup Score 계산 + 주문 실행
```

---

## 2. STEP 1: HTF (4h) 방향 판단

### 방향 결정 우선순위

| 순위 | 조건 | 방향 | 확신도 |
|------|------|------|--------|
| 1 | HH + HL | Bullish | 최고 |
| 1 | LH + LL | Bearish | 최고 |
| 2 | BOS bullish / bearish | 해당 방향 | 높음 |
| 2 | CHoCH bullish / bearish | 해당 방향 | 높음 (추세 전환) |
| 3 | PDL Sweep 반전 | Bullish | 보통 |
| 3 | PDH Sweep 반전 | Bearish | 보통 |
| - | 위 모두 해당 없음 | 스킵 | - |

### HTF에서 추가로 수집하는 데이터
- HTF OB / FVG (같은 방향 = 지지/저항, 반대 방향 = TP 타겟)
- HTF Active POI (현재가 +/-0.3% 이내)
- HTF BSL/SSL Sweep

---

## 3. STEP 2: MTF (15m) 구조 확인

### 통과 조건 (둘 다 필요)

| 조건 | 설명 |
|------|------|
| 구조 확인 | HTF 방향과 정렬된 BOS/CHoCH **또는** 같은 방향 OB 존재 |
| POI 존재 | 같은 방향 OB **또는** 미메움 FVG 존재 (위치 검증됨) |

### MTF 컨플루언스
- MTF BOS/CHoCH (HTF 방향 정렬)
- MTF OB [가격 범위]
- MTF FVG [가격 범위] CE:값
- HTF+MTF OB 겹침 (탑다운 정렬 = 최강)
- HTF+MTF FVG 겹침
- MTF BSL/SSL Sweep

---

## 4. STEP 3: LTF (5m) 진입 트리거

### 진입 근거 (우선순위 순, 1개 이상 충족)

| 순위 | 근거 | 설명 | 점수 |
|------|------|------|------|
| 1 | **FVG CE** | FVG 50% 지점에 현재가 +/-0.15% 도달 | +8 |
| 2 | **FVG Fill** | FVG가 50~99% 채워진 시점, 현재가 FVG 내부 | +6 |
| 3 | **IOFED** | 3봉+ 연속 후 반전 (최근 5봉 이내) | +7 |
| 4 | **BSL/SSL Sweep** | 스윙 포인트 sweep 후 복귀 | +6 |

### LTF 추가 컨플루언스 (진입 결정에 직접 관여 안 함)
- LTF BOS/CHoCH (+4점)
- Session Range Sweep (+5점)

---

## 5. STEP 4: SL/TP 구조적 계산

### 5.1 SL 계산 (구조 기반)

**Long SL 우선순위**:

| 순위 | 소스 | 조건 | 안전장치 |
|------|------|------|----------|
| 1 | HTF OB 하단 | 진입가보다 아래 | 리스크 3% 초과 시 폴백 |
| 2 | MTF OB 하단 | 진입가보다 아래 | - |
| 3 | LTF Swing Low | 진입가보다 아래 | - |
| 4 | PDL | 진입가보다 아래 | - |
| 5 | 고정 비율 | 진입가 x (1 - stopLossPercent) | 최후 수단 |

Short SL은 반대 방향.

### 5.2 TP 계산 (구조적 타겟 = ICT Liquidity Draw)

가격은 다음 유동성 풀로 끌린다.

**Long TP 후보** (가까운 순):
1. HTF Swing High
2. PDH
3. MTF Opposing OB (bearish OB 하단)
4. HTF Opposing OB
5. HTF Opposing FVG
6. 폴백: risk x 2.5

**선택 알고리즘**:
1. 모든 후보를 가까운 순으로 정렬
2. R:R >= 1.5인 첫 후보를 TP로 채택
3. R:R > 5.0이면 risk x 5로 캡
4. 구조 타겟 없으면 폴백 risk x 2.5

### 5.3 R:R 필터 (컨플루언스 강도별)

| 셋업 강도 | 기준 | 최소 R:R | 의미 |
|-----------|------|----------|------|
| **Strong** | HTF POI 안 + 6개+ 컨플루언스 | 1.5 | 자신 있는 셋업 |
| **Medium** | HTF POI 안 또는 5개+ | 2.0 | 괜찮은 셋업 |
| **Weak** | 그 외 | 2.5 | 높은 R:R 필요 |

R:R < 최소 기준이면 진입 스킵.

---

## 6. STEP 5: Setup Score + 주문 실행

### 6.1 컨플루언스 점수표 (100점 만점)

| 컨플루언스 | 점수 | 카테고리 |
|-----------|------|----------|
| 세션 활성 | 5 | 기본 |
| HTF 방향 (BULLISH/BEARISH) | 10 | 기본 |
| **HTF OB 진입 (active)** | **15** | HTF POI |
| HTF FVG 진입 (active) | 12 | HTF POI |
| HTF BSL/SSL Sweep | 10 | HTF Sweep |
| PDH/PDL Sweep | 8 | 유동성 |
| **HTF+MTF OB/FVG 겹침** | **12** | 탑다운 |
| MTF BOS/CHoCH | 8 | MTF 구조 |
| MTF OB | 7 | MTF POI |
| MTF FVG | 5 | MTF POI |
| MTF BSL/SSL Sweep | 7 | MTF Sweep |
| LTF FVG CE | 8 | LTF 진입 |
| LTF FVG Fill | 6 | LTF 진입 |
| IOFED | 7 | LTF 진입 |
| LTF BSL/SSL Sweep | 6 | LTF Sweep |
| LTF BOS/CHoCH | 4 | LTF 구조 |
| Session Range Sweep | 5 | 유동성 |

**R:R 보너스**: >= 2.5 +3, >= 3.0 +5, >= 4.0 +8

### 6.2 등급

| 점수 | 등급 | 라벨 |
|------|------|------|
| 90-100 | S | **ELITE** |
| 80-89 | A | **PREMIUM** |
| 70-79 | B+ | **STRONG** |
| 60-69 | B | **SOLID** |
| 50-59 | C | **MODERATE** |
| 40-49 | D | **WEAK** |
| 0-39 | F | **FRAGILE** |

점수는 **표시 전용** (진입 차단에 사용 안 함). 진입 차단은 R:R 필터가 담당.

---

## 7. Kelly Criterion 포지션 사이징

### 7.1 공식
```
f* = p - (1 - p) / R
  p = 승률
  R = 평균 승리금 / 평균 패배금

실제 적용:
  Kelly 비율 = f* x 0.5 (Half-Kelly)
  상한: 잔고 대비 25% (maxFraction)
  표본 20건 미만: 기본 2% (defaultFraction)
```

### 7.2 페어별 독립 통계
각 페어(BTC.P, ETH.P, ...)마다 별도의 승/패 기록.
`bot/data/kelly-stats.json`에 영구 저장 (봇 재시작해도 유지).

### 7.3 HTF POI 가중치 (poiBoost)
- HTF POI 안 (hasHtfPoi = true): 전체 Kelly 사이즈 (x1.0)
- HTF POI 밖 (hasHtfPoi = false): 절반 Kelly 사이즈 (x0.5)

### 7.4 총 노출 상한
전 페어 합산 레버리지 노출이 잔고의 50% (`maxTotalExposure`) 초과 불가.
초과 시 해당 진입의 사이즈를 남은 한도로 축소.

---

## 8. SL/TP 거래소 등록

### 8.1 Gate.io Price Trigger Order
- 트리거 조건: Mark Price 기준
- 체결 방식: 시장가 (IOC) - 확실한 체결 우선
- `close: true` (Single 모드) 또는 `autoSize: close_long/close_short` (Dual 모드)
- 봇이 꺼져 있어도 거래소에서 독립 작동

### 8.2 Dual 모드 대응
Gate.io 계정이 Dual Position 모드일 때:
- `orderType`: `close-long-position` / `close-short-position`
- `autoSize`: `close_long` / `close_short`
- `reduceOnly: true`

### 8.3 안전장치
- 등록 실패 시 최대 3회 재시도 (2초 간격)
- 체결 확인 실패 시 주문 응답으로 폴백 (주문 자체는 성공한 경우)
- **3-strike 검증**: getPosition이 3회 연속 empty일 때만 청산 판단
  (1-2회 null은 API 일시 장애로 간주, SL/TP 취소 안 함)

---

## 9. 진입 예시 (현재 코드 기준)

### Strong Setup (XAUT.P LONG, ~60/100 SOLID)
```
[세션] London AM                             [+5]
[HTF] BULLISH (HH+HL)                       [+10]
[HTF POI] HTF OB 진입 [4692-4693]           [+15]
[MTF] MTF OB [4690-4704]                    [+7]
[탑다운] HTF+MTF OB 겹침 [4692-4693]        [+12]
[LTF] FVG CE @ 4700 (진입가 4706)           [+8]
[R:R] 2.5 보너스                             [+3]
                                    합계: 60/100 SOLID

진입가: 4706.60 | SL: 4687.61 (HTF OB) | TP: 4763.58 (구조적)
R:R: 1:2.5 | Kelly boost: 1.0 (HTF POI 안)
```

### Weak Setup (XBR.P SHORT, ~32/100 FRAGILE)
```
[세션] London AM                             [+5]
[HTF] BEARISH (LH+LL)                       [+10]
[MTF] MTF OB [95.03-95.15]                  [+7]
[LTF] IOFED bearish (3연속봉 후 반전)       [+7]
[R:R] 2.5 보너스                             [+3]
                                    합계: 32/100 FRAGILE

진입가: 94.88 | SL: 97.40 (HTF OB) | TP: 88.60 (폴백 risk x 2.5)
R:R: 1:2.5 | Kelly boost: 0.5 (HTF POI 밖 = 절반 사이즈)
```

---

## 10. 텔레그램 명령어

| 명령 | 설명 |
|------|------|
| `/status` | 봇 상태 + 활성 포지션 |
| `/pairs` | 거래 페어 목록 (활성 표시) |
| `/position` | 모든 활성 포지션 (세로 레이아웃) |
| `/position ETH` | 특정 페어 상세 |
| `/balance` | 잔고 + 총 노출 |
| `/pnl` | 일일 손익 + 페어별 Kelly 통계 |
| `/analyze` | 모든 페어 요약 (점수 포함) |
| `/analyze ETH` | 특정 페어 상세 분석 |
| `/close ETH` | 특정 페어 청산 |
| `/close all` | 모든 페어 청산 |
| `/stop` | 봇 정지 (포지션 유지) |
| `/start` | 봇 재개 |
| `/help` | 명령어 목록 |
