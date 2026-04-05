const router  = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const gateClient = require('../api/gateClient');
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

function formatDate(ts) {
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
}

// Gate.io 체결 내역 → 프론트 Trade 형태로 변환
function buildTrades(settlements, rate) {
  const coin   = config.tradePair.split('_')[0];
  const symbol = config.tradePair.replace('_USDT', '/USDT');

  return settlements.map((s) => {
    const isLong   = s.size > 0;
    const profit   = Math.round((s.pnl ?? 0) * rate);
    const amount   = Math.round(Math.abs(s.size) * (s.close ?? s.price ?? 0) * rate / 1000) * 1000;
    const profitRate = amount > 0 ? parseFloat(((profit / amount) * 100).toFixed(2)) : 0;

    return {
      id:               String(s.id ?? s.closeId ?? Math.random()),
      coin,
      symbol,
      direction:        isLong ? 'Long' : 'Short',
      type:             profit < 0 ? 'stop_loss' : 'close',
      entryPrice:       Math.round((s.entryPrice ?? 0) * rate),
      exitPrice:        Math.round((s.close       ?? s.price ?? 0) * rate),
      amount,
      profit,
      profitRate,
      entryAt:          formatDate((s.createTime ?? s.time ?? Date.now()) * 1000),
      exitAt:           formatDate((s.closeTime   ?? s.time ?? Date.now()) * 1000),
      holdingDays:      Math.max(1, Math.round(
        ((s.closeTime ?? 0) - (s.createTime ?? 0)) / 86400
      )),
      agentEntryReason: 'ICT 전략 신호 — HTF 추세 방향 + OTE 피보나치 구간 + FVG 진입.',
      agentExitReason:  profit >= 0
        ? 'TP(익절) 지정가 주문 자동 체결'
        : 'SL(손절) 지정가 주문 자동 체결',
    };
  });
}

// GET /trades
router.get('/', requireAuth, async (req, res) => {
  try {
    const settle = 'usdt';
    const GateApi = require('gate-api');
    const client  = new GateApi.ApiClient();
    client.setApiKeySecret(
      require('../config').apiKey,
      require('../config').apiSecret
    );
    const futuresApi = new GateApi.FuturesApi(client);

    const { body } = await futuresApi.listDeliverySettlements(settle, config.tradePair, {
      limit: 50,
    }).catch(() => ({ body: [] }));

    const rate   = await getKrwRate();
    const trades = buildTrades(body ?? [], rate);
    res.json(trades);
  } catch (err) {
    // API 실패 시 빈 배열
    res.json([]);
  }
});

// GET /trades/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const settle = 'usdt';
    const GateApi = require('gate-api');
    const client  = new GateApi.ApiClient();
    client.setApiKeySecret(
      require('../config').apiKey,
      require('../config').apiSecret
    );
    const futuresApi = new GateApi.FuturesApi(client);

    const { body } = await futuresApi.listDeliverySettlements(settle, config.tradePair, {
      limit: 100,
    }).catch(() => ({ body: [] }));

    const rate   = await getKrwRate();
    const trades = buildTrades(body ?? [], rate);
    const trade  = trades.find((t) => t.id === req.params.id);

    if (!trade) return res.status(404).json({ message: '거래 내역을 찾을 수 없어요.' });
    res.json(trade);
  } catch (err) {
    res.status(502).json({ message: `거래소 연결 오류: ${err.message}` });
  }
});

module.exports = router;
