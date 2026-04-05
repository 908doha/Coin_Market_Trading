const router  = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db');
const config  = require('../config');

// GET /agent/stats
router.get('/stats', requireAuth, async (req, res) => {
  const db       = await getDb();
  const settings = await db.get('SELECT * FROM agent_settings WHERE user_id = ?', req.user.id);
  res.json({
    status:         settings?.status    ?? 'running',
    lastTradeAt:    new Date().toISOString(),
    winRate30d:     0,
    totalTrades:    0,
    avgHoldingDays: 0,
    riskLevel:      settings?.risk_level ?? 'medium',
  });
});

// GET /agent/settings
router.get('/settings', requireAuth, async (req, res) => {
  const db  = await getDb();
  let row   = await db.get('SELECT * FROM agent_settings WHERE user_id = ?', req.user.id);
  if (!row) {
    await db.run(`INSERT OR IGNORE INTO agent_settings (user_id) VALUES (?)`, req.user.id);
    row = await db.get('SELECT * FROM agent_settings WHERE user_id = ?', req.user.id);
  }
  res.json({ status: row.status, riskLevel: row.risk_level });
});

// PATCH /agent/settings
router.patch('/settings', requireAuth, async (req, res) => {
  const { status, riskLevel } = req.body;
  const allowedStatus    = ['running', 'paused', 'waiting'];
  const allowedRiskLevel = ['low', 'medium', 'high'];
  if (status    && !allowedStatus.includes(status))        return res.status(400).json({ message: '올바르지 않은 상태입니다.' });
  if (riskLevel && !allowedRiskLevel.includes(riskLevel))  return res.status(400).json({ message: '올바르지 않은 리스크 수준입니다.' });
  const db = await getDb();
  await db.run(`INSERT OR IGNORE INTO agent_settings (user_id) VALUES (?)`, req.user.id);
  if (status)    await db.run('UPDATE agent_settings SET status = ? WHERE user_id = ?', status, req.user.id);
  if (riskLevel) await db.run('UPDATE agent_settings SET risk_level = ? WHERE user_id = ?', riskLevel, req.user.id);
  const row = await db.get('SELECT * FROM agent_settings WHERE user_id = ?', req.user.id);
  res.json({ status: row.status, riskLevel: row.risk_level });
});

module.exports = router;
