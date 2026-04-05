require('dotenv').config();

const express = require('express');
const cors    = require('cors');

const authRouter          = require('./routes/auth');
const accountRouter       = require('./routes/account');
const positionsRouter     = require('./routes/positions');
const tradesRouter        = require('./routes/trades');
const agentRouter         = require('./routes/agent');
const notificationsRouter = require('./routes/notifications');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── CORS ───────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',').map((u) => u.trim())
      : [];
    if (allowed.includes(origin) || allowed.includes('*')) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) return callback(null, true);
    callback(new Error(`CORS 차단: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json());

// ── 헬스 체크 ─────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── DB 진단 ───────────────────────────────────────────────────────
app.get('/debug/db', async (_, res) => {
  try {
    const { getDb } = require('./db');
    const db     = await getDb();
    await db.get('SELECT 1 AS ok');
    const tables = await db.all(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    res.json({ status: 'connected', tables: tables.map((t) => t.table_name) });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── Gate.io 진단 ──────────────────────────────────────────────────
app.get('/debug/gateio', async (_, res) => {
  const config = require('./config');
  const result = {
    keySet:    !!config.apiKey && config.apiKey.length > 0,
    secretSet: !!config.apiSecret && config.apiSecret.length > 0,
    keyPrefix: config.apiKey ? config.apiKey.slice(0, 6) + '...' : '(없음)',
    futures:   null,
    spot:      null,
    error:     null,
  };

  try {
    const GateApi = require('gate-api');
    const client  = new GateApi.ApiClient();
    client.setApiKeySecret(config.apiKey, config.apiSecret);
    const futuresApi = new GateApi.FuturesApi(client);
    const spotApi    = new GateApi.SpotApi(client);

    const [futRes, spotRes] = await Promise.allSettled([
      futuresApi.listFuturesAccounts('usdt'),
      spotApi.listSpotAccounts({ currency: 'USDT' }),
    ]);

    if (futRes.status === 'fulfilled') {
      const b = futRes.value.body;
      result.futures = { total: b.total, available: b.available, unrealisedPnl: b.unrealisedPnl };
    } else {
      result.futures = { error: futRes.reason?.message, body: futRes.reason?.body };
    }

    if (spotRes.status === 'fulfilled') {
      const accounts = spotRes.value.body;
      const usdt = Array.isArray(accounts) ? accounts.find((a) => a.currency === 'USDT') : null;
      result.spot = usdt
        ? { available: usdt.available, locked: usdt.locked }
        : { note: 'USDT 계좌 없음', raw: accounts?.slice(0, 3) };
    } else {
      result.spot = { error: spotRes.reason?.message };
    }
  } catch (err) {
    result.error = err.message;
  }

  res.json(result);
});

// ── 라우터 ────────────────────────────────────────────────────────
app.use('/auth',          authRouter);
app.use('/account',       accountRouter);
app.use('/positions',     positionsRouter);
app.use('/trades',        tradesRouter);
app.use('/agent',         agentRouter);
app.use('/notifications', notificationsRouter);

// ── 에러 핸들러 ───────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: '서버 오류가 발생했습니다.' });
});

app.listen(PORT, () => {
  console.log(`Osprey API 서버 실행 중 → http://localhost:${PORT}`);
});

module.exports = app;
