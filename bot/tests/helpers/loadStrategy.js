/**
 * Test helper — IctStrategy 를 격리된 config/logger 로 로드.
 *
 * 옵션 A (require.cache 조작) 방식:
 *  - 프로덕션 코드 0줄 변경.
 *  - 각 테스트에서 beforeEach 로 loadStrategy 호출 → stale cache 오염 방지.
 *
 * 사용:
 *   const { strategy, indicators, config } = loadStrategy({
 *     config: { stopLossPercent: 2, ict: { maxRiskPct: 0.03, ... } },
 *     indicatorsPatch: { getActiveSession: () => ({ active: true, name: 'NY', session: 'ny' }) },
 *   });
 */

const path = require('node:path');

const CONFIG_PATH     = require.resolve('../../src/config');
const LOGGER_PATH     = require.resolve('../../src/utils/logger');
const INDICATORS_PATH = require.resolve('../../src/utils/indicators');
const STRATEGY_PATH   = require.resolve('../../src/strategies/ictStrategy');

const RELOAD_TARGETS = [CONFIG_PATH, LOGGER_PATH, INDICATORS_PATH, STRATEGY_PATH];

const SILENT_LOGGER = {
  info:  () => {},
  warn:  () => {},
  error: () => {},
  debug: () => {},
};

/** require.cache 에 임의 exports 로 모듈을 injection */
function injectModule(modulePath, exports) {
  require.cache[modulePath] = {
    id:       modulePath,
    filename: modulePath,
    loaded:   true,
    exports,
  };
}

/** 기본 config — analyze() 내 config 참조가 모두 깨지지 않도록 최소 필드 채움 */
function defaultConfig(overrides = {}) {
  const base = {
    stopLossPercent:   2,
    takeProfitPercent: 4,
    timeframes:        { htf: '4h', mtf: '15m', ltf: '5m' },
    ict: {
      swingLookback:      20,
      fvgMinGapPercent:   0.05,
      oteFibLow:          0.62,
      oteFibHigh:         0.79,
      orderBlockLookback: 50,
      structureShiftBars: 5,
      fvgCeThreshold:     0.0015,
      fvgFillBasis:       'wick',
      iofedMinBars:       3,
      iofedWindow:        10,
      iofedValidityBars:  5,
      htfPoiTolerance:    0.003,
      maxRiskPct:         0.03,
    },
    sessions: {},
  };
  return {
    ...base,
    ...overrides,
    ict: { ...base.ict, ...(overrides.ict || {}) },
  };
}

/**
 * IctStrategy 인스턴스 + 로딩된 indicators/config 반환.
 * @param {object} opts
 * @param {object} [opts.config]           — defaultConfig 에 merge
 * @param {object} [opts.indicatorsPatch]  — require 후 indicators 객체에 Object.assign (getActiveSession mock 등)
 * @param {boolean}[opts.silenceLogger=true]
 */
function loadStrategy(opts = {}) {
  const { config: configOverride, indicatorsPatch, silenceLogger = true } = opts;

  for (const p of RELOAD_TARGETS) delete require.cache[p];

  injectModule(CONFIG_PATH, defaultConfig(configOverride));
  if (silenceLogger) injectModule(LOGGER_PATH, SILENT_LOGGER);

  const indicators = require(INDICATORS_PATH);
  if (indicatorsPatch) Object.assign(indicators, indicatorsPatch);

  const IctStrategy = require(STRATEGY_PATH);
  const strategy = new IctStrategy();
  const config = require(CONFIG_PATH);

  return { strategy, indicators, config, IctStrategy };
}

module.exports = { loadStrategy, defaultConfig, SILENT_LOGGER };
