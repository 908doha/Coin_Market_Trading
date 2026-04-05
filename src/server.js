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

// ── 미들웨어 ──────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : '*',
  credentials: true,
}));
app.use(express.json());

// ── 헬스 체크 ─────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

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
