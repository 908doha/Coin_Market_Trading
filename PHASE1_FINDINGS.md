# Phase 1 Findings — 스코프 외 발견 사항

> Phase 1 baseline 캡처 중 발견된 REFACTOR_PLAN.md 미등록 이슈.
> Phase 1 PR 에서는 건드리지 않음. Phase 2 이후 검토용.

## F-01 — TP 폴백이 무조건 `risk × fallbackRR` 로 통과

**심각도**: Medium (추정)
**카테고리**: 리스크 관리

**위치**:
- `bot/src/strategies/ictStrategy.js`
- main 브랜치: L766-767, L809-810
- PR 브랜치 (Phase 1 적용 후): L788-789, L831-832

**재현**:
- SL 은 구조적 후보로 정상 계산
- TP 후보가 모두 minRR(1.5) 미달 or `rr > maxRR(5.0)` 캡
- → `tp = price + risk * fallbackRR(2.5)` 강제 설정
- → tpSource = `fallback (risk×2.5)`

**Baseline 관측 (2026-04-21 15:53 ~ 19:01, 3.2h)**:
- 1건 발동 (BTC_USDT 00:06:01 LONG)
- 해당 주문은 실제 체결됨 (SL 주문 ID 확인됨)

**현재 방어선**:
- L115-124 "weak setup + fallback TP skip" 존재
- 단, confluence >= 5 면 통과
- 해당 BTC 건은 confluence 7 개였음 → 필터 우회

**연관 이슈**:
- REFACTOR_PLAN.md RISK-05 (maxRR 캡 보너스 과대) 와 개념적 연관
- RISK-04 (fallbackRR 매직넘버) 의 외부화 대상이지만 **차단 로직은 별도**

**Phase 1 영향**:
- 없음. 이 경로는 Phase 1 수정 대상 3건 (ICT-01/RISK-01/RISK-02) 중 어느 것도 건드리지 않음
- 배포 후에도 그대로 발동 가능

**권장**:
- Phase 4 (config 외부화) 에서 fallbackRR 외부화 + 폴백 TP 차단 옵션 추가 검토
- 또는 Phase 5 (관측성) 에서 `fallback` tpSource 카운트 알림 추가

## F-02 — REFACTOR_PLAN.md STRUCT-02 에 FRAGILE 등급 누락

**심각도**: Low (문서 불일치)
**카테고리**: 문서

**위치**: `bot/src/strategies/ictStrategy.js:919`
```js
else { grade = 'F'; label = 'FRAGILE'; }
```

**발견 경로**: Phase 1 첫 48시간 모니터링 중 로그에서 FRAGILE 등급 관측
**관측**: 2026-04-24 05:26~29 사이 3건 (BTC_USDT LONG)

**코드 상태**: 6개 등급 (ELITE/STRONG/SOLID/MODERATE/WEAK/FRAGILE)
**REFACTOR_PLAN.md STRUCT-02 명세**: 5개 (FRAGILE 누락)

**영향**: 없음. 코드 동작 정상.
**권장**: Phase 4 STRUCT-02 (매직넘버 config 외부화) 작업 시 등급 임계 배열에 FRAGILE 포함해서 6단계로 정리.
