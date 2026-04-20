# ICT Strategy Refactor Plan

**대상 파일**: `bot/src/strategies/ictStrategy.js` (주) + `bot/src/utils/indicators.js` (참조)
**작성 근거**: 직전 턴의 코드 리뷰
**원칙**: 기존 구조 유지, 최소 침습 수정. 아키텍처 전면 리팩토링 금지.

**진행 상태**:
- [x] 1단계 — 이슈 인벤토리 (요약 테이블)
- [x] 2단계 — Critical + High 상세 계획
- [ ] 3단계 — Medium + Low 상세 계획

**리뷰 범위 한계**: 카테고리 4 (보안/비밀 관리) 는 본 리뷰 대상 파일 범위 밖. API 키/서명/rate limit 은 `bot/src/api/gateClient.js`, `bot/src/config/index.js` 별도 리뷰 필요.

---

## 1단계 — 이슈 인벤토리

### 카테고리 범례
1. ICT 로직 정확성  2. 리스크 관리  3. 상태/동시성
4. 보안/비밀 관리   5. 코드 구조    6. 성능        7. 관측성/로깅

### 심각도 기준
- **Critical** — 계좌 전손/큰 손실 직결
- **High** — 체계적 수익 누수, 로직 오류, 중요 예외 미처리
- **Medium** — 간헐적 손실, 운영 장애, 엣지 케이스
- **Low** — 품질/유지보수

### 요약 테이블

| ID       | 심각도   | 카테고리 | 위치 (파일:라인)                                                | 한 줄 설명 |
|----------|----------|----------|-----------------------------------------------------------------|------------|
| ICT-01   | Critical | 1        | `ictStrategy.js:497-506`                                        | FVG CE 진입 조건에 `inRange` 검증 누락 — 외부 가격에서도 entry 가능 |
| RISK-01  | Critical | 2        | `ictStrategy.js:661-666, 698-703`                               | 모든 구조적 SL 후보 탈락 시 고정 % 폴백이 `maxRiskPct` 가드를 우회 |
| ICT-02   | High     | 1        | `ictStrategy.js:251-262, 378-402`                               | OB/FVG 방향 필터에 거리 상한 없음 — 멀리 떨어진 stale POI 활성화 |
| ICT-03   | High     | 1        | `ictStrategy.js:508-518`                                        | FVG Fill 진입에 반전 캔들 검증 없음 (knife-catching) |
| RISK-02  | High     | 2        | `ictStrategy.js:711-716`                                        | `risk=0` 폴백이 `rr=fallbackRR(2.5)` 로 R:R 필터 우회 |
| RISK-03  | High     | 2        | `ictStrategy.js:analyze()` 전체                                 | 전략 레벨 일일/연속 손실 한도 없음 — orderManager 위임 검증 필요 |
| STATE-01 | High     | 3        | `ictStrategy.js:146-157` (반환)                                 | 신호 dedup 키 미반환 — 같은 setup 반복 발화 방지 위임 어려움 |
| STRUCT-01| High     | 5        | `ictStrategy.js:832-854`                                        | Setup score 룰이 confluence **한국어 문자열** regex 에 결합 |
| ICT-04   | Medium   | 1        | `indicators.js:146-192`                                         | OB 식별에 displacement/MSS 조건 없음 — false positive 과다 |
| ICT-05   | Medium   | 1        | `ictStrategy.js:520-535`                                        | IOFED 단독 entry 허용 (sweep/MSS 동반 요건 없음) |
| RISK-04  | Medium   | 2        | `ictStrategy.js:623-624`                                        | `maxRR=5.0`, `fallbackRR=2.5` 매직넘버 (config 외부화 안됨) |
| RISK-05  | Medium   | 2        | `ictStrategy.js:763, 806` + `877-885`                           | `maxRR` 캡 발동 시 R:R 보너스(+8)가 그대로 가산 — 점수 과대평가 |
| STATE-02 | Medium   | 3        | `ictStrategy.js:indicators 호출 전반`                            | `candles` 입력 mutation 방어 없음 — 멀티 계좌 공유 호출 시 잠재 오염 |
| STATE-03 | Medium   | 3        | `ictStrategy.js:41`                                             | 미완성 봉(live candle) close 사용 가능성 — tick 마다 신호 변동 |
| STRUCT-02| Medium   | 5        | `ictStrategy.js:114, 125, 130, 760, 803, 879-897`               | 컨플루언스 컷오프/minRR/점수 임계 매직넘버 산재 |
| STRUCT-03| Medium   | 5        | `ictStrategy.js:620-820`                                        | `_calculateSLTP` 200줄 단일 함수 — bullish/bearish 거울 분기 비대칭 위험 |
| PERF-01  | Medium   | 6        | `indicators.js:156-160, 178-181`                                | OB broken 판정 O(n²) — lookback 확대 시 비대화 |
| ICT-06   | Low      | 1        | `indicators.js:218-230, 272-290`                                | FVG 갭 상한(`fvgMaxGapPercent`) 없음 — 데이터 결손 시 거대 가짜 FVG |
| RISK-06  | Low      | 2        | `ictStrategy.js:599-606`                                        | SL `marginFactor = 0.001` 하드코딩 — 고변동성 알트 wick 청산 위험 |
| STRUCT-04| Low      | 5        | `ictStrategy.js:903` (module.exports)                           | 내부 헬퍼 (`_findFirstOverlap`, `_slCandidateWithRisk` 등) 테스트 seam 없음 |
| PERF-02  | Low      | 6        | `ictStrategy.js:729-752, 770-798`                               | TP 후보 매 tick 수집 + sort — 5분 tick 기준 무시 가능 수준 |
| PERF-03  | Low      | 6        | `ictStrategy.js:_analyzeHTF/_analyzeMTF/_analyzeLTF`            | indicators 계산이 timeframe 별 독립 — 중복 없음, 수익 미미한 메모이제이션 기회 |
| OBS-01   | Low      | 7        | `ictStrategy.js:115, 134, 144, 714, 815`                        | 로깅 포맷 비구조화 (평문 문자열) — 사후 분석 파싱 비용 |

**합계**: 23 이슈 (Critical 2, High 6, Medium 9, Low 6)

---

## 2단계 — Critical + High 상세 계획

> 임팩트 추정 근거: 본 프로젝트에는 백테스트 인프라/실거래 통계가 주어지지 않음. 정량 수치를 제시하지 않고, 시나리오 기반 질적 추정만 기재. 정량은 페이퍼/백테스트 결과로 확정 필요.

---

### ICT-01 [Critical / Cat1] FVG CE 진입 조건에 `inRange` 검증 누락

- **위치**: `bot/src/strategies/ictStrategy.js:497-506` (`_analyzeLTF` 내 FVG CE 블록)
- **재현 조건**:
  - LTF 에 `unfilled` bullish FVG 가 존재하고
  - `currentPrice` 가 FVG `top` 위에 있어 **이미 지나간 상태**인데
  - `|currentPrice − ce| / ce ≤ fvgCeThreshold (0.15%)` 조건을 우연히 만족
  - → `atCE=true` 로 LTF FVG CE entry 발동.
  - 작은 FVG (gap 0.3% 정도) 가 현재가 바로 아래에 있을 때 발생 빈도 높음.
- **예상 임팩트**:
  - FVG "되돌림 매수" 의 본질(가격이 FVG 내부로 회귀해서 CE 터치)을 충족하지 않은 entry.
  - 추세 방향 일치는 유지되므로 전손 위험은 낮지만 승률 저하.
  - 정량 추정 근거 부족. 빈도는 LTF 에서 작은 FVG 비율 × entry 시도 횟수에 비례.
- **수정안**:
  ```js
  // ictStrategy.js L499-506
  for (const fvg of unfilledFVGs) {
    if (fvg.atCE && fvg.inRange) {   // ★ inRange 추가
      confluence.push(`LTF FVG CE @ ${fvg.ce.toFixed(2)} (진입가 ${currentPrice.toFixed(2)})`);
      entryConfirmed = true;
      entryType = 'FVG_CE';
      break;
    }
  }
  ```
  - `fvg.inRange` 는 indicators.js L266/315 에서 이미 계산됨 (추가 비용 0).
- **의존성**: 없음 (독립 fix).
- **테스트 방법**:
  - 유닛 — 고정 candle 배열 2종 (현재가 > top / 현재가 ∈ [bottom, top]) 으로 `_analyzeLTF` 호출 → 전자는 FVG_CE entry 안 나오는지, 후자는 나오는지 검증.
  - 페이퍼트레이딩 — 변경 전후 entry 이유 분포 (`entryType` 카운트) 비교.

---

### RISK-01 [Critical / Cat2] 고정 % SL 폴백이 `maxRiskPct` 가드를 우회

- **위치**: `bot/src/strategies/ictStrategy.js:663, 700` (`_calculateSLTP` 폴백)
- **재현 조건**:
  - `config.stopLossPercent / 100 > config.ict.maxRiskPct` 설정 상태
  - 모든 구조적 SL 후보 (HTF OB / MTF OB / IOFED / LTF swing / PDH·PDL) 가 `maxRiskPct` 가드에서 탈락
  - → L663/700 `slCandidates.push(price * (1 ± slPct))` 실행
  - 이후 `sl >= price` sanity check 만 있고 `maxRiskPct` 재검증 없음.
  - 강한 추세로 근거리 구조물이 전부 멀리 떨어진 상황에서 가장 발생 쉽다.
- **예상 임팩트**:
  - 1회 손실이 의도된 `maxRiskPct` 의 `slPct / maxRiskPct` 배까지 확대.
  - 예: slPct=5%, maxRiskPct=1.5% 이면 3.3× 초과 손실.
  - 포지션 사이징이 `maxRiskPct` 기준으로 계산되는 경우 R 기반 가정이 깨져 누적 MDD 악화.
  - 전손 직결 여부는 bot.js / orderManager 의 레버리지 · 사이징 계산과 결합 필요 — 단독으로는 Critical/High 경계지만 **가드 우회 자체가 "안전망 실패"** 이므로 Critical 유지.
- **수정안**:
  ```js
  // L663 (bullish), L700 (bearish) 동일 패턴
  if (slCandidates.length === 0) {
    const fallback = direction === 'bullish' ? price * (1 - slPct) : price * (1 + slPct);
    const fallbackRisk = Math.abs(fallback - price) / price;
    if (fallbackRisk > maxRiskPct) {
      logger.warn(`[SL] 폴백 SL risk ${(fallbackRisk*100).toFixed(2)}% > maxRiskPct ${(maxRiskPct*100).toFixed(2)}% → entry 차단`);
      return { sl: null, tp: null, rr: 0, tpSource: 'risk-cap-violation' };
    }
    slCandidates.push(fallback);
  }
  ```
  - `analyze()` (L105) 호출 측에 `sl == null` 처리 추가:
  ```js
  const { sl, tp, rr, tpSource } = this._calculateSLTP(...);
  if (sl == null) return { signal: null, reason: 'SL risk cap violation', confluence };
  ```
- **의존성**: RISK-02 (risk=0 폴백) 와 반환 계약 통일 — 함께 수정하는 것이 일관성 ↑.
- **테스트 방법**:
  - 유닛 — slCandidates 가 비게 되는 상황 (structural 후보 전부 탈락) 재현 후 sl=null, analyze signal=null 확인.
  - 실설정 sanity — `config.stopLossPercent` 와 `config.ict.maxRiskPct` 비교 경고를 bot 기동 시 출력 (별도 이슈로 추출 가능).

---

### ICT-02 [High / Cat1] OB/FVG 방향 필터에 거리 상한 없음

- **위치**:
  - `ictStrategy.js:251-262` (`_analyzeHTF` — relevantOBs / relevantFVGs)
  - `ictStrategy.js:378-402` (`_analyzeMTF` — 동일 패턴)
- **재현 조건**:
  - 강한 추세 후반부, 진입가가 과거 OB/FVG 집합에서 멀리 떨어진 상황.
  - 필터는 `ob.low <= currentPrice` (bullish) 만 보므로 -5%, -10% 떨어진 stale OB 까지 `relevantOBs` 에 포함.
  - `activeOBs` 는 `htfPoiTolerance(0.3%)` 근접으로 걸러지지만, `relevantOBs`/`opposingOBs` 는 SL/TP 후보로 직접 사용됨.
- **예상 임팩트**:
  - SL 후보로 멀리 떨어진 OB 가 선택되면 `maxRiskPct` 가드에 탈락 → 폴백 빈도 ↑ (RISK-01 발동 경로 증가).
  - TP 후보로 먼 opposing OB 가 선택되면 `maxRR(5.0)` 캡 발동 잦아져 실질 타겟이 구조 아닌 risk 배수로 결정.
  - 승률 영향은 간접. 정량 추정 근거 부족.
- **수정안**:
  ```js
  // _analyzeHTF L251-262
  const rangeCap = config.ict.poiRangeCap ?? htfPoiTolerance * 20; // 기본 6%
  relevantOBs = rawOBs.filter((ob) => {
    if (direction === 'bullish') {
      return ob.low <= currentPrice && (currentPrice - ob.high) / currentPrice <= rangeCap;
    }
    return ob.high >= currentPrice && (ob.low - currentPrice) / currentPrice <= rangeCap;
  });
  // FVG 필터 동일 패턴 적용
  ```
  - `_analyzeMTF` L378-402 도 동일 `rangeCap` 적용.
  - `opposingOBs` / `opposingFVGs` 는 TP 타겟이므로 거리 상한 대신 **min RR 충족 여부**로 이미 필터됨 → 별도 처리 불필요.
- **의존성**: 없음. RISK-01 과 함께 적용 시 폴백 빈도 감소 효과 관측 용이.
- **테스트 방법**:
  - 유닛 — 현재가 대비 +10% 위치의 OB 가 `relevantOBs` 에서 제외되는지 확인.
  - 백테스트 — `activeOBs.length > 0` 컨플루언스 비율 변경 관찰 (의도치 않게 POI 가점이 사라지면 안됨).

---

### ICT-03 [High / Cat1] FVG Fill 진입에 반전 캔들 검증 없음 (knife-catching)

- **위치**: `ictStrategy.js:508-518` (`_analyzeLTF` FVG Fill 블록)
- **재현 조건**:
  - HTF bullish + LTF 에 unfilled bullish FVG
  - 가격이 FVG 내부로 내려오는 중 (현재 봉이 음봉)
  - `fvg.fillPercent ∈ [50, 100)` 만족 → entry 트리거
  - 실제로는 "FVG 를 깨러 가는 중" 일 수도 있는 상태.
- **예상 임팩트**:
  - 추세 반전 구간에서 역방향 entry → SL 체결 가능성 ↑.
  - 정량 추정 근거 부족. 빈도는 FVG 되돌림 시도 횟수에 비례.
  - ICT-01 과 달리 여기선 `inRange` 대신 **reaction 캔들** 검증이 필요 — 둘은 독립.
- **수정안**:
  ```js
  // L509-518
  if (!entryConfirmed) {
    const last = candles[candles.length - 1];
    const reaction = htfDirection === 'bullish'
      ? last.close > last.open
      : last.close < last.open;
    if (reaction) {
      for (const fvg of unfilledFVGs) {
        if (fvg.inRange && fvg.fillPercent >= 50 && fvg.fillPercent < 100) {
          confluence.push(`LTF FVG Fill @ ${fvg.fillPercent}% [${fvg.bottom.toFixed(2)}-${fvg.top.toFixed(2)}]`);
          entryConfirmed = true;
          entryType = 'FVG_FILL';
          break;
        }
      }
    }
  }
  ```
- **의존성**: STATE-03 (미완성 봉 처리) 와 상호작용 — 미완성 봉 close 로 reaction 판정하면 live tick 마다 결과 변동. STATE-03 선행 권장하나 필수는 아님 (reaction 조건이 추가되면 오히려 무분별한 entry 는 이미 감소).
- **테스트 방법**:
  - 유닛 — fill 50~100% 조건 + 마지막 봉 음봉 세팅 → entry=false 확인.
  - 백테스트 — FVG_FILL entry 수 감소 / 승률 비교.

---

### RISK-02 [High / Cat2] `risk=0` 폴백이 R:R 필터 우회

- **위치**: `ictStrategy.js:711-716`
- **재현 조건**:
  - `config.stopLossPercent=0` 설정 실수
  - 또는 구조적 SL 후보가 `price` 와 같은 값으로 반환되는 부동소수점 에지
  - → `fallbackRR=2.5` 로 즉시 반환 → `analyze()` L133 `rr < minRR` 필터 통과 (2.5 ≥ 2.5).
- **예상 임팩트**:
  - 설정 실수일 경우 SL/TP 가 fallback 값으로 동작해 **의도와 전혀 다른 거래**.
  - 현실적 빈도는 낮지만 silent 실패 → 배포 초기 발견 지연 위험.
- **수정안**:
  ```js
  // L711-716 교체
  if (risk <= 0) {
    logger.warn(`[SL/TP] risk=0 감지 — entry 차단 (slPct=${slPct}, price=${price}, sl=${sl})`);
    return { sl: null, tp: null, rr: 0, tpSource: 'risk-zero' };
  }
  ```
  - `analyze()` 에 RISK-01 과 동일한 `sl == null` → signal=null 처리 통합.
- **의존성**: RISK-01 과 반환 계약 통일 (`sl == null` → skip) — **동시 수정 권장**.
- **테스트 방법**:
  - 유닛 — `slPct=0` 으로 호출 시 signal=null 확인.

---

### RISK-03 [High / Cat2] 전략 레벨 일일/연속 손실 한도 없음

- **위치**: `ictStrategy.js:analyze()` 전체 — 전략은 한도를 모름.
- **재현 조건**:
  - orderManager 에 일일 손실 cap / 연속 손실 차단이 없거나 임계가 낮게 설정된 경우
  - 연속 손실 누적 중 신호 발생할 때마다 entry 지속.
- **예상 임팩트**:
  - 단일 시장 큰 추세 실패 시 누적 MDD 가 계좌 survival 범위를 넘을 수 있음.
  - **본 이슈는 "확인 선행" 이슈** — orderManager.js 와 bot.js 에 이미 구현되어 있다면 본 항목은 문서화만.
- **수정안**:
  1. **선행 조사**: `bot/src/services/orderManager.js` 와 `bot/src/bot.js` 에서
     - 일일 R-loss cap
     - 연속 패배 N회 차단
     - 계좌 drawdown cap
     이 구현되어 있는지 확인.
  2. 없으면 전략 레벨에 risk gate 주입:
     ```js
     // IctStrategy 생성자
     constructor({ riskGate } = {}) { this.riskGate = riskGate; ... }

     // analyze() 초입
     if (this.riskGate && !this.riskGate.canTrade()) {
       return { signal: null, reason: this.riskGate.lastReason };
     }
     ```
     `riskGate` 는 orderManager 쪽에 구현하여 주입.
- **의존성**: `orderManager.js` 선행 리뷰. 구현 현황에 따라 본 이슈가 "문서화"로 끝날 수도, "신규 개발" 로 확장될 수도 있음.
- **테스트 방법**:
  - 페이퍼트레이딩 — 연속 손실 시나리오 주입 후 entry 차단 확인.
  - 유닛 — riskGate mock 으로 `canTrade()` false 반환 시 signal=null 확인.

---

### STATE-01 [High / Cat3] 신호 dedup 키 미반환

- **위치**: `ictStrategy.js:146-157` (analyze 반환 객체)
- **재현 조건**:
  - 같은 LTF MSS break / FVG CE 상태가 여러 tick 에 걸쳐 유지
  - 매 tick `analyze()` 가 동일 신호 반환 → 호출자가 dedup 하지 않으면 중복 주문.
  - LTF MSS 는 stateful 이라 "오래된 break 도 계속 매칭" 된다고 코드 주석(L556-557) 에서도 인정.
- **예상 임팩트**:
  - bot.js 의 `activePositions` Map 이 심볼 기준 중복 차단을 이미 하고 있다면 실질 피해 없음.
  - 여러 방향 신호 (long → close → short) 를 짧은 시간 반복하는 경우는 별도 문제 — 중복 차단만으론 부족.
- **수정안**:
  ```js
  // L146-157
  return {
    signal,
    reason: ...,
    entry: currentPrice,
    sl: parseFloat(sl.toFixed(2)),
    tp: parseFloat(tp.toFixed(2)),
    rr,
    confluence,
    setupScore,
    hasHtfPoi,
    hasHtfSweep: !!htfBias.htfActiveSweep,
    // ★ dedup 키 — 호출자가 이전 tick 의 key 와 동일하면 skip
    setupKey: [
      signal,
      ltfEntry.entryType,
      Number.isFinite(mtfStructure.mssBreakIndex) ? mtfStructure.mssBreakIndex : 'na',
      sl.toFixed(2),
      tp.toFixed(2),
    ].join('|'),
  };
  ```
  - `mtfStructure` 가 breakIndex 를 노출하도록 `_analyzeMTF` 반환 추가 (현재는 내부 스코프).
- **의존성**: 호출자 (`bot.js` / `orderManager.js`) 의 dedup 로직 확인. 이미 있다면 `setupKey` 만 추가하면 됨. 없다면 별도 이슈 추가.
- **테스트 방법**:
  - 유닛 — 같은 candle 배열 2회 호출 시 `setupKey` 동일한지 확인.
  - 페이퍼트레이딩 — 동일 심볼 중복 entry 이벤트 로그 감소 확인.

---

### STRUCT-01 [High / Cat5] Setup score 룰이 confluence 한국어 문자열 regex 에 결합

- **위치**: `ictStrategy.js:832-854` (`_calculateSetupScore`)
- **재현 조건**:
  - confluence 메시지 문자열 수정 (예: "★ HTF OB 진입" → "★ HTF Order Block")
  - 런타임 에러 없이 silent 하게 점수 0 + 미매칭 경고만 발생 (L871).
  - 룰 regex 와 메시지가 한 사람 수정 시 둘 다 맞춰지지만, 리뷰에서 놓치기 쉬움.
- **예상 임팩트**:
  - 직접적 체결 영향 없음, 하지만 `setupScore` 가 왜곡되면 `minRR` 필터가 의도와 다르게 작동.
  - 리팩토링 중 은밀한 회귀 — 발견 지연 시 영향 누적.
- **수정안** (최소 침습):
  - confluence 배열을 문자열 그대로 유지하되, push 시점에 **태그 접두어**를 추가:
  ```js
  // 예: _analyzeHTF
  confluence.push(`[HTF_OB_ENTRY] ★ HTF OB 진입 [${ob.low.toFixed(2)}-${ob.high.toFixed(2)}]`);
  ```
  - `_calculateSetupScore` 룰을 태그 prefix 매칭으로 교체:
  ```js
  const rules = [
    { tag: 'SESSION',        points: 5,  label: 'Session' },
    { tag: 'HTF_DIRECTION',  points: 10, label: 'HTF Direction' },
    { tag: 'HTF_MSS',        points: 10, label: 'HTF MSS' },
    { tag: 'HTF_OB_ENTRY',   points: 15, label: 'HTF OB Entry' },
    ...
  ];
  for (const c of confluence) {
    const m = c.match(/^\[([A-Z_]+)\]/);
    const rule = m ? rules.find(r => r.tag === m[1]) : null;
    if (rule) { total += rule.points; breakdown.push({ text: c, points: rule.points }); }
    else      { logger.warn(`[setupScore] 미매칭: "${c}"`); breakdown.push({ text: c, points: 0, unmatched: true }); }
  }
  ```
  - UI/로그 표시에서는 `[TAG] ` 접두어를 strip 하는 단일 헬퍼 추가.
  - 기존 정규식 룰 완전 제거 (한국어 메시지 의존성 단절).
- **의존성**: 변경 범위가 `_analyzeHTF/_analyzeMTF/_analyzeLTF` 의 모든 `confluence.push` 호출 지점. 기계적 수정이지만 **회귀 테스트 필수**.
- **테스트 방법**:
  - 유닛 — 고정 candle 배열로 score 계산, 변경 전후 `score/breakdown` 스냅샷 동일성 비교.
  - 백테스트는 불필요 (의미론적 동작 동일해야 함).

---

## 3단계 — Medium + Low 상세 계획 *(TODO)*
