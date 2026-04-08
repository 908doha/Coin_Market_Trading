require('dotenv').config();

const config = {
  // Gate.io API
  apiKey: process.env.GATEIO_API_KEY || '',
  apiSecret: process.env.GATEIO_API_SECRET || '',

  // Trading
  tradePair: process.env.TRADE_PAIR || 'BTC_USDT',
  leverage: parseInt(process.env.LEVERAGE, 10) || 5,
  positionSizeUsdt: parseFloat(process.env.POSITION_SIZE_USDT) || 100,
  maxPositions: parseInt(process.env.MAX_POSITIONS, 10) || 3,

  // Risk Management
  stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 2,
  takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT) || 4,
  maxDailyLossUsdt: parseFloat(process.env.MAX_DAILY_LOSS_USDT) || 300,

  // Kelly Criterion (포지션 사이징)
  //   f* = p - (1 - p) / R   (p: 승률, R: 평균손익비)
  //   실제 사용 시 fractional Kelly 적용 + 상한 캡으로 변동성/추정오차 완충
  kelly: {
    enabled: (process.env.KELLY_ENABLED || 'true') === 'true',
    fraction: parseFloat(process.env.KELLY_FRACTION) || 0.5,        // Half-Kelly
    maxFraction: parseFloat(process.env.KELLY_MAX_FRACTION) || 0.25, // 잔고 대비 최대 25%
    minTrades: parseInt(process.env.KELLY_MIN_TRADES, 10) || 20,    // 학습 필요 최소 표본
    defaultFraction: parseFloat(process.env.KELLY_DEFAULT_FRACTION) || 0.02, // 표본 부족 시 폴백 (2%)
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

  // Trading Sessions (UTC) - 점심시간 제외
  sessions: {
    asian: {
      name: 'Asian',
      am:  { start: '00:00', end: '03:00' },  // 아시아 오전
      pm:  { start: '04:00', end: '06:30' },  // 아시아 오후
      // 점심: 03:00 ~ 04:00 UTC (KST 12:00~13:00)
      full: { start: '00:00', end: '06:30' },
    },
    london: {
      name: 'London',
      am:  { start: '07:00', end: '10:30' },  // 런던 오전
      pm:  { start: '11:30', end: '14:00' },  // 런던 오후
      // 점심: 10:30 ~ 11:30 UTC (런던 11:30~12:30)
      full: { start: '07:00', end: '14:00' },
    },
    ny: {
      name: 'New York',
      am:  { start: '13:30', end: '16:00' },  // NY 오전
      pm:  { start: '17:00', end: '19:30' },  // NY 오후
      // 점심: 16:00 ~ 17:00 UTC (NY 12:00~13:00)
      full: { start: '13:30', end: '19:30' },
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
    fvgCeThreshold: 0.01,     // FVG CE 진입 허용 오차 (1%)
    iofedMinBars: 3,           // IOFED 최소 연속 봉 수
  },
};

module.exports = config;
