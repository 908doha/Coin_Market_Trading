require('dotenv').config();

const config = {
  // Gate.io API
  apiKey: process.env.GATEIO_API_KEY || '',
  apiSecret: process.env.GATEIO_API_SECRET || '',

  // Trading
  //   TRADE_PAIRS: 콤마 구분 복수 지원 (예: "BTC_USDT,ETH_USDT,XAG_USDT")
  //   TRADE_PAIR: 하위 호환 (단일 페어)
  tradePairs: (process.env.TRADE_PAIRS || process.env.TRADE_PAIR || 'BTC_USDT')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  leverage: parseInt(process.env.LEVERAGE, 10) || 5,
  maxPositions: parseInt(process.env.MAX_POSITIONS, 10) || 3,

  // Risk Management
  stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 2,
  takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT) || 4,
  maxDailyLossUsdt: parseFloat(process.env.MAX_DAILY_LOSS_USDT) || 300,

  // Kelly Criterion (포지션 사이징 - 항상 적용, 페어별 독립 통계)
  //   f* = p - (1 - p) / R   (p: 승률, R: 평균손익비)
  //   multi-pair 운영 시 총 노출 상한으로 과다 레버리지 방지
  kelly: {
    fraction: parseFloat(process.env.KELLY_FRACTION) || 0.5,        // Half-Kelly
    maxFraction: parseFloat(process.env.KELLY_MAX_FRACTION) || 0.15, // 개별 포지션 상한 15% (Kelly 학습 후 과다 베팅 방지)
    minTrades: parseInt(process.env.KELLY_MIN_TRADES, 10) || 20,
    defaultFraction: parseFloat(process.env.KELLY_DEFAULT_FRACTION) || 0.03, // 표본 부족 폴백 3%
    maxTotalExposure: parseFloat(process.env.KELLY_MAX_TOTAL_EXPOSURE) || 0.6, // 전 페어 합산 leveraged notional 상한 60%
  },

  // Multi-Timeframe (HTF → MTF → LTF)
  timeframes: {
    htf: process.env.HTF_INTERVAL || '4h',   // 상위: 방향 판단
    mtf: process.env.MTF_INTERVAL || '15m',  // 중위: 구조 확인
    ltf: process.env.LTF_INTERVAL || '5m',   // 하위: 정밀 진입
  },

  // Telegram
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',

  // Bot
  cronSchedule: process.env.BOT_CRON_SCHEDULE || '*/1 * * * *',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Trading Sessions (Hybrid timezone) — 점심/between kill zones 제외
  //   - asian  : UTC 고정 (Tokyo 유동성 풀, DST 없음)
  //   - london : NY-local (ICT 정통, DST 자동)
  //   - ny     : NY-local + ICT Kill Zone (07:00-10:00 AM / 13:30-16:00 PM)
  //             NYSE 개장 시간이 아닌 ICT 정의를 사용 — crypto 24/7 거래에선
  //             NYSE 시간 자체는 무의미하고, ICT Kill Zone 이 유동성 phase 기준.
  sessions: {
    asian: {
      name: 'Asian',
      timezone: 'UTC',
      priority: 3, // overlap 시 NY/London 다음
      am:  { start: '00:00', end: '03:00' },  // 아시아 오전 (Tokyo open)
      pm:  { start: '04:00', end: '06:30' },  // 아시아 오후
      // 점심: 03:00 ~ 04:00 UTC (Tokyo 12:00~13:00 JST)
      full: { start: '00:00', end: '06:30' },
    },
    london: {
      name: 'London',
      timezone: 'America/New_York',
      priority: 2,
      am:  { start: '03:00', end: '06:30' },  // London AM (NY-local 03:00 = London 08:00 BST / 08:00 GMT)
      pm:  { start: '07:30', end: '10:00' },  // London PM
      // 점심: 06:30 ~ 07:30 NY-local (London 11:30~12:30)
      full: { start: '03:00', end: '10:00' },
    },
    ny: {
      name: 'New York',
      timezone: 'America/New_York',
      priority: 1, // NY Kill Zone 은 ICT 정통 host — overlap 시 우선
      am:  { start: '07:00', end: '10:00' },  // ICT AM Kill Zone
      pm:  { start: '13:30', end: '16:00' },  // ICT PM Kill Zone
      // between kill zones: 10:00 ~ 13:30 NY-local (low-liquidity 회피)
      full: { start: '07:00', end: '16:00' },
    },
  },

  // ICT Strategy Parameters
  ict: {
    swingLookback: 20,
    fvgMinGapPercent: 0.05,
    oteFibLow: 0.62,
    oteFibHigh: 0.79,
    orderBlockLookback: 50,
    structureShiftBars: 5,
    fvgCeThreshold: 0.0015,    // FVG CE 진입 허용 오차 (0.15%)
    fvgFillBasis: 'wick',      // 'wick' | 'close' — FVG fill 판정 기준 (wick=ICT 보수적, close=rejection 허용)
    iofedMinBars: 3,           // IOFED 최소 연속 봉 수
    iofedWindow: 10,           // detectIOFED 탐색 윈도우 (최근 N봉)
    iofedValidityBars: 5,      // _analyzeLTF: 최근 N봉 내 IOFED 만 유효 entry 근거
    htfPoiTolerance: 0.003,    // HTF OB/FVG 근접 허용 오차 (activeOBs/FVGs 판정, ±0.3%)
    maxRiskPct: 0.03,          // SL 최대 risk 상한 (진입가 대비, Pass 1-C-4a-1)
    weekendFlatten: {
      // 주말 전 포지션 강제 청산 (ICT 정통: 유동성 공백/갭 리스크 회피)
      //   1차 배포는 enabled:false 로 배포 안정화 확인 후 2차 배포에서 true 전환.
      enabled:       false,    // 기본 off — 안정화 후 활성화
      bufferMinutes: 5,        // NY PM 마감 N분 전 ~ 마감까지 강제 청산 (cron 1분 × 5회 여유)
      extendMinutes: 30,       // 마감 후 N분 연장 청산 기간 (미청산 포지션 재시도)
      fridayOnly:    true,     // true: 금요일만 (ICT 정통), false: Mon~Fri 매일 NY PM 마감 전
    },
  },
};

module.exports = config;
