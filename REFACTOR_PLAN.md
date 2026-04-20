# ICT Strategy Refactor Plan

**대상 파일**: `bot/src/strategies/ictStrategy.js` (주) + `bot/src/utils/indicators.js` (참조)
**작성 근거**: 직전 턴의 코드 리뷰
**원칙**: 기존 구조 유지, 최소 침습 수정. 아키텍처 전면 리팩토링 금지.

**진행 상태**:
- [x] 1단계 — 이슈 인벤토리 (요약 테이블)
- [ ] 2단계 — Critical + High 상세 계획
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

## 2단계 — Critical + High 상세 계획 *(TODO)*

## 3단계 — Medium + Low 상세 계획 *(TODO)*
