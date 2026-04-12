# ICT 전략 시리즈 1: 기술적 지표

> v3.0.0 | 2026-04-12 | ictStrategy.js + indicators.js 기준

---

## 1. Swing High / Swing Low

모든 ICT 분석의 기초. 구조적 고점/저점.

- **Swing High**: 양쪽 n개 봉보다 높은 고가
- **Swing Low**: 양쪽 n개 봉보다 낮은 저가
- Lookback: `structureShiftBars = 5`

사용: HTF / MTF / LTF 전 타임프레임에서 구조 파악의 기본 단위

---

## 2. BOS / CHoCH (구조 전환)

기존 MSS(Market Structure Shift)를 **BOS와 CHoCH로 분리 라벨링**.

| 유형 | 의미 | 조건 |
|------|------|------|
| **BOS** (Break of Structure) | 추세 지속 | 기존 추세와 같은 방향의 구조 돌파 |
| **CHoCH** (Change of Character) | 추세 전환 | 기존 추세와 반대 방향의 구조 돌파 |

판단 과정:
1. 직전 swing 패턴으로 기존 추세 추정 (HH+HL = bullish, LH+LL = bearish)
2. 현재 돌파가 기존 추세 방향과 같으면 **BOS**, 반대면 **CHoCH**

사용 위치:
- **HTF (4h)**: 방향 판단 - HH+HL / LH+LL 우선, 없으면 BOS/CHoCH로 판단
- **MTF (15m)**: 구조 확인 - HTF 방향과 정렬된 BOS/CHoCH만 컨플루언스
- **LTF (5m)**: 추가 컨플루언스 (진입 결정에 직접 관여 안 함)

---

## 3. Order Block (OB)

기관 대량 주문 영역. 강한 지지/저항.

| 유형 | 패턴 | 강도 조건 | OB 영역 |
|------|------|----------|---------|
| Bullish OB | 음봉 -> 강한 양봉 | 0.2%+ 변동 | 음봉의 시가~종가 |
| Bearish OB | 양봉 -> 강한 음봉 | 0.2%+ 변동 | 양봉의 시가~종가 |

탐색 범위: 최근 50봉 (`orderBlockLookback`)

### 타임프레임별 역할

| 타임프레임 | 같은 방향 OB | 반대 방향 OB (Opposing) |
|-----------|-------------|----------------------|
| HTF (4h) | 탑다운 POI (가장 강함) + SL 1순위 | TP 구조적 타겟 |
| MTF (15m) | 구조 확인 + SL 2순위 | TP 구조적 타겟 |
| LTF (5m) | 사용 안 함 | 사용 안 함 |

**HTF+MTF OB 겹침**: 두 타임프레임의 OB가 가격 범위 겹치면 **최강 셋업** (컨플루언스 +12점)

---

## 4. Fair Value Gap (FVG) + CE + Fill

### FVG 정의
- **Bullish FVG**: 봉1 고가 < 봉3 저가 (갭 상승)
- **Bearish FVG**: 봉1 저가 > 봉3 고가 (갭 하락)
- 최소 갭: 0.05% (`fvgMinGapPercent`)

### CE (Consequent Encroachment)
FVG의 정확히 50% 지점 = 기관이 가장 많이 반응하는 가격대
```
CE = (FVG top + FVG bottom) / 2
진입 허용 오차: 0.15% (fvgCeThreshold)
```

### FVG Fill
이후 캔들이 FVG를 채운 비율:
- 0~49%: 아직 채워지지 않음
- 50~99%: 진입 근거로 사용 (FVG Fill 진입)
- 100%: 완전 메움 (유효하지 않음)

### 타임프레임별 역할

| 타임프레임 | 같은 방향 FVG | 반대 방향 FVG (Opposing) |
|-----------|-------------|------------------------|
| HTF (4h) | 탑다운 POI | TP 구조적 타겟 |
| MTF (15m) | 구조 확인 POI | 사용 안 함 |
| LTF (5m) | **진입 트리거** (CE / Fill) | 사용 안 함 |

**HTF+MTF FVG 겹침**: 동일하게 최강 셋업 가점

---

## 5. Liquidity Sweep (BSL / SSL)

스윙 포인트를 일시 돌파 후 복귀하는 "스톱 헌팅" 패턴.

| 라벨 | 의미 | 조건 | 방향 |
|------|------|------|------|
| **BSL** (Buy-Side Liquidity) | Swing High 위 스톱 쓸기 | high > SH, close < SH | Bearish 반전 |
| **SSL** (Sell-Side Liquidity) | Swing Low 아래 스톱 쓸기 | low < SL, close > SL | Bullish 반전 |

최근 3개 스윙 포인트 검사.

### 타임프레임별 역할

| 타임프레임 | 역할 | 중요도 |
|-----------|------|--------|
| **HTF (4h)** | 기관 스톱헌트 확인 | 최고 (컨플루언스 +10점) |
| **MTF (15m)** | 구조적 스윕 확인 | 높음 (컨플루언스 +7점) |
| **LTF (5m)** | 진입 트리거 / 추가 컨플루언스 | 중간 (컨플루언스 +6점) |

---

## 6. IOFED (Institutional Order Flow Entry Drill)

기관이 한 방향으로 연속 주문 후 반전하는 패턴.

| 유형 | 조건 | 유효 기간 |
|------|------|----------|
| Bullish | 3봉+ 연속 음봉 -> 양봉 전환 | 최근 5봉 이내 |
| Bearish | 3봉+ 연속 양봉 -> 음봉 전환 | 최근 5봉 이내 |

최소 연속 봉: 3개 (`iofedMinBars`)
사용: LTF (5m) 진입 트리거 (3순위)

---

## 7. PDH/PDL (Previous Day High/Low)

전일 고가/저가. 일일 유동성 레벨.

| 이벤트 | 의미 | 활용 |
|--------|------|------|
| PDH Sweep | 매도 유동성 포착 | Bearish 방향 보강 |
| PDL Sweep | 매수 유동성 포착 | Bullish 방향 보강 |

추가 역할:
- HTF 방향 불명확 시 PDH/PDL Sweep으로 방향 결정 (최후 수단)
- TP 구조적 타겟 (Long -> PDH, Short -> PDL)
- SL 후보 (4순위)

---

## 8. HTF POI 활성 감지

현재가가 HTF OB 또는 HTF FVG에 **+/- 0.3%** 이내로 근접하면 "활성 POI"로 분류.

```
activeOB  = 현재가 in [ob.low x 0.997, ob.high x 1.003]
activeFVG = 현재가 in [fvg.bottom x 0.997, fvg.top x 1.003]
```

효과:
- `hasHtfPoi = true` -> R:R 필터 완화 (min 1.5)
- Kelly `poiBoost = 1.0` (전체 사이즈)
- HTF POI 밖이면 `poiBoost = 0.5` (절반 사이즈)
- 컨플루언스 가점 (+15점 OB, +12점 FVG)

---

## 9. Session Range

각 세션(Asian/London/NY)의 당일 고가/저가 레인지.

| 이벤트 | 의미 |
|--------|------|
| Session Range High Sweep | 해당 세션 고가 위 유동성 포착 |
| Session Range Low Sweep | 해당 세션 저가 아래 유동성 포착 |

사용: LTF (5m) 추가 컨플루언스 (+5점)
