# ICT 전략 시리즈 3: 진입 조건 & SL/TP 계산

> v2.0.0 | 2026-04-06

---

## 1. 3단계 멀티 타임프레임 진입

### STEP 1: HTF (4h) - 방향 판단

| 조건 | 방향 |
|------|------|
| Higher High + Higher Low | Bullish |
| Lower High + Lower Low | Bearish |
| HTF Bullish MSS | Bullish |
| HTF Bearish MSS | Bearish |
| PDL Sweep 반전 | Bullish |
| PDH Sweep 반전 | Bearish |
| 위 모두 해당 없음 | 진입 안 함 (횡보) |

### STEP 2: MTF (15m) - 구조 확인

두 조건 모두 충족 필요:
1. **구조 신호**: HTF 방향과 같은 MSS 또는 OB 존재
2. **POI 존재**: 같은 방향의 OB 또는 미메움 FVG 존재

### STEP 3: LTF (5m) - 정밀 진입

**필수 조건**: 활성 세션 내 (점심·주말 제외)

**진입 근거** (우선순위 순):

| 순위 | 근거 | 설명 | 정밀도 |
|-----|------|------|-------|
| 1 | FVG CE | FVG 50% 지점 도달 (허용 오차 1%) | 최고 |
| 2 | FVG Fill | FVG 50%+ 채워진 시점, 현재가 FVG 내 | 높음 |
| 3 | IOFED | 3봉+ 연속 후 반전 (최근 5봉 내) | 높음 |
| 4 | Liquidity Sweep | 스윙 포인트 Sweep 후 복귀 | 보통 |

---

## 2. 진입 예시

### Long 진입 시나리오
```
1. [4h] BTC HH+HL 상승 구조 확인
2. [15m] Bullish MSS 발생 + Bullish FVG 형성 (미메움)
3. [5m] London AM 세션 중
        가격이 15m FVG의 CE(50%)까지 되돌림
        → Long 진입!

   진입가: 83,300
   FVG CE: 83,280 (오차 0.02% → 허용)
   SL: MTF OB 하단 82,900 기준 → 82,650
   TP: 83,300 + (83,300 - 82,650) × 3 = 85,250
```

### Short 진입 시나리오
```
1. [4h] BTC LH+LL 하락 구조 + PDH Sweep
2. [15m] Bearish OB 형성 + Bearish FVG 존재
3. [5m] NY AM 세션 중
        4봉 연속 양봉 후 음봉 전환 (IOFED)
        → Short 진입!

   진입가: 84,500
   IOFED 진입 (4연속봉 반전)
   SL: MTF OB 상단 84,800 기준 → 85,050
   TP: 84,500 - (85,050 - 84,500) × 3 = 82,850
```

---

## 3. SL/TP 계산 상세

### 3.1 SL 우선순위 (Long)

| 순위 | 조건 | 계산 | 예시 (진입 84,000) |
|-----|------|------|------------------|
| 1 | MTF OB 있음 | OB 하단 × (1 - SL% × 0.3) | OB 83,500 → SL 83,249 |
| 2 | LTF 스윙 로우 | 스윙로우 × (1 - 0.1%) | SL 83,217 |
| 3 | PDL 있음 | PDL × (1 - 0.1%) | PDL 83,000 → SL 82,917 |
| 4 | 폴백 | 진입가 × (1 - SL%) | SL 83,160 |

### 3.2 SL 우선순위 (Short)

| 순위 | 조건 | 계산 | 예시 (진입 84,000) |
|-----|------|------|------------------|
| 1 | MTF OB 있음 | OB 상단 × (1 + SL% × 0.3) | OB 84,600 → SL 84,853 |
| 2 | LTF 스윙 하이 | 스윙하이 × (1 + 0.1%) | SL 84,584 |
| 3 | PDH 있음 | PDH × (1 + 0.1%) | PDH 85,000 → SL 85,085 |
| 4 | 폴백 | 진입가 × (1 + SL%) | SL 84,840 |

### 3.3 TP 계산
```
리스크 = |진입가 - SL|
TP = 진입가 ± 리스크 × 3

R:R = 1:3 고정
```

### 3.4 실제 손익 (100 USDT, 30 USDT 포지션, 10배 레버리지)
```
실효 포지션 = 30 × 10 = 300 USDT

SL 1% 도달 시: -3 USDT
TP 3% 도달 시: +9 USDT

→ 승률 30%만 돼도 수익 구조
```

### 3.5 SL/TP 실행 방식
- Gate.io **Price Trigger Order** (조건부 주문)으로 거래소에 등록
- autoSize 사용하여 포지션 전량 청산
- 시장가(IOC)로 청산하여 체결 보장
- **봇이 꺼져도 거래소에서 자동 작동**
- SL 체결 시 TP 자동 취소 (반대도 동일)
- 등록 실패 시 최대 3회 재시도

---

## 4. 리스크 관리

| 항목 | 설명 | 기본값 |
|------|------|--------|
| 일일 최대 손실 | 한도 도달 시 당일 매매 중단 | 10 USDT |
| 포지션 크기 | 잔고 일부만 사용 | 30 USDT |
| 단일 포지션 | 중복 진입 방지 | 1개 |
| 날짜 변경 시 | 일일 PnL 자동 초기화 | - |

---

## 5. 컨플루언스 목록

| 단계 | 컨플루언스 | 예시 |
|------|----------|------|
| 세션 | 활성 세션 | `세션: London AM` |
| HTF | 방향 바이어스 | `HTF(4h) BULLISH` |
| HTF | PDH/PDL Sweep | `PDL Sweep (82000)` |
| MTF | MSS | `MTF(15m) bullish MSS` |
| MTF | OB | `MTF OB [83200-83500]` |
| MTF | FVG + CE | `MTF FVG [83100-83400] CE:83250` |
| LTF | FVG CE 진입 | `LTF FVG CE @ 83300 (40% filled)` |
| LTF | FVG Fill | `LTF FVG Fill @ 55% [83100-83400]` |
| LTF | IOFED | `IOFED bullish (4연속봉 후 반전)` |
| LTF | Sweep | `LTF Sweep @ 82800` |
| LTF | Session Range | `London Range Sweep` |
| LTF | MSS | `LTF bullish MSS` |
