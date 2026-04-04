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

  // Bot
  candleInterval: process.env.CANDLE_INTERVAL || '15m',
  cronSchedule: process.env.BOT_CRON_SCHEDULE || '*/1 * * * *',
  logLevel: process.env.LOG_LEVEL || 'info',

  // ICT Kill Zone times (UTC)
  killZones: {
    asianOpen:   { start: '00:00', end: '04:00' },
    londonOpen:  { start: '07:00', end: '10:00' },
    nyOpen:      { start: '12:00', end: '15:00' },
    londonClose: { start: '15:00', end: '17:00' },
  },

  // ICT Strategy Parameters
  ict: {
    swingLookback: 20,         // 스윙 하이/로우 탐색 범위
    fvgMinGapPercent: 0.05,    // FVG 최소 갭 비율 (%)
    oteFibLow: 0.62,           // OTE 피보나치 하단
    oteFibHigh: 0.79,          // OTE 피보나치 상단
    orderBlockLookback: 50,    // 오더블록 탐색 범위
    structureShiftBars: 5,     // MSS 확인 봉 수
  },
};

module.exports = config;
