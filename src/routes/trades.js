const router  = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const GateApi = require('gate-api');
const config  = require('../config');

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

function getClient() {
  const client = new GateApi.ApiClient();
  client.setApiKeySecret(config.apiKey, config.apiSecret);
  return new GateApi.FuturesApi(client);
}

function parseEntry(e, i, rate) {
  const profit       = Math.round((parseFloat(e.change) || 0) * rate);
  const text         = e.text || '';
  // Match contract name anywhere in text: "BTC_USDT", "BTC_USDT:close-long", etc.
  const contractMatch = text.match(/([A-Z]+)_USDT/);
  const coin         = contractMatch ? contractMatch[1] : 'UNKNOWN';
  const symbol       = `${coin}/USDT`;
  const isLong       = !text.toLowerCase().includes('short');
  const ts           = (e.time || 0) * 1000;
  return {
    id:               String(e.id || i),
    coin,
    symbol,
    direction:        isLong ? 'Long' : 'Short',
    type:             profit >= 0 ? 'close' : 'stop_loss',
    entryPrice:       0,
    exitPrice:        0,
    amount:           0,
    profit,
    profitRate:       0,
    entryAt:          new Date(ts).toISOString().slice(0, 16).replace('T', ' '),
    exitAt:           new Date(ts).toISOString().slice(0, 16).replace('T', ' '),
    holdingDays:      1,
    agentEntryReason: 'ICT 전략 신호 — HTF 추세 방향 + OTE 피보나치 구간 + FVG 진입.',
    agentExitReason:  profit >= 0 ? 'TP(익절) 지정가 주문 자동 체결' : 'SL(손절) 지정가 주문 자동 체결',
  };
}

// GET /trades
router.get('/', requireAuth, async (req, res) => {
  try {
    const futuresApi = getClient();
    const rate       = await getKrwRate();

    const { body: entries } = await futuresApi.listFuturesAccountBook('usdt', {
      type:  'pnl',
      limit: 100,
    });

    const trades = (entries || []).map((e, i) => parseEntry(e, i, rate));
    console.info(`[trades] Gate.io PnL 항목 ${trades.length}건 조회`);
    res.json(trades);
  } catch (err) {
    console.error('[trades] Gate.io 오류:', err.message, err.body || '');
    res.status(502).json({ message: `거래소 연결 오류: ${err.message}` });
  }
});

// GET /trades/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const futuresApi = getClient();
    const rate       = await getKrwRate();

    const { body: entries } = await futuresApi.listFuturesAccountBook('usdt', {
      type:  'pnl',
      limit: 200,
    });

    const trades = (entries || []).map((e, i) => parseEntry(e, i, rate));
    const trade  = trades.find((t) => t.id === req.params.id);
    if (!trade) return res.status(404).json({ message: '거래 내역을 찾을 수 없어요.' });
    res.json(trade);
  } catch (err) {
    console.error('[trades/:id] Gate.io 오류:', err.message, err.body || '');
    res.status(502).json({ message: `거래소 연결 오류: ${err.message}` });
  }
});

module.exports = router;
