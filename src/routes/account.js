const router      = require('express').Router();
const { v4: uuid } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const gateClient  = require('../api/gateClient');
const db          = require('../db');

// USDT → KRW 환율 (실시간 or 캐시)
let krwRate    = 1350;
let rateLoadedAt = 0;

async function getKrwRate() {
  // 1시간 캐시
  if (Date.now() - rateLoadedAt < 60 * 60 * 1000) return krwRate;
  try {
    const res  = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    if (data?.rates?.KRW) {
      krwRate      = data.rates.KRW;
      rateLoadedAt = Date.now();
    }
  } catch { /* 실패 시 이전 값 유지 */ }
  return krwRate;
}

// ── 잔고 ─────────────────────────────────────────────────────────
// GET /account/balance
router.get('/balance', requireAuth, async (req, res) => {
  try {
    const rate    = await getKrwRate();
    const balance = await gateClient.getBalance();

    // 오늘 스냅샷 저장 (차트용)
    const today = new Date().toISOString().slice(0, 10);
    const totalKrw = Math.round(balance.total * rate);
    db.prepare(
      `INSERT OR REPLACE INTO chart_snapshots (id, user_id, date, value)
       VALUES (COALESCE((SELECT id FROM chart_snapshots WHERE user_id=? AND date=?), ?), ?, ?, ?)`
    ).run(req.user.id, today, uuid(), req.user.id, today, totalKrw);

    const invested    = Math.round((balance.total - balance.available) * rate);
    const unrealised  = Math.round(balance.unrealisedPnl * rate);

    res.json({
      total:          totalKrw,
      available:      Math.round(balance.available * rate),
      invested,
      profitTotal:    unrealised,
      profitRate:     balance.total > 0
                        ? parseFloat(((balance.unrealisedPnl / balance.total) * 100).toFixed(2))
                        : 0,
      profitToday:    unrealised,   // 일별 손익은 별도 추적 필요 — 임시로 미실현 손익 사용
      profitTodayRate: balance.total > 0
                        ? parseFloat(((balance.unrealisedPnl / balance.total) * 100).toFixed(2))
                        : 0,
    });
  } catch (err) {
    res.status(502).json({ message: `거래소 연결 오류: ${err.message}` });
  }
});

// ── 차트 ─────────────────────────────────────────────────────────
// GET /account/chart?period=1W|1M|3M|6M|1Y
router.get('/chart', requireAuth, (req, res) => {
  const periodDays = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };
  const days = periodDays[req.query.period] || 30;

  const rows = db.prepare(
    `SELECT date, value FROM chart_snapshots
     WHERE user_id = ? AND date >= date('now', ?)
     ORDER BY date ASC`
  ).all(req.user.id, `-${days} days`);

  res.json(rows.map((r) => ({ date: r.date, value: r.value })));
});

// ── 충전·출금 내역 ─────────────────────────────────────────────────
// GET /account/transactions
router.get('/transactions', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT * FROM fund_transactions WHERE user_id = ? ORDER BY requested_at DESC`
  ).all(req.user.id);

  res.json(rows.map((r) => ({
    id:          r.id,
    type:        r.type,
    amount:      r.amount,
    status:      r.status,
    requestedAt: r.requested_at,
    completedAt: r.completed_at ?? undefined,
  })));
});

// ── 충전 신청 ─────────────────────────────────────────────────────
// POST /account/deposit
router.post('/deposit', requireAuth, (req, res) => {
  const { amount, senderName } = req.body;
  if (!amount || amount <= 0)  return res.status(400).json({ message: '금액을 입력해주세요.' });
  if (!senderName)             return res.status(400).json({ message: '입금자명을 입력해주세요.' });
  if (amount < 10000)          return res.status(400).json({ message: '최소 충전 금액은 ₩10,000입니다.' });

  const id = uuid();
  db.prepare(
    `INSERT INTO fund_transactions (id, user_id, type, amount, sender_name)
     VALUES (?, ?, 'deposit', ?, ?)`
  ).run(id, req.user.id, amount, senderName);

  res.status(201).json({ message: '충전 신청이 접수됐습니다.' });
});

// ── 출금 신청 ─────────────────────────────────────────────────────
// POST /account/withdraw
router.post('/withdraw', requireAuth, async (req, res) => {
  const { amount, bank, account, holder } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ message: '금액을 입력해주세요.' });
  if (!bank)                  return res.status(400).json({ message: '은행을 선택해주세요.' });
  if (!account)               return res.status(400).json({ message: '계좌번호를 입력해주세요.' });
  if (!holder)                return res.status(400).json({ message: '예금주를 입력해주세요.' });

  // 출금 가능 잔고 확인
  try {
    const rate    = await getKrwRate();
    const balance = await gateClient.getBalance();
    const availableKrw = Math.round(balance.available * rate);
    if (amount > availableKrw) {
      return res.status(400).json({ message: '출금 가능 금액을 초과했습니다.' });
    }
  } catch {
    // API 실패 시 DB 처리만 진행
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO fund_transactions (id, user_id, type, amount, bank, account_number, account_holder)
     VALUES (?, ?, 'withdraw', ?, ?, ?, ?)`
  ).run(id, req.user.id, amount, bank, account, holder);

  res.status(201).json({ message: '출금 신청이 접수됐습니다.' });
});

module.exports = router;
