# Phase 1 Quick Wins: ICT-01, RISK-01, RISK-02 (Critical×2 + High×1)

> **이 파일은 PR 초안입니다.** 확정 후 실제 PR 생성.

---

## 1. 요약

`REFACTOR_PLAN.md` Quick Wins 묶음 (#1-3) 착수. ICT 전략의 FVG CE 진입 정의 위반과 SL 안전망 우회 두 경로를 타이트닝.

| ID       | 심각도   | 카테고리        | 위치                                               | 한 줄 |
|----------|----------|-----------------|----------------------------------------------------|-------|
| ICT-01   | Critical | ICT 로직 정확성 | `bot/src/strategies/ictStrategy.js:500`            | FVG CE 진입에 `inRange` 검증 누락 — 외부 가격에서도 entry 발동 |
| RISK-01  | Critical | 리스크 관리     | `bot/src/strategies/ictStrategy.js:663, 700`       | 고정 % SL 폴백이 `maxRiskPct` 가드를 우회 |
| RISK-02  | High     | 리스크 관리     | `bot/src/strategies/ictStrategy.js:711-716`        | `risk=0` 폴백이 R:R 필터 우회 (`rr=2.5` 조용히 통과) |

설계 문서: [`REFACTOR_PLAN.md`](./REFACTOR_PLAN.md) (2단계 섹션 `ICT-01`, `RISK-01`, `RISK-02`).

---

## 2. 변경 사항 (커밋별)

| # | 커밋 | 역할 |
|---|------|------|
| 1 | `5ded9e4` `test: add node:test infrastructure` | `bot/package.json` test script + `bot/tests/smoke.test.js` 생성. 프로덕션 코드 0 변경. |
| 2 | `bce3f02` `test: add failing tests for ICT-01, RISK-01, RISK-02` | Layer A (블랙박스) + Layer B (화이트박스) 실패 테스트 일괄. 5 fail 확인. |
| 3 | `a6a3076` `fix(ict): ICT-01 require inRange for FVG CE entry` | `ictStrategy.js:500` 에 `&& fvg.inRange` 한 조건 추가. |
| 4 | `0190982` `fix(risk): RISK-02 return sl=null when risk<=0` | `ictStrategy.js:711-716` 의 "risk=0 시 폴백 SL/TP 반환" → `sl=null` 반환으로 변경. |
| 5 | `f1a672e` `fix(risk): RISK-01 enforce maxRiskPct on fallback SL` | `ictStrategy.js:663, 700` 폴백 블록에 `maxRiskPct` 가드 추가 + `analyze()` 에 `sl==null` skip 분기. |
| 6 | `d95df65` `test: fix common contract test to actually reach fallback path` | Layer A 공통 계약 테스트의 mock swing prices 를 `[50, 60]` 으로 조정 — 프로덕션 버그 아님, mock 설계 결함. |
| 7 | `f0e049e` `docs(phase1): backtest infra 사전 조사` | Step 5 사전 조사 — 백테스트 인프라 부재 확인, shadow deployment 계획 수립. |

커밋 #3~#5 가 프로덕션 코드 변경. 나머지는 test/docs.

---

## 3. 반환 계약 변경 (중요)

### 3.1 `_calculateSLTP` 반환 객체

| 필드 | 이전 | 이후 |
|------|------|------|
| `sl`  | `number` 항상 | `number \| null` — null 시 entry 차단 |
| `tp`  | `number` 항상 | `number \| null` — `sl=null` 과 동시 |
| `rr`  | `number` | `number` (null 경로에서는 `0`) |
| `tpSource` | `string` (기존 source labels) | 기존 + 신규 2종: `'risk-cap-violation'`, `'risk-zero'` |

### 3.2 `analyze()` 매핑 (신규)

```js
const { sl, tp, rr, tpSource } = this._calculateSLTP(...);
if (sl == null) {
  return { signal: null, reason: tpSource || 'SL calculation failed', confluence };
}
```

- `sl=null` → `signal=null`, `reason` 은 `tpSource` 를 그대로 (self-documenting).
- 외부 소비자 (`bot.js:260`, `bot.js:474`, `telegram.js:518, 666`) 는 이미 `signal: null` 처리 계약을 갖고 있어 외부 호환성 영향 없음.

### 3.3 Phase 6 재활용 예정

`STRUCT-03` (`_calculateSLTP` 200 줄 함수 direction-agnostic 리팩터) 에서 본 PR 의 `sl=null` 계약을 그대로 승계하여 사용. 따라서 본 PR 의 반환 스키마 변경을 **미리 안정화**하는 것이 Phase 6 머지 충돌 방지에 기여.

`tpSource` 의 신규 값 2종은 Phase 5 (`OBS-01` 구조화 로깅) 에서 event 필드로 분리 예정.

---

## 4. 현재 config 에서의 실제 영향 범위

리뷰어가 "이 수정이 실거래에 얼마나 영향을 주는가" 를 오해하지 않도록 **반드시 명시**.

### ICT-01 — **즉시 효과 발휘**
- `_analyzeLTF` 의 FVG CE 진입 경로가 실제 엣지 케이스를 제거. 배포 직후부터 FVG_CE entry 수 감소 예상.
- ICT 정통 정의 ("FVG 내부로 가격이 되돌아가서 CE 터치") 준수로 품질 향상 기대. 정량 추정은 근거 부족.

### RISK-01 — **현재 config 에서는 발동 불가**
- `.env.example` 기준: `STOP_LOSS_PERCENT=2` (2%) ≤ `config.ict.maxRiskPct=0.03` (3%).
- 폴백 SL 의 risk 는 항상 `slPct = 2%` → 가드 `3%` 이내 → **새 skip 경로 0 회 발동 예상**.
- **의도**: 미래 `STOP_LOSS_PERCENT` 를 3% 이상으로 조정하거나 `maxRiskPct` 를 축소할 때 발동하는 안전망.
- 배포 즉시 효과 없음. "why now" 는 **반환 계약 `sl=null` 을 Phase 6 리팩터 전에 미리 도입** 하기 위함.

### RISK-02 — **현재 config 에서는 발동 불가**
- `slPct=0` 은 `.env` 설정 실수 시에만 발생. 정상 운영 중엔 0 회.
- **의도**: silent 2.5:1 "가짜" 거래 경로 차단. 배포 실수 catch.

### 요약
- 관측 가능한 실거래 변화는 **ICT-01 단독**. RISK-01/02 는 defensive-only.
- 이를 숨기지 않는 이유: 리뷰어가 "이 PR 로 승률/MDD 얼마 개선되나?" 물을 때 잘못된 기대 차단.

---

## 5. 테스트 결과

```
9 tests / 9 pass / 0 fail
```

| # | Layer | 이슈 | 케이스 | 결과 |
|---|-------|------|--------|------|
| 1 | A | ICT-01 | (a) FVG 외부 + CE 근접 → entry 차단 | ✅ |
| 2 | A | ICT-01 | (b) FVG 내부 + CE 근접 → entry 정상 (회귀 방지) | ✅ |
| 3 | A | 공통 계약 | `sl=null` → `signal=null` (RISK-01 폴백 차단 경로로 트리거) | ✅ |
| 4 | B | RISK-01 | (a) 구조 후보 전부 탈락 + 폴백 초과 → `sl=null`, `tpSource='risk-cap-violation'` | ✅ |
| 5 | B | RISK-01 | (b) 구조 탈락했지만 폴백 이내 → 폴백 SL 사용 (회귀) | ✅ |
| 6 | B | RISK-01 | (c) 구조적 후보 존재 + 가드 이내 → 구조적 SL 선택 (회귀) | ✅ |
| 7 | B | RISK-02 | `slPct=0` → `sl=null`, `tpSource='risk-zero'` | ✅ |
| 8 | B | RISK-01 | (a-bearish) bearish 방향 대칭 검증 | ✅ |
| 9 | — | smoke | `node:test` 인프라 | ✅ |

실행: `cd bot && npm test`.

### 픽스처 설계 원칙
- **의도 기반 DSL** — `makeCandles(currentPrice)`, `makeIndicatorsMock({ fvg, swingsFarFromPrice })`.
- 매직 시나리오 이름 금지 — 각 테스트가 구체 값을 인라인 명시.
- `require.cache` 조작으로 config/logger/indicators mock — 프로덕션 코드 0 변경.

---

## 6. 검증 계획 — Shadow Deployment

`PHASE1_BACKTEST_INFRA.md` 참조. `bot/` 에 백테스트 인프라 부재 확인 → 2주 프로덕션 로그 모니터링.

### 수집 지표 (PM2 로그 grep)

| 지표 | 추출 패턴 (grep) | 기대값 |
|------|------------------|--------|
| FVG_CE entry 수 | `grep "FVG_CE"` | 배포 전 대비 감소 |
| `risk-cap-violation` 카운트 | `grep "폴백 SL risk"` | **0** (현재 config 기준) |
| `risk-zero` 카운트 | `grep "risk=0 감지"` | **0** (설정 실수 없을 시) |
| 전체 entry 빈도 | `grep "ICT v2"` (signal 출력 라인) | 배포 전 대비 소폭 감소 |
| Entry type 분포 | entryType 필드 집계 | FVG_CE 비율 ↓, 나머지 ↑ |

> **Note**: 대괄호 (`[SL]`, `[ICT v2]`) 는 grep 문자 클래스로 해석되어 이스케이프 필요하고, PM2 로그 프리픽스와도 충돌 가능. 고정 문자열 매칭이 실무적.

### 중단 조건 (즉시 롤백)

- 전체 entry 빈도 **-50% 이상** 감소 → 과도한 skip
- `risk-cap-violation` or `risk-zero` **≥ 1** 건 → 현재 config 예상과 불일치, 즉시 원인 조사
- FVG_CE entry **2주간 0 건** → `inRange` 과도 차단 가능성, indicators 측 계산 버그 점검

### 관찰 지표 (중단 조건 아님)

- **승률 변화**: P&L 집계 파이프라인 부재로 자동 중단 트리거 불가. 주간 수기 점검으로 추세 관찰만. Phase 5 `OBS-01` 이후 정량 지표로 승격 예정.

### 지표 추출 방식
- PM2 로그 파일 tail + grep (일회성).
- 대시보드/구조화 로깅은 **Phase 5 OBS-01** 이후 재평가. 본 PR 스코프 외.

---

## 7. 스코프 방어 / 후속 작업

### 건드리지 않은 이유
본 PR 은 "**반환 계약 `sl=null` 허용 + 3개 이슈 최소 수정**" 에만 집중. REFACTOR_PLAN.md 의 다른 이슈들은 의도적으로 미포함:

### 후속 Phase 맵

| Phase | 대상 이슈 | 의존 조건 |
|-------|-----------|-----------|
| **Phase 2** | `STATE-01` (setupKey 반환), `RISK-03` (일일/연속 손실 한도) | `bot.js` dedup + `orderManager.js` 손실 cap 선행 조사 |
| **Phase 3** | `ICT-02`, `ICT-03`, `ICT-05`, `STATE-03` (※ Phase 3 내부 실행 순서: `STATE-03` → `ICT-03` 선행, `REFACTOR_PLAN.md` 의존성 그래프 참조) | — |
| **Phase 4** | `RISK-04`/`STRUCT-02`/`RISK-06` (config 외부화), `RISK-05` (cap bonus 제외) | 한 커밋에 묶어 config 섹션 확장 |
| **Phase 5** | `STRUCT-01` (score 태그화), `STATE-02`/`STRUCT-04` (mutation/test seam), `ICT-06` (FVG 갭 상한), `ICT-04`+`PERF-01` (OB displacement + broken 판정 O(n)) | `STRUCT-01` 은 기계적이지만 전 push 지점 수정 |
| **Phase 6** | `STRUCT-03` (`_calculateSLTP` 분리) | `RISK-01/02/05` 반환 계약 선행 — 본 PR 이 그 첫 step |

---

## 8. 리뷰 포인트 (리뷰어 가이드)

### 특히 주의 깊게 봐주세요

1. **`_calculateSLTP` 의 2개 `sl=null` 반환 경로가 의미론적으로 중복되지 않는지**
   - `'risk-cap-violation'`: 폴백 SL 의 risk 가 `maxRiskPct` 초과
   - `'risk-zero'`: SL 이 entry 와 동일 (`risk=0`)
   - `tpSource` 로 분기되어 의미 구분되지만, 공통 헬퍼로 추출하는 것은 **의도적으로 보류**. Phase 6 `STRUCT-03` 에서 direction-agnostic 리팩터와 함께 처리.

2. **`analyze()` L107 직후 `sl==null` skip 이 기존 reason 필드 포맷과 호환되는지**
   - 기존 reason: 자유 문자열 (예: `"ICT v2 LONG - R:R 2.50 | 55/100 MODERATE"`, `"R:R 2.3 부족 (최소 2.5, 컨플루언스 5개)"`).
   - 신규 reason: `tpSource` 값 (`'risk-cap-violation'`, `'risk-zero'`).
   - 외부 소비자에 패턴 파싱 로직이 없어 호환 문제 없음 (Telegram 알림은 원문 표시).
   - Phase 5 OBS-01 에서 구조화 event 필드로 분리 예정.

3. **Layer A 공통 계약 테스트의 mock swing prices 설정**
   - 초기 구현 시 swingLows `[98, 99]` 로 했으나 `_slCandidateWithRisk` 가드를 통과해서 fallback 경로에 도달 못함.
   - `[50, 60]` 으로 이동하여 명시적으로 maxRiskPct 초과 유도.
   - 테스트 주석에 전체 계산 경로 기입 (`price/maxRiskPct/허용 범위`) — 커밋 `d95df65`.

### 구조적 회귀 방지 근거
- Layer B 테스트 RISK-01 (b), (c) 가 "기존 정상 경로" 를 고정.
- ICT-01 (b) 가 "FVG CE 정상 발동" 고정.
- 해피 패스에 회귀 발생 시 3개 테스트 중 하나 이상 실패.

---

## Phase 1 이후 첫 PR 체크리스트

- [x] REFACTOR_PLAN.md 명세에 따른 3건 수정
- [x] 테스트 인프라 신설 (`node:test`)
- [x] 유닛 테스트 9건 전 통과
- [x] 반환 계약 변경 명시
- [x] 현재 config 영향 범위 투명화
- [x] Shadow deployment 계획 수립 (`PHASE1_BACKTEST_INFRA.md`)
- [ ] 리뷰어 승인
- [ ] 머지
- [ ] 2주 모니터링 킥오프 (PM2 로그 baseline 캡처)

---

**Merge-ready 조건**: 리뷰 통과 + `npm test` CI 통과. 배포는 리뷰 merge 와 동시 (shadow deployment).
