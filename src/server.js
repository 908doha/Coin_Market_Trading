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

// ── CORS ──────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // 오리진 없는 요청 (모바일앱, Postman 등) 허용
    if (!origin) return callback(null, true);

    // 환경변수로 허용 도메인 지정
    const allowed = process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',').map((u) => u.trim())
      : [];

    // 명시적으로 허용된 도메인
    if (allowed.includes(origin) || allowed.includes('*')) {
      return callback(null, true);
    }

    // Vercel 프리뷰 배포 전체 허용 (*.vercel.app)
    if (origin.endsWith('.vercel.app')) return callback(null, true);

    // localhost 개발환경 허용
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      return callback(null, true);
    }

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
