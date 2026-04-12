# ICT 전략 시리즈 2: 세션 시스템 & 유동성 레벨

> v3.0.0 | 2026-04-12 | ictStrategy.js 기준

---

## 1. 세션 시스템

### 1.1 세션 시간표 (UTC)

| 세션 | AM | 점심 (제외) | PM |
|------|-----|-----------|-----|
| **Asian** | 00:00~03:00 | 03:00~04:00 | 04:00~06:30 |
| **London** | 07:00~10:30 | 10:30~11:30 | 11:30~14:00 |
| **New York** | 13:30~16:00 | 16:00~17:00 | 17:00~19:30 |

### 1.2 KST 변환

| 세션 | KST AM | KST 점심 | KST PM |
|------|--------|---------|--------|
| Asian | 09:00~12:00 | 12:00~13:00 | 13:00~15:30 |
| London | 16:00~19:30 | 19:30~20:30 | 20:30~23:00 |
| New York | 22:30~01:00 | 01:00~02:00 | 02:00~04:30 |

### 1.3 규칙
- **점심시간 자동 제외**: 각 세션의 점심시간에는 진입하지 않음
- **주말 자동 제외**: 토요일/일요일(UTC)에는 진입하지 않음
- **세션 외 시간**: 신호가 있어도 자동 매매하지 않음
- **텔레그램 /analyze**: 세션 외에서도 분석 리포트는 조회 가능 (정보 표시용)

---

## 2. 유동성 레벨 맵

```
── PDH ──────────────────── (전일 고가) ─── Short TP / Bearish 방향 보강
── HTF Swing High ─────── (4h 구조적 고점) ─── BSL, Long TP 타겟
── MTF Swing High ─────── (15m 고점) ─── BSL
── Session High ──────── (세션 고가) ─── Session Range Sweep
                        
     현재가 *
                        
── Session Low ───────── (세션 저가) ─── Session Range Sweep
── MTF Swing Low ──────── (15m 저점) ─── SSL
── HTF Swing Low ──────── (4h 구조적 저점) ─── SSL, Short TP 타겟
── PDL ──────────────────── (전일 저가) ─── Long TP / Bullish 방향 보강
```

---

## 3. 유동성 레벨별 역할

### 3.1 TP 구조적 타겟 (가까운 순)

**Long TP 후보**:
1. HTF Swing High (opposing BSL)
2. PDH
3. MTF Opposing OB (bearish OB 하단)
4. HTF Opposing OB (bearish OB 하단)
5. HTF Opposing FVG (bearish FVG 하단)
6. 폴백: risk x 2.5

**Short TP 후보**:
1. HTF Swing Low (opposing SSL)
2. PDL
3. MTF Opposing OB (bullish OB 상단)
4. HTF Opposing OB (bullish OB 상단)
5. HTF Opposing FVG (bullish FVG 상단)
6. 폴백: risk x 2.5

### 3.2 SL 구조적 후보 (우선순위)

**Long SL**:
1. HTF OB 하단 (리스크 3% 이내)
2. MTF OB 하단
3. LTF Swing Low
4. PDL
5. 고정 비율 (config.stopLossPercent, 기본 2%)

**Short SL**:
1. HTF OB 상단 (리스크 3% 이내)
2. MTF OB 상단
3. LTF Swing High
4. PDH
5. 고정 비율

---

## 4. 멀티 페어 운영

### 4.1 지원 페어
```
TRADE_PAIRS=BTC_USDT,ETH_USDT,XAG_USDT,XAUT_USDT,XBR_USDT,XTI_USDT
```

봇 시작 시 Gate.io API로 각 페어 검증. 없는 심볼은 자동 제외.

### 4.2 동시 포지션 제한
- `MAX_POSITIONS`: 최대 동시 포지션 수 (기본 3)
- 한도 도달 시 새 진입 스킵, 기존 포지션 모니터링만

### 4.3 총 노출 상한
- `KELLY_MAX_TOTAL_EXPOSURE = 0.5`: 전 페어 합산 레버리지 노출이 잔고의 50% 이내
- 초과 시 해당 진입의 레버리지 노출을 남은 한도로 축소

---

## 5. 일일 손실 한도

| 항목 | 설명 | 기본값 |
|------|------|--------|
| `MAX_DAILY_LOSS_USDT` | 한도 도달 시 당일 모든 페어 매매 중단 | 10 USDT |
| 날짜 변경 | 일일 PnL 자동 초기화 (00:00 UTC) | - |
| 영구 저장 | `bot/data/kelly-stats.json`에 일일 PnL 저장, 봇 재시작해도 유지 | - |
