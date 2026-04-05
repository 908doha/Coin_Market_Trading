const router     = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const gateClient = require('../api/gateClient');
const { getDb }  = require('../db');

// USDT → KRW (1시간 캐시)
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

async function getAgentDecision(contract) {
  try {
    const db  = await getDb();
    const row = await db.get(
      `SELECT * FROM agent_decisions WHERE contract = ? ORDER BY created_at DESC LIMIT 1`,
      contract
    );
    return row || null;
  } catch { return null; }
}

function fallbackReason(contract, isLong, entryPrice, markPrice) {
  const coin   = contract.replace('_USDT', '');
  const dir    = isLong ? '롱(매수)' : '숏(매도)';
  const pnlDir = isLong
    ? (markPrice >= entryPrice ? '현재 수익 구간' : '현재 손실 구간')
    : (markPrice <= entryPrice ? '현재 수익 구간' : '현재 손실 구간');
  return {
    reason: `AI 에이전트가 ${coin} ${dir} 포지션을 진입했습니다. ICT 멀티 타임프레임 분석으로 추세 방향을 확인 후 진입한 포지션이며 ${pnlDir}입니다.`,
    plan:   `진입가 대비 +4% 도달 시 익절, -2% 이탈 시 손절로 운용 중입니다.`,
  };
}

async function buildPosition(pos, rate) {
  const contract   = pos.contract;
  const coin       = contract.replace('_USDT', '');
  const symbol     = `${coin}/USDT`;
  // size can be number or string from Gate.io SDK
  const sizeNum    = Number(pos.size);
  const isLong     = sizeNum > 0;
  const entryPrice = parseFloat(pos.entryPrice)  || 0;
  const markPrice  = parseFloat(pos.markPrice)   || 0;
  const slPct      = 0.02;
  const tpPct      = 0.04;
  const stopLoss   = isLong
    ? parseFloat((entryPrice * (1 - slPct)).toFixed(2))
    : parseFloat((entryPrice * (1 + slPct)).toFixed(2));
  const targetPrice = isLong
    ? parseFloat((entryPrice * (1 + tpPct)).toFixed(2))
    : parseFloat((entryPrice * (1 - tpPct)).toFixed(2));

  const absSize    = Math.abs(sizeNum);
  const amount     = Math.round(entryPrice * absSize * rate / 1000) * 1000;
  const currentVal = Math.round(markPrice  * absSize * rate / 1000) * 1000;
  const profit     = Math.round((parseFloat(pos.unrealisedPnl) || 0) * rate);
  const profitRate = amount > 0 ? parseFloat(((profit / amount) * 100).toFixed(2)) : 0;

  const decision    = await getAgentDecision(contract);
  const agentReason = decision?.reason ?? fallbackReason(contract, isLong, entryPrice, markPrice).reason;
  const agentPlan   = decision?.plan   ?? fallbackReason(contract, isLong, entryPrice, markPrice).plan;

  return {
    id:            `${coin}-${isLong ? 'long' : 'short'}-${Date.now()}`,
    coin,
    symbol,
    contract,
    direction:     isLong ? 'Long' : 'Short',
    entryPrice:    Math.round(entryPrice  * rate),
    currentPrice:  Math.round(markPrice   * rate),
    amount,
    currentValue:  currentVal,
    profit,
    profitRate,
    weight:        100,
    entryAt:       decision?.created_at?.slice(0, 16).replace('T', ' ') ?? new Date().toISOString().slice(0, 16).replace('T', ' '),
    targetPrice:   Math.round(targetPrice * rate),
    stopLoss:      Math.round(stopLoss    * rate),
    holdingPeriod: '진행 중',
    riskLevel:     2,
    agentReason,
    agentPlan,
  };
}

// GET /positions
router.get('/', requireAuth, async (req, res) => {
  try {
    const rate = await getKrwRate();
    const { body: rawPositions } = await gateClient._futuresApi.listFuturesPositions('usdt');
    // Number() handles both string "0" and number 0
    const open = (rawPositions || []).filter((p) => Number(p.size) !== 0);
    if (!open.length) return res.json([]);
    const positions = await Promise.all(open.map((p) => buildPosition(p, rate)));
    res.json(positions);
  } catch (err) {
    console.error('[positions] Gate.io 오류:', err.message, err.body || '');
    res.status(502).json({ message: `거래소 연결 오류: ${err.message}` });
  }
});

// GET /positions/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const rate = await getKrwRate();
    const { body: rawPositions } = await gateClient._futuresApi.listFuturesPositions('usdt');
    const open = (rawPositions || []).filter((p) => Number(p.size) !== 0);
    if (!open.length) return res.status(404).json({ message: '포지션을 찾을 수 없어요.' });
    const coin = req.params.id.split('-')[0].toUpperCase();
    const raw  = open.find((p) => p.contract.startsWith(coin)) || open[0];
    const pos  = await buildPosition(raw, rate);
    res.json(pos);
  } catch (err) {
    console.error('[positions/:id] Gate.io 오류:', err.message, err.body || '');
    res.status(502).json({ message: `거래소 연결 오류: ${err.message}` });
  }
});

module.exports = router;
