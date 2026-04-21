# Phase 1 — 백테스트 인프라 사전 조사

**조사 목적**: Quick Wins PR (ICT-01 + RISK-02 + RISK-01) 의 Step 5 검증 방법 결정.
**조사 범위**: `bot/` 전체. `api/` (Vercel) 와 `frontend/` 는 본 PR 영향 범위 밖이라 제외.
**원칙**: 코드 수정 금지, 제안만.

---

## 1. 인프라 유무

**결론: No** (백테스트 인프라 없음, 페이퍼트레이딩 모드 없음, 테스트넷 스위치 없음).

---

## 2. 근거

### 2.1 키워드 grep — `bot/src/` 전체

| 키워드 | 매칭 수 |
|--------|---------|
| `backtest`, `replay`, `simulate`, `historical` | 0 |
| `paper`, `paper.?trad` | 0 |
| `dryRun`, `dry.run`, `dev.?mode` | 0 |
| `testnet`, `sandbox` | 0 |
| `mock`, `stub`, `fake` | 0 |
| `history`, `klines`, `ohlcv` | 0 (서비스 코드), `candlestick` 1 건 — 아래 2.3 참조 |

→ 백테스트 / 대체 실행 경로 관련 코드 **완전 부재**.

### 2.2 `package.json` scripts

```json
"scripts": {
  "start":       "node src/bot.js",
  "dev":         "node --watch src/bot.js",
  "test":        "node --test tests/**/*.test.js",
  "pm2:start":   "pm2 start ecosystem.config.js",
  "pm2:stop":    "pm2 stop ict-trading-bot",
  "pm2:restart": "pm2 restart ict-trading-bot",
  "pm2:logs":    "pm2 logs ict-trading-bot",
  "pm2:status":  "pm2 status"
}
```

백테스트/시뮬 관련 command 없음. `test` 는 본 PR 에서 추가한 유닛 테스트 러너.

### 2.3 Gate.io API 사용 방식

`bot/src/api/gateClient.js:34`:
```js
const { body } = await this.futuresApi.listFuturesCandlesticks(SETTLE, contract, opts);
```

- 실시간 Gate.io 라이브 API 호출만 존재.
- `gateClient.js:15-21` 생성자: `new GateApi.ApiClient() + setApiKeySecret(apiKey, apiSecret)` — basePath / baseUrl / host 오버라이드 **없음**. Gate.io 테스트넷 엔드포인트 스위치 부재.
- `listFuturesCandlesticks` 로 과거 캔들 조회는 가능하지만, **이를 소비하는 strategy.analyze()** 을 오프라인 재생하는 루프/툴이 존재하지 않음.

### 2.4 문서

- `bot/docs/SPEC.md` 라인 1-60: production 배포 (Oracle Cloud + PM2) 전용. 백테스트 섹션 없음.
- 그 외 `docs/` 3개 파일 (`ICT_STRATEGY_1/2/3_*.md`): 전략 설명 문서, 백테스트 언급 없음.
- 루트 `README.md`: 2줄짜리 스텁 ("Coin_Market_Trading" 만).

### 2.5 `.env.example`

프로덕션 환경변수만 존재 (`GATEIO_API_KEY/SECRET`, `TRADE_PAIRS`, `LEVERAGE`, `STOP_LOSS_PERCENT` 등). `DRY_RUN`, `TESTNET_URL`, `BACKTEST_MODE` 등 **없음**.

### 2.6 `orderManager.js`, `bot.js`

각각 919 / 634 줄. 헤더 및 주요 흐름 스캔 결과 dry-run 분기 부재. 주문은 항상 `futuresApi.createFuturesOrder` 등 라이브 API 호출.

---

## 3. 페이퍼트레이딩 대체 계획 제안

### 3.1 제안의 핵심 — "Shadow Deployment + Log Observability"

프로덕션 배포 후 로그 기반 모니터링. 인프라 추가 작업 **0**. 근거:
- Phase 1 변경은 모두 **기존 entry 를 제거하거나 skip 하는 방향** (새 entry 생성 없음).
- 따라서 실제 리스크는 "너무 많이 skip 해서 기회 손실" 만. "새로운 나쁜 entry" 는 원리적으로 발생 불가.
- 현재 로거(Winston) 가 이미 `logger.info/warn` 으로 skip 이유를 출력 중.

### 3.2 변경 안 건드리면 저절로 발동되는 관측 포인트

| 이슈 | 새 로그 라인 | 발동 조건 |
|------|-------------|-----------|
| ICT-01 | 기존 로그에는 기록 안 됨 — L114 confluence 변화 간접 관찰 | FVG 외부에서 CE 근접했던 케이스 소멸 |
| RISK-02 | `[SL/TP] risk=0 감지 — entry 차단 ...` | slPct=0 설정 시 (현재 .env.example: 2, 정상 운영 중엔 0 회 예상) |
| RISK-01 | `[SL] 폴백 SL risk X% > maxRiskPct Y% → entry 차단` | slPct > maxRiskPct 상태에서 구조 후보 전부 탈락 시 |

**현재 프로덕션 설정 확인** (`.env.example`):
- `STOP_LOSS_PERCENT=2` (slPct = 2%)
- `config.ict.maxRiskPct = 0.03` (3%)
- **2% ≤ 3% → RISK-01 가드는 원리적으로 발동 불가** (폴백 risk 가 항상 가드 이내).

즉 **RISK-01 은 현재 설정에선 동작 변화 없음** — 장기적으로 slPct 를 조정할 때 안전망 기능. Phase 1 배포 즉시 관측 가능한 효과는 주로 **ICT-01** 에 집중됨.

### 3.3 모니터링 기간 — 2주

근거:
- Phase 1 대상은 **entry 경로 1개 타이트닝 (ICT-01)** + **안전망 2개 (RISK-01/02)**.
- FVG_CE entry 발생 빈도가 일주에 수 회~수십 회 (심볼/타임프레임 추정) → 2주면 전/후 비교 가능 표본.
- 너무 길면 시장 체제 변화가 섞여 변경 효과와 교란.

### 3.4 수집 지표

Winston 로그에서 sed/awk 로 추출 가능 (PM2 로그 파일 경로: 기본 `~/.pm2/logs/`).

1. **FVG_CE entry 수**
   - 배포 전: `[ICT v2] LONG|SHORT ... FVG_CE` 매칭
   - 배포 후: 동일 패턴 — 감소량 = ICT-01 차단 효과.
2. **risk-cap-violation 카운트**
   - `[SL] 폴백 SL risk ... → entry 차단` 매칭.
   - 0 이어야 정상 (현재 config 상 원리적 0).
3. **risk-zero 카운트**
   - `[SL/TP] risk=0 감지` 매칭.
   - 0 이어야 정상.
4. **전체 entry 빈도**
   - `[ICT v2] (LONG|SHORT) .* - R:R` 매칭 (signal 출력 패턴).
   - 배포 전/후 심볼별 주당 건수 비교.
5. **entry type 분포**
   - entryType 필드 집계: FVG_CE / FVG_FILL / IOFED / BSL / SSL.
   - FVG_CE 비율 감소, 나머지 비율 상승이 자연스러운 결과.

### 3.5 중단 조건

다음 중 하나라도 관찰되면 배포 롤백:

| 조건 | 임계 | 판단 근거 |
|------|------|-----------|
| 전체 entry 빈도 감소 | > 50% | 과도한 skip → 전략 작동 불능 우려 |
| RISK-01/02 카운트 > 0 (현재 config 에선) | ≥ 1 | 예상 밖 경로 발동 — 원인 분석 필요 |
| FVG_CE entry 완전 소멸 | 2주 0 건 | ICT-01 가드가 inRange 를 과도하게 차단 — indicators 측 inRange 계산 버그 가능성 |
| 승률 급락 | P&L 기반 — 데이터 부족 시 보류 | 현재 실거래 통계 집계 파이프라인 존재 불확실 |

### 3.6 로그 구조 / 대시보드

**지금은 불필요**. 2주 모니터링 종료 시점에 PM2 로그 파일 tail 로 일회성 추출.
- 수동 확인: `pm2 logs ict-trading-bot | grep -c 'FVG_CE'` 같은 raw grep.
- 대시보드 필요성은 OBS-01 (Phase 5) 에서 구조화 로깅 도입 후 재평가. 지금은 스코프 외.

### 3.7 대안 — Gate.io 테스트넷 연동 (제안 수준, 구현 아님)

가능성: Gate.io 는 공식 테스트넷 존재 (`fx-api-testnet.gateio.ws`). `gateClient.js` 생성자에 baseUrl override 추가하면 연결 가능. 그러나:
- 테스트넷 유동성 낮음 → ICT 전략 시장 반응 재현성 낮음.
- 주문 집행 테스트용으로만 유용. entry 판정 로직 (본 Phase 1 의 핵심) 검증엔 부적절.
- 인프라 변경 필요 (env + gateClient 수정) → 본 PR 스코프 외.

### 3.8 대안 — 별도 백테스트 harness 신규 개발 (제안 수준, 구현 아님)

규모 감:
- Gate.io `listFuturesCandlesticks` 로 과거 N 개월 캔들 수집 → 파일 캐시.
- 루프에서 window 슬라이딩 + `strategy.analyze()` 호출 + (가상) 체결 → PnL 집계.
- 규모 추정: **1주 개발** (단일 심볼, 단일 타임프레임, 단순 체결 모델). 다중 심볼/슬리피지/수수료 반영하면 +1~2주.

→ 본 PR 스코프 외. Phase 6 STRUCT-03 (`_calculateSLTP` 분리) 이후 쌓인 테스트 가능한 유닛들과 함께 별도 이니셔티브로 검토 권장.

---

## 4. Phase 1 변경사항이 "검증 없이 배포 가능한" 근거

본 PR 의 3개 변경은 구조적으로 **극히 보수적**:

1. **ICT-01** — 기존 entry 에 `&& inRange` 추가. 조건이 더 엄격해짐 → 신호 감소 방향.
2. **RISK-02** — `slPct=0` 설정 실수를 catch. 정상 운영 중엔 0 회 발동.
3. **RISK-01** — `slPct > maxRiskPct` 인 비정상 설정에서만 발동. 현재 config (2% < 3%) 에선 발동 불가.

→ "새 entry 를 만들거나 SL/TP 값을 완화" 하는 방향의 변경이 **하나도 없음**. 체계적 수익 누수가 아닌 **안전망 + 정의 준수** 강화. 따라서 shadow deployment + 2주 로그 관측으로 충분히 검증 가능.

---

## 5. 부가 발견 (조사 중 인접 코드에서 눈에 띈 항목 — 별도 PR 스코프)

조사 중 관찰한 항목, **본 Phase 1 에서 건드리지 않음**. 필요 시 별도 이슈 기록.

- **(관측)** `.env.example` 의 `STOP_LOSS_PERCENT=2` 와 `config.ict.maxRiskPct=0.03` (3%) 이 **둘 다 런타임 수정 없이 고정** — Phase 4 (RISK-04, STRUCT-02) 에서 config 외부화 시 함께 검토.
- **(관측)** `bot/docs/SPEC.md` 버전 2.0.0 기준 Node 20 LTS 명시, 실제 Node 22 사용 중 — 호환성 경고 없음 (정보 차원).
- **(관측)** 3-4 에서 언급한 OBS-01 (로깅 비구조화) 이 여기서 그대로 관측됨: `pm2 logs | grep` 으로 메트릭 추출해야 하는 구조. Phase 5 이슈.

새로운 Critical/High 의심 지점은 **발견되지 않음**. 별도 `PHASE1_FINDINGS.md` 생성 불필요.

---

## 6. 판단 요청

다음 중 선택해주세요.

- **(A) Shadow deployment + 2주 로그 모니터링 (추천)**
  - 인프라 추가 0.
  - 현재 config (slPct=2%, maxRiskPct=3%) 기준 RISK-01/02 로그 0 건 예상 — ICT-01 효과만 측정됨.
  - 중단 조건 (§ 3.5) 만 사전 합의.
- **(B) Gate.io 테스트넷 연동 + 단기 실행**
  - `gateClient.js` baseUrl override + env 추가 필요 (별도 PR).
  - 유동성 낮아 전략 검증 가치 제한적.
- **(C) 백테스트 harness 신규 개발**
  - 1~3주 개발 투입.
  - Phase 6 이후 별도 이니셔티브로 분리 권장.

추천은 **(A)**. Phase 1 변경의 보수적 성격과 인프라 부재를 고려할 때 가장 비용효율적.
