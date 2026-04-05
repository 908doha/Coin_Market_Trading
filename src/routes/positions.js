const router  = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const gateClient = require('../api/gateClient');
const config  = require('../config');

// USDT → KRW
let krwRate = 1350, rateLoadedAt = 0;
async function getKrwRate() {
  if (Date.now() - rateLoadedAt < 60 * 60 * 1000) return krwRate;
  try {
    const res  = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    if (data?.rates?.KRW) { krwRate = data.rates.KRW; rateLoadedAt = Date.now(); }
  } catch {}
  return krwRate;
}

// Gate.io 포지션 → 프론트 Position 형태로 변환
async function buildPosition(position, rate) {
  const contract = config.tradePair; // e.g. "BTC_USDT"
  const symbol   = contract.replace('_USDT', '/USDT');
  const coin     = contract.split('_')[0]; // "BTC"

  const isLong      = position.size > 0;
  const entryPrice  = position.entryPrice;
  const markPrice   = position.markPrice;
  const slPercent   = 0.02;
  const tpPercent   = 0.04;
  const stopLoss    = isLong
    ? parseFloat((entryPrice * (1 - slPercent)).toFixed(2))
    : parseFloat((entryPrice * (1 + slPercent)).toFixed(2));
  const targetPrice = isLong
    ? parseFloat((entryPrice * (1 + tpPercent)).toFixed(2))
    : parseFloat((entryPrice * (1 - tpPercent)).toFixed(2));

  // USDT → KRW
  const amount       = Math.round(entryPrice * Math.abs(position.size) * rate / 1000) * 1000;
  const currentValue = Math.round(markPrice  * Math.abs(position.size) * rate / 1000) * 1000;
  const profit       = Math.round(position.unrealisedPnl * rate);
  const profitRate   = amount > 0 ? parseFloat(((profit / amount) * 100).toFixed(2)) : 0;

  return {
    id:            `${coin}-${isLong ? 'long' : 'short'}-${Date.now()}`,
    coin,
    symbol,
    direction:     isLong ? 'Long' : 'Short',
    entryPrice:    Math.round(entryPrice * rate),
    currentPrice:  Math.round(markPrice  * rate),
    amount,
    currentValue,
    profit,
    profitRate,
    weight:        100,
    entryAt:       new Date().toISOString().slice(0, 16).replace('T', ' '),
    targetPrice:   Math.round(targetPrice * rate),
    stopLoss:      Math.round(stopLoss    * rate),
    holdingPeriod: '진행 중',
    riskLevel:     2,
    agentReason:   'ICT 멀티 타임프레임 분석에 의해 진입한 포지션입니다. HTF 추세 방향에 맞는 신호가 감지됐습니다.',
    agentPlan:     `목표가 ${symbol} ${targetPrice.toLocaleString()} USDT 도달 시 익절. 손절가 ${stopLoss.toLocaleString()} USDT 이탈 시 손절.`,
  };
}

// GET /positions
router.get('/', requireAuth, async (req, res) => {
  try {
    const position = await gateClient.getPosition(config.tradePair);
    if (!position || position.size === 0) return res.json([]);

    const rate = await getKrwRate();
    const pos  = await buildPosition(position, rate);
    res.json([pos]);
  } catch (err) {
    res.status(502).json({ message: `거래소 연결 오류: ${err.message}` });
  }
});

// GET /positions/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const position = await gateClient.getPosition(config.tradePair);
    if (!position || position.size === 0) {
      return res.status(404).json({ message: '포지션을 찾을 수 없어요.' });
    }

    const rate = await getKrwRate();
    const pos  = await buildPosition(position, rate);
    res.json(pos);
  } catch (err) {
    res.status(502).json({ message: `거래소 연결 오류: ${err.message}` });
  }
});

module.exports = router;
