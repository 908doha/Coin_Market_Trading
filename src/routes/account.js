const router      = require('express').Router();
const { v4: uuid } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const gateClient  = require('../api/gateClient');
const { getDb }   = require('../db');

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

// GET /account/balance
router.get('/balance', requireAuth, async (req, res) => {
  try {
    const rate    = await getKrwRate();
    const balance = await gateClient.getBalance();
    const totalKrw = Math.round(balance.total * rate);
    const today    = new Date().toISOString().slice(0, 10);
    const db = await getDb();
    const existing = await db.get(
      'SELECT id FROM chart_snapshots WHERE user_id = ? AND date = ?',
      req.user.id, today
    );
    if (existing) {
      await db.run('UPDATE chart_snapshots SET value = ? WHERE id = ?', totalKrw, existing.id);
    } else {
      await db.run(
        'INSERT INTO chart_snapshots (id, user_id, date, value) VALUES (?, ?, ?, ?)',
        uuid(), req.user.id, today, totalKrw
      );
    }
    const unrealised = Math.round(balance.unrealisedPnl * rate);
    res.json({
      total:           totalKrw,
      totalUsdt:       parseFloat(balance.total.toFixed(2)),
      available:       Math.round(balance.available * rate),
      invested:        Math.round((balance.total - balance.available) * rate),
      profitTotal:     unrealised,
      profitRate:      balance.total > 0 ? parseFloat(((balance.unrealisedPnl / balance.total) * 100).toFixed(2)) : 0,
      profitToday:     unrealised,
      profitTodayRate: balance.total > 0 ? parseFloat(((balance.unrealisedPnl / balance.total) * 100).toFixed(2)) : 0,
    });
  } catch (err) {
    res.status(502).json({ message: `거래소 연결 오류: ${err.message}` });
  }
});

// GET /account/chart?period=1W|1M|3M|6M|1Y
router.get('/chart', requireAuth, async (req, res) => {
  const periodDays = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };
  const days   = periodDays[req.query.period] || 30;
  // SQLite date('now', ?) 대신 JS에서 날짜 계산 후 문자열로 전달
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const db     = await getDb();
  const rows   = await db.all(
    `SELECT date, value FROM chart_snapshots WHERE user_id = ? AND date >= ? ORDER BY date ASC`,
    req.user.id, cutoff
  );
  res.json(rows.map((r) => ({ date: r.date, value: r.value })));
});

// GET /account/transactions
router.get('/transactions', requireAuth, async (req, res) => {
  const db   = await getDb();
  const rows = await db.all(
    `SELECT * FROM fund_transactions WHERE user_id = ? ORDER BY requested_at DESC`, req.user.id
  );
  res.json(rows.map((r) => ({
    id: r.id, type: r.type, amount: r.amount, status: r.status,
    requestedAt: r.requested_at, completedAt: r.completed_at ?? undefined,
  })));
});

// POST /account/deposit
router.post('/deposit', requireAuth, async (req, res) => {
  const { amount, senderName } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ message: '금액을 입력해주세요.' });
  if (!senderName)            return res.status(400).json({ message: '입금자명을 입력해주세요.' });
  if (amount < 10000)         return res.status(400).json({ message: '최소 충전 금액은 ₩10,000입니다.' });
  const db = await getDb();
  await db.run(
    `INSERT INTO fund_transactions (id, user_id, type, amount, sender_name) VALUES (?, ?, 'deposit', ?, ?)`,
    uuid(), req.user.id, amount, senderName
  );
  res.status(201).json({ message: '충전 신청이 접수됐습니다.' });
});

// POST /account/withdraw
router.post('/withdraw', requireAuth, async (req, res) => {
  const { amount, bank, account, holder } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ message: '금액을 입력해주세요.' });
  if (!bank)                  return res.status(400).json({ message: '은행을 선택해주세요.' });
  if (!account)               return res.status(400).json({ message: '계좌번호를 입력해주세요.' });
  if (!holder)                return res.status(400).json({ message: '예금주를 입력해주세요.' });
  const db = await getDb();
  await db.run(
    `INSERT INTO fund_transactions (id, user_id, type, amount, bank, account_number, account_holder) VALUES (?, ?, 'withdraw', ?, ?, ?, ?)`,
    uuid(), req.user.id, amount, bank, account, holder
  );
  res.status(201).json({ message: '출금 신청이 접수됐습니다.' });
});

module.exports = router;
