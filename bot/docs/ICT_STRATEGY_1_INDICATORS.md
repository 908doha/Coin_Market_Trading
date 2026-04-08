# ICT 전략 시리즈 1: 기술적 지표

> v2.0.0 | 2026-04-06

---

## 1. Swing High / Swing Low

모든 ICT 분석의 기초. 구조적 고점/저점.

- **Swing High**: 양쪽 n개 봉보다 높은 고가 (lookback: 5)
- **Swing Low**: 양쪽 n개 봉보다 낮은 저가

```
판별 (인덱스 i):
  for j = 1 to lookback:
    if candles[i].high <= candles[i-j].high → NOT Swing High
    if candles[i].high <= candles[i+j].high → NOT Swing High
  → 모든 조건 통과 시 Swing High (Swing Low는 반대)
```

---

## 2. Market Structure Shift (MSS)

추세 전환 감지.

| 유형 | 선행 조건 | 돌파 조건 |
|-----|---------|---------|
| Bullish MSS | 최근 스윙 로우가 하이 이후 형성 | 종가 > 직전 스윙 하이 (이전 종가 <= ) |
| Bearish MSS | 최근 스윙 하이가 로우 이후 형성 | 종가 < 직전 스윙 로우 (이전 종가 >= ) |

사용: HTF(방향), MTF(구조 확인), LTF(추가 컨플루언스)

---

## 3. Order Block (OB)

기관 대량 주문 영역. 강한 지지/저항.

| 유형 | 패턴 | 강도 조건 | OB 영역 |
|-----|------|---------|--------|
| Bullish OB | 음봉→강한 양봉 | 0.2%+ 변동 | 음봉의 시가~종가 |
| Bearish OB | 양봉→강한 음봉 | 0.2%+ 변동 | 양봉의 시가~종가 |

탐색 범위: 최근 50봉 (orderBlockLookback)

---

## 4. Fair Value Gap (FVG) + CE + Fill

### FVG 정의
```
Bullish FVG:            Bearish FVG:
  봉1 [====]              봉1      [====]
        ← 갭                    ← 갭
  봉2 [============]      봉2 [============]
  봉3      [====]         봉3 [====]
```
- Bullish: 1번봉 고가 < 3번봉 저가
- Bearish: 1번봉 저가 > 3번봉 고가
- 최소 갭: 0.05%

### CE (Consequent Encroachment)
FVG의 정확히 50% 지점. 기관이 가장 많이 반응하는 가격대.
```
CE = (FVG top + FVG bottom) / 2
진입 허용 오차: 1% (fvgCeThreshold)
```

### FVG Fill
이후 캔들이 FVG를 얼마나 채웠는지 추적.
- 50% 이상 채워졌을 때 진입 근거로 사용
- 100% = 완전 메움 (더 이상 유효하지 않음)

---

## 5. IOFED (Institutional Order Flow Entry Drill)

기관이 한 방향으로 연속 주문 후 반전하는 패턴.

| 유형 | 조건 | 진입 영역 |
|-----|------|---------|
| Bullish | 3봉+ 연속 음봉 → 양봉 전환 | 마지막 음봉의 시가~종가 |
| Bearish | 3봉+ 연속 양봉 → 음봉 전환 | 마지막 양봉의 시가~종가 |

- 최소 연속 봉: 3개 (iofedMinBars)
- 최근 5봉 내의 IOFED만 유효

---

## 6. Liquidity Sweep

스윙 포인트 일시 돌파 후 복귀. "스탑 헌팅" 패턴.

| 유형 | 조건 |
|-----|------|
| Bullish | last.low < swingLow AND last.close > swingLow AND prev.close > swingLow |
| Bearish | last.high > swingHigh AND last.close < swingHigh AND prev.close < swingHigh |

최근 3개 스윙 포인트 검사.

---

## 7. OTE (Optimal Trade Entry)

피보나치 0.62~0.79 되돌림 구간. 보조 지표로 활용.
```
Bullish OTE: swingHigh - range × 0.62 ~ swingHigh - range × 0.79
Bearish OTE: swingLow + range × 0.62 ~ swingLow + range × 0.79
```
