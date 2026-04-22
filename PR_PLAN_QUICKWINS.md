# Quick Wins PR #1-3 — 사전 조사

**대상**: ICT-01 (Critical) + RISK-02 (High) + RISK-01 (Critical) 묶음 PR
**단계**: 사전 조사만 — 코드 변경 전 방향 확정 대기

---

## 1. `_calculateSLTP` 호출부 전수 조사

### 정의
- **파일**: `bot/src/strategies/ictStrategy.js:620`
- **시그니처**: `_calculateSLTP(price, direction, mtfStructure, ltfEntry, htfBias)`
- **현재 반환 객체**: `{ sl: number, tp: number, rr: number, tpSource: string }`

### 호출 지점 — **단 1곳**

| # | 파일:라인 | 호출 맥락 | 반환값 사용 | `sl == null` 허용 시 필요 변경 |
|---|-----------|-----------|-------------|-------------------------------|
| 1 | `ictStrategy.js:105-107` | `analyze()` 내부 — STEP 1/2/3 통과 후 SL/TP 계산 | L113, L133-140, L143, L144, L148, L150-152 | 호출 직후 **조기 return** 삽입 |

`analyze()` 외부에서 `_calculateSLTP` 를 직접 호출하는 코드는 없음 (grep 확인). 따라서 반환 계약 변경의 파급은 `analyze()` 내부에 국한.

### `analyze()` 내 반환값 소비 지점 (L105 이후)

```
L113: isFallbackTp = /^fallback/.test(tpSource || '')          ← 문자열 연산, null-safe
L114-121: weak setup + fallback TP skip 분기                    ← tpSource 만 의존
L133-140: if (rr < minRR) { ...return } → R:R 필터             ← rr 사용. null 시 NaN 비교 문제
L143:   this._calculateSetupScore(confluence, rr)               ← rr 의존. null 시 NaN 가중
L144:   logger.info(... rr.toFixed(2) ...)                      ← rr=null 이면 TypeError
L148:   reason 문자열 — rr.toFixed(2)                           ← 동일
L150:   parseFloat(sl.toFixed(2))                               ← sl=null 이면 TypeError
L151:   parseFloat(tp.toFixed(2))                               ← tp=null 이면 TypeError
L152:   rr 반환                                                  ← 그대로 전달
```

**결론**: `sl == null` 이 L143~L152 까지 전파되면 여러 지점에서 TypeError 발생. 따라서 **L107 직후에 null 체크 + 조기 return** 이 최소 침습이며 안전.

### `analyze()` 반환의 외부 소비자 (null-signal 계약 확인)

`strategy.analyze()` 호출 지점:
- `bot.js:260-264` — `const signal = this.strategy.analyze({htf, mtf, ltf})` → `_tickPairForAccount(accId, acc, pair, signal)` 로 전달
- `bot.js:474` — telegram 수동 분석
- `telegram.js:518, 666` — `/analyze` 명령 핸들러

현재도 `analyze()` 는 이미 여러 경로에서 `{ signal: null, reason }` 반환 (L32/38/48/54/90/97/116/135). 소비자들이 `signal: null` 을 처리하는 계약이 **이미 존재** → 새로운 skip 경로 추가 시 외부 호환성 문제 없음.

### 테스트 인프라 현황

`bot/` 하위 디렉터리: `docs/`, `scripts/`, `src/`, `ecosystem.config.js`, `package*.json` — **테스트 디렉터리 없음**, `package.json` 에 test script 도 없음.

**의미**: 유닛 테스트를 작성하려면 테스트 프레임워크 (jest/vitest/node:test) 도입이 선행되어야 함. 이는 Quick Wins 범위를 넘어서는 결정이므로 **방향 확정 시 함께 논의 필요**.

---

## 2. RISK-01 수정 방향 원문 인용

REFACTOR_PLAN.md L99-134 의 "RISK-01" 섹션 중 **수정안 원문** (L113-130):

> ```js
> // L663 (bullish), L700 (bearish) 동일 패턴
> if (slCandidates.length === 0) {
>   const fallback = direction === 'bullish' ? price * (1 - slPct) : price * (1 + slPct);
>   const fallbackRisk = Math.abs(fallback - price) / price;
>   if (fallbackRisk > maxRiskPct) {
>     logger.warn(`[SL] 폴백 SL risk ${(fallbackRisk*100).toFixed(2)}% > maxRiskPct ${(maxRiskPct*100).toFixed(2)}% → entry 차단`);
>     return { sl: null, tp: null, rr: 0, tpSource: 'risk-cap-violation' };
>   }
>   slCandidates.push(fallback);
> }
> ```
> - `analyze()` (L105) 호출 측에 `sl == null` 처리 추가:
> ```js
> const { sl, tp, rr, tpSource } = this._calculateSLTP(...);
> if (sl == null) return { signal: null, reason: 'SL risk cap violation', confluence };
> ```

### 방향 해석

REFACTOR_PLAN 에 명시된 방향은 **(a) 도 (b) 도 아닌 혼합형**:

- **(a) 순수 폴백 제거**: 구조적 후보 탈락 시 즉시 `sl=null`
- **(b) 순수 가드만 추가**: 폴백 항상 사용하되 `maxRiskPct` 가드 통과 여부만 체크
- **(c) REFACTOR_PLAN 원안 = (b) + 실패 시 (a) 로 fallback**: 폴백을 **계산은 하되**, `maxRiskPct` 초과 시 `sl=null` 반환, 통과 시 폴백 사용

| 시나리오 | (a) 결과 | (b) 결과 | (c) 원안 결과 |
|----------|---------|---------|--------------|
| 구조 후보 전부 탈락, 폴백 risk `≤ maxRiskPct` | skip | 폴백 SL 사용 | **폴백 SL 사용** |
| 구조 후보 전부 탈락, 폴백 risk `> maxRiskPct` | skip | **maxRiskPct 초과 SL 사용** ← 위험 | skip |

→ **(c) 는 (b) 의 안전성 약점 + (a) 의 과도한 skip 을 둘 다 피하는 절충안**. (a) 대비 "폴백이 가드 안에 있으면 트레이드 기회 보존", (b) 대비 "가드 초과 시 진짜 skip".

---

## 3. 방향 선택 요청

다음 중 확정해주세요. **기본 추천은 (c) REFACTOR_PLAN 원안**.

- **(a) 폴백 제거** — 단순함 ↑, 트레이드 기회 ↓. `config.stopLossPercent` 가 사실상 무력화됨 (폴백이 없으므로).
- **(b) 가드만 추가** — 기존 폴백 동작 최대 보존, `maxRiskPct` 초과 케이스는 `maxRiskPct` 로 clamp 하는 방식이 될 것 (REFACTOR_PLAN 과 다름).
- **(c) 원안 (추천)** — 폴백 유지하되 가드 통과 시만 사용, 초과 시 skip. 명시된 방향.

### 부가 결정 사항 (방향 확정 시 함께)

1. **테스트 프레임워크 도입 여부** — `bot/package.json` 에 test script 없음, 디렉터리도 없음.
   - 도입 추천: `node:test` (의존성 0, Node 18+ 내장). 예: `bot/src/strategies/ictStrategy.test.js` + `npm test` → `node --test`.
   - 대안: 테스트 없이 수동 sanity + 백테스트로만 검증.

2. **`fallbackTp skip` 로직 (L113-121) 과의 충돌 확인**
   - 현재 `tpSource === 'fallback ...'` 여부로 weak setup skip 판정.
   - 새 tpSource `'risk-cap-violation'`, `'risk-zero'` 는 이미 `sl==null` 조기 return 으로 L113 에 도달하지 않음 → 충돌 없음.

3. **로그 레벨**
   - `risk-cap-violation`: `logger.warn` (설정 sanity 문제 가능성)
   - `risk-zero`: `logger.warn` (설정 실수 또는 데이터 이상)

---

## 4. 2단계 진행 시 예상 변경 범위 (참고)

방향 확정 후 착수할 코드 변경:

| 이슈 | 파일:라인 | 변경 요약 |
|------|-----------|-----------|
| ICT-01 | `ictStrategy.js:500` | `if (fvg.atCE)` → `if (fvg.atCE && fvg.inRange)` — 1 단어 추가 |
| RISK-02 | `ictStrategy.js:711-716` | `risk<=0` 시 `{ sl: null, tp: null, rr: 0, tpSource: 'risk-zero' }` 반환 |
| RISK-01 | `ictStrategy.js:663, 700` | (방향 (c) 기준) 폴백 계산 + `fallbackRisk > maxRiskPct` 시 null 반환 |
| 공통 | `ictStrategy.js:107 직후` | `if (sl == null) return { signal: null, reason: tpSource, confluence };` |

---

**상태**: 사전 조사 완료. 방향 (a)/(b)/(c) 확정 대기 중. 확정 전까지 코드 변경 없음.
