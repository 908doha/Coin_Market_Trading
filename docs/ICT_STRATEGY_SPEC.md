# ICT (Inner Circle Trading) 전략 명세서

> 버전: 1.0.0  
> 작성일: 2026-04-05  
> 적용 봇: Gate.io 선물 자동매매 트레이딩 봇

---

## 1. ICT 전략 개요

ICT(Inner Circle Trading)는 기관 트레이더의 매매 행동 패턴을 분석하여 시장의 유동성 흐름과 가격 불균형을 포착하는 전략이다. 본 봇은 ICT의 핵심 개념 6가지를 멀티 타임프레임 분석과 결합하여 자동 매매에 적용한다.

### 1.1 핵심 개념 요약

| 개념 | 설명 | 역할 |
|------|------|------|
| Market Structure Shift (MSS) | 스윙 구조 돌파를 통한 추세 전환 감지 | 방향 전환 확인 |
| Order Block (OB) | 기관의 대량 매집/분배가 발생한 가격 영역 | 핵심 지지/저항 |
| Fair Value Gap (FVG) | 급격한 가격 변동으로 생긴 불균형 갭 | 되돌림 목표 |
| Optimal Trade Entry (OTE) | 피보나치 0.62~0.79 되돌림 구간 | 최적 진입 가격대 |
| Kill Zone | 기관 활동이 집중되는 세션 시간대 | 진입 타이밍 필터 |
| Liquidity Sweep | 스윙 포인트 일시 돌파 후 복귀 (스탑 헌팅) | 역전 진입 신호 |

---

## 2. 멀티 타임프레임 분석 구조

### 2.1 3단계 분석 흐름

```
┌─────────────────────────────────────────────┐
│  STEP 1: HTF (4h) - 방향 판단               │
│  "시장이 어느 방향으로 가고 있는가?"            │
│                                             │
│  ✓ Higher High + Higher Low → BULLISH       │
│  ✓ Lower High + Lower Low  → BEARISH       │
│  ✓ HTF MSS 감지 시 방향 전환 인정              │
│  ✗ 횡보 구간 → 진입 안 함                     │
└──────────────────┬──────────────────────────┘
                   │ 방향 확정
                   ▼
┌─────────────────────────────────────────────┐
│  STEP 2: MTF (1h) - 구조 확인               │
│  "HTF 방향과 같은 구조적 근거가 있는가?"        │
│                                             │
│  ✓ HTF 방향과 동일한 MSS 확인                 │
│  ✓ 같은 방향의 Order Block 존재               │
│  ✓ 같은 방향의 Fair Value Gap 존재            │
│  ✗ MSS도 없고 POI도 없으면 → 진입 안 함        │
└──────────────────┬──────────────────────────┘
                   │ 구조 확인됨
                   ▼
┌─────────────────────────────────────────────┐
│  STEP 3: LTF (15m) - 진입 타이밍             │
│  "지금이 최적의 진입 시점인가?"                 │
│                                             │
│  필수: Kill Zone 시간대 내                    │
│  + 아래 중 하나 이상 충족:                     │
│    ✓ OTE 구간 내 가격 위치                    │
│    ✓ Liquidity Sweep 감지                    │
│    ✓ LTF MSS 확인                            │
│    ✓ LTF FVG 내 가격 위치                     │
└──────────────────┬──────────────────────────┘
                   │ 진입 조건 충족
                   ▼
            ┌──────────────┐
            │   주문 실행    │
            └──────────────┘
```

### 2.2 타임프레임 설정

| 단계 | 기본값 | 환경변수 | 변경 가능 값 |
|------|--------|---------|------------|
| HTF (상위) | 4h | `HTF_INTERVAL` | 1d, 4h |
| MTF (중위) | 1h | `MTF_INTERVAL` | 4h, 1h, 30m |
| LTF (하위) | 15m | `LTF_INTERVAL` | 15m, 5m, 1m |

---

## 3. ICT 지표 상세 명세

### 3.1 Swing High / Swing Low (스윙 고점/저점)

모든 ICT 분석의 기초가 되는 구조적 포인트.

**정의:**
- **Swing High**: 양쪽으로 n개 봉보다 높은 고가를 가진 봉
- **Swing Low**: 양쪽으로 n개 봉보다 낮은 저가를 가진 봉

**파라미터:**
| 파라미터 | 값 | 설명 |
|---------|---|------|
| lookback | 5 (structureShiftBars) | 양쪽으로 비교할 봉 수 |

**알고리즘:**
```
Swing High 판별 (인덱스 i):
  for j = 1 to lookback:
    if candles[i].high <= candles[i-j].high → NOT Swing High
    if candles[i].high <= candles[i+j].high → NOT Swing High
  → 모든 조건 통과 시 Swing High

Swing Low 판별 (인덱스 i):
  for j = 1 to lookback:
    if candles[i].low >= candles[i-j].low → NOT Swing Low
    if candles[i].low >= candles[i+j].low → NOT Swing Low
  → 모든 조건 통과 시 Swing Low
```

**출력:**
```json
{ "index": 45, "price": 84500.00, "timestamp": 1712275200000 }
```

---

### 3.2 Market Structure Shift (MSS / 시장 구조 전환)

추세 전환을 감지하는 핵심 신호.

**정의:**
- **Bullish MSS**: 하락 구조에서 직전 스윙 하이를 종가 기준으로 상방 돌파
- **Bearish MSS**: 상승 구조에서 직전 스윙 로우를 종가 기준으로 하방 돌파

**판별 조건:**

| MSS 유형 | 선행 조건 | 돌파 조건 |
|---------|----------|---------|
| Bullish MSS | 최근 스윙 로우가 스윙 하이 이후 형성 (하락 구조) | 현재 종가 > 직전 스윙 하이 AND 이전 종가 <= 직전 스윙 하이 |
| Bearish MSS | 최근 스윙 하이가 스윙 로우 이후 형성 (상승 구조) | 현재 종가 < 직전 스윙 로우 AND 이전 종가 >= 직전 스윙 로우 |

**사용 위치:**
- HTF: 전체 방향 판단의 보조 신호
- MTF: HTF 방향과 동일한 구조 전환 확인
- LTF: 진입 타이밍의 추가 컨플루언스

---

### 3.3 Order Block (OB / 오더블록)

기관 트레이더의 대량 주문이 집중된 가격 영역. 강한 지지/저항으로 작용.

**정의:**
- **Bullish OB**: 강한 상승 반전이 시작되기 직전의 마지막 음봉 영역
- **Bearish OB**: 강한 하락 반전이 시작되기 직전의 마지막 양봉 영역

**탐색 조건:**

| OB 유형 | 패턴 | 강도 조건 |
|---------|------|---------|
| Bullish OB | 음봉(prev) → 강한 양봉(curr) | (curr.close - curr.open) / curr.open > 0.2% |
| Bearish OB | 양봉(prev) → 강한 음봉(curr) | (curr.open - curr.close) / curr.open > 0.2% |

**OB 영역 정의:**

| OB 유형 | 상단 (High) | 하단 (Low) |
|---------|------------|-----------|
| Bullish OB | 음봉의 시가 (Open) | 음봉의 종가 (Close) |
| Bearish OB | 양봉의 종가 (Close) | 양봉의 시가 (Open) |

**파라미터:**
| 파라미터 | 값 | 설명 |
|---------|---|------|
| orderBlockLookback | 50 | 최근 50봉 내에서 탐색 |
| 최소 변동률 | 0.2% | 반전 봉의 최소 몸통 크기 |

**사용 방식:**
- MTF: OB 존재 여부로 구조적 근거 확인
- SL 계산: OB 하단/상단을 손절 기준으로 사용

---

### 3.4 Fair Value Gap (FVG / 공정가치 갭)

급격한 가격 변동으로 발생하는 3봉 패턴의 가격 불균형 영역.

**정의:**
- **Bullish FVG**: 1번봉 고가 < 3번봉 저가 (상승 갭)
- **Bearish FVG**: 1번봉 저가 > 3번봉 고가 (하락 갭)

**판별 구조:**
```
Bullish FVG:
  봉1 [====]
              ← 갭 (봉1 고가 ~ 봉3 저가)
  봉2    [============]  (큰 상승봉)
              
  봉3          [====]

Bearish FVG:
  봉3 [====]
              ← 갭 (봉3 고가 ~ 봉1 저가)
  봉2    [============]  (큰 하락봉)
              
  봉1          [====]
```

**FVG 영역 정의:**

| FVG 유형 | 상단 (Top) | 하단 (Bottom) | 크기 계산 |
|---------|-----------|-------------|---------|
| Bullish FVG | 3번봉 저가 | 1번봉 고가 | (top - bottom) / 2번봉 종가 |
| Bearish FVG | 1번봉 저가 | 3번봉 고가 | (top - bottom) / 2번봉 종가 |

**파라미터:**
| 파라미터 | 값 | 설명 |
|---------|---|------|
| fvgMinGapPercent | 0.05% | 최소 갭 크기 (노이즈 필터링) |
| 탐색 범위 | 최근 50봉 | orderBlockLookback 공유 |

**사용 방식:**
- MTF: FVG 존재 여부로 POI(Point of Interest) 확인
- LTF: 현재가가 FVG 내에 있으면 진입 컨플루언스

---

### 3.5 Optimal Trade Entry (OTE / 최적 진입 구간)

피보나치 되돌림의 0.62~0.79 구간. ICT에서 가장 높은 확률의 진입 가격대.

**계산 공식:**
```
range = swingHigh - swingLow

Bullish OTE (매수 구간):
  upper = swingHigh - range × 0.62
  lower = swingHigh - range × 0.79
  mid   = swingHigh - range × 0.705

Bearish OTE (매도 구간):
  upper = swingLow + range × 0.79
  lower = swingLow + range × 0.62
  mid   = swingLow + range × 0.705
```

**예시 (BTC 기준):**
```
swingHigh = 85,000, swingLow = 82,000
range = 3,000

Bullish OTE:
  upper = 85,000 - 3,000 × 0.62 = 83,140
  lower = 85,000 - 3,000 × 0.79 = 82,630
  → 매수 최적 구간: 82,630 ~ 83,140

Bearish OTE:
  upper = 82,000 + 3,000 × 0.79 = 84,370
  lower = 82,000 + 3,000 × 0.62 = 83,860
  → 매도 최적 구간: 83,860 ~ 84,370
```

**파라미터:**
| 파라미터 | 값 | 설명 |
|---------|---|------|
| oteFibLow | 0.62 | OTE 하한 피보나치 레벨 |
| oteFibHigh | 0.79 | OTE 상한 피보나치 레벨 |

**사용 방식:**
- LTF에서 현재가가 OTE 구간 내에 있으면 진입 컨플루언스

---

### 3.6 Kill Zone (킬존 시간대)

기관 트레이더의 활동이 집중되는 특정 세션 시간대. ICT 전략에서 이 시간대 외에는 진입하지 않는다.

**Kill Zone 시간표 (UTC):**

| Kill Zone | UTC 시간 | KST 시간 | 특징 |
|-----------|---------|---------|------|
| Asian Open | 00:00 ~ 04:00 | 09:00 ~ 13:00 | 아시아 세션, 레인지 형성 |
| London Open | 07:00 ~ 10:00 | 16:00 ~ 19:00 | 런던 세션, 높은 변동성 |
| NY Open | 12:00 ~ 15:00 | 21:00 ~ 00:00 | 뉴욕 세션, 최대 변동성 |
| London Close | 15:00 ~ 17:00 | 00:00 ~ 02:00 | 런던 마감, 반전 빈번 |

**판별 로직:**
```
현재 UTC 시간을 분 단위로 변환
→ 각 Kill Zone의 시작/종료 시간과 비교
→ 어느 Kill Zone에도 속하지 않으면 진입 차단
```

**사용 방식:**
- LTF 분석의 필수 조건 (Kill Zone 외 시간에는 절대 진입 안 함)

---

### 3.7 Liquidity Sweep (유동성 스윕)

스윙 포인트 너머의 유동성(손절 주문)을 일시적으로 포착한 후 가격이 복귀하는 패턴. 소위 "스탑 헌팅" 후 반전.

**정의:**
- **Bullish Sweep**: 스윙 로우 아래로 꼬리(wick)를 찍고 종가가 다시 위로 복귀
- **Bearish Sweep**: 스윙 하이 위로 꼬리(wick)를 찍고 종가가 다시 아래로 복귀

**판별 조건:**

| Sweep 유형 | 조건 |
|-----------|------|
| Bullish Sweep | last.low < swingLow.price AND last.close > swingLow.price AND prev.close > swingLow.price |
| Bearish Sweep | last.high > swingHigh.price AND last.close < swingHigh.price AND prev.close < swingHigh.price |

**탐색 범위:** 최근 3개 스윙 포인트

**사용 방식:**
- LTF 진입 컨플루언스 (HTF 방향과 동일한 Sweep 감지 시)

---

## 4. 진입 조건 상세

### 4.1 Long (매수) 진입

모든 조건이 순차적으로 충족되어야 진입:

```
STEP 1 [HTF 4h] 다음 중 하나:
  ☐ Higher High + Higher Low (상승 구조)
  ☐ HTF Bullish MSS (구조 전환)

STEP 2 [MTF 1h] 다음 모두 충족:
  ☐ 구조 신호: Bullish MSS 또는 Bullish OB 존재
  ☐ POI 존재: Bullish OB 또는 Bullish FVG 존재

STEP 3 [LTF 15m] 필수 + 선택 조건:
  ☐ [필수] Kill Zone 시간대 내
  ☐ [1개 이상] 현재가가 Bullish OTE 구간 내
  ☐ [1개 이상] Bullish Liquidity Sweep 감지
  ☐ [1개 이상] LTF Bullish MSS 확인
  ☐ [1개 이상] 현재가가 LTF Bullish FVG 내
```

### 4.2 Short (매도) 진입

```
STEP 1 [HTF 4h] 다음 중 하나:
  ☐ Lower High + Lower Low (하락 구조)
  ☐ HTF Bearish MSS (구조 전환)

STEP 2 [MTF 1h] 다음 모두 충족:
  ☐ 구조 신호: Bearish MSS 또는 Bearish OB 존재
  ☐ POI 존재: Bearish OB 또는 Bearish FVG 존재

STEP 3 [LTF 15m] 필수 + 선택 조건:
  ☐ [필수] Kill Zone 시간대 내
  ☐ [1개 이상] 현재가가 Bearish OTE 구간 내
  ☐ [1개 이상] Bearish Liquidity Sweep 감지
  ☐ [1개 이상] LTF Bearish MSS 확인
  ☐ [1개 이상] 현재가가 LTF Bearish FVG 내
```

### 4.3 미진입 조건

| 조건 | 설명 |
|------|------|
| HTF 횡보 | HH/HL 또는 LH/LL 패턴 불명확 |
| Kill Zone 외 | UTC 기준 비활성 시간대 |
| MTF 구조 부족 | MSS도 OB도 FVG도 없음 |
| LTF 진입 조건 없음 | OTE, Sweep, MSS, FVG 어느 것도 미충족 |
| 기존 포지션 보유 | 중복 진입 방지 |
| 일일 손실 한도 도달 | 리스크 관리 |
| 잔고 부족 | 주문 가능 금액 미달 |
| 캔들 데이터 부족 | 50봉 미만 |

---

## 5. SL/TP 계산 명세

### 5.1 손절 (Stop Loss) 계산

**우선순위 기반 SL 결정:**

| 우선순위 | Long SL | Short SL |
|---------|---------|----------|
| 1순위 | MTF OB 하단 × (1 - SL% × 0.3) | MTF OB 상단 × (1 + SL% × 0.3) |
| 2순위 | LTF 최근 스윙 로우 × (1 - 0.1%) | LTF 최근 스윙 하이 × (1 + 0.1%) |
| 3순위 (폴백) | 진입가 × (1 - SL%) | 진입가 × (1 + SL%) |

### 5.2 익절 (Take Profit) 계산

```
리스크 = |진입가 - SL|
TP = 진입가 ± 리스크 × 3

R:R = 1:3 (고정)
```

### 5.3 SL/TP 예시

```
Long 진입 예시:
  진입가: 84,000
  MTF OB 하단: 83,500
  SL = 83,500 × (1 - 1% × 0.3) = 83,500 × 0.997 = 83,249.50
  리스크 = 84,000 - 83,249.50 = 750.50
  TP = 84,000 + 750.50 × 3 = 86,251.50

Short 진입 예시:
  진입가: 84,000
  MTF OB 상단: 84,600
  SL = 84,600 × (1 + 1% × 0.3) = 84,600 × 1.003 = 84,853.80
  리스크 = 84,853.80 - 84,000 = 853.80
  TP = 84,000 - 853.80 × 3 = 81,438.60
```

---

## 6. 컨플루언스 (Confluence) 시스템

신호 품질은 충족된 컨플루언스 수에 비례한다. 최소 진입 기준과 각 단계별 가능한 컨플루언스:

### 6.1 컨플루언스 목록

| 단계 | 컨플루언스 | 예시 |
|------|----------|------|
| HTF | 방향 바이어스 | `HTF(4h) BULLISH 바이어스` |
| MTF | MSS 확인 | `MTF(1h) bullish MSS 확인` |
| MTF | Order Block | `MTF OB [83200.00 - 83500.00]` |
| MTF | Fair Value Gap | `MTF FVG [83100.00 - 83400.00]` |
| LTF | Kill Zone | `Kill Zone: londonOpen` |
| LTF | Liquidity Sweep | `LTF(15m) bullish Liquidity Sweep @ 82800.00` |
| LTF | OTE 구간 | `LTF OTE [82630.00 - 83140.00]` |
| LTF | MSS | `LTF bullish MSS` |
| LTF | FVG | `LTF FVG [83050.00 - 83300.00]` |

### 6.2 최소 진입 기준

- HTF 바이어스: 1개 (필수)
- MTF 구조: 최소 1개 (필수)
- MTF POI: 최소 1개 (필수)
- LTF Kill Zone: 1개 (필수)
- LTF 진입 조건: 최소 1개 (필수)

**일반적인 진입 시 컨플루언스 수: 4~8개**

---

## 7. ICT 전략 파라미터 일람

| 파라미터 | 기본값 | 설명 | 조정 가이드 |
|---------|--------|------|-----------|
| `swingLookback` | 20 | 스윙 포인트 탐색 범위 | 높이면 더 큰 구조만 감지 |
| `structureShiftBars` | 5 | 스윙 판별 시 양쪽 비교 봉 수 | 높이면 노이즈 감소, 신호 감소 |
| `fvgMinGapPercent` | 0.05% | FVG 최소 갭 크기 | 높이면 큰 갭만 감지 |
| `oteFibLow` | 0.62 | OTE 하한 피보나치 | ICT 표준값, 변경 비권장 |
| `oteFibHigh` | 0.79 | OTE 상한 피보나치 | ICT 표준값, 변경 비권장 |
| `orderBlockLookback` | 50 | OB/FVG 탐색 범위 (봉 수) | 높이면 오래된 OB까지 포함 |
| Kill Zone 시간 | UTC 기반 4구간 | 진입 허용 시간대 | config에서 수정 가능 |

---

## 8. 전략 한계 및 주의사항

1. **Kill Zone 의존**: 하루 중 약 12시간만 진입 가능 (UTC 0-4, 7-10, 12-17)
2. **횡보장 취약**: HTF에서 방향이 불명확한 횡보 구간에서는 진입하지 않음
3. **단일 거래쌍**: 현재 1개 거래쌍만 분석 가능
4. **과거 데이터 기반**: 실시간 오더북/체결 데이터는 사용하지 않음
5. **OB 유효성**: 이미 가격이 지나간(mitigated) OB를 필터링하지 않음
6. **뉴스 이벤트**: 경제 지표 발표 등 이벤트성 변동은 고려하지 않음
