const router  = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const gateClient = require('../api/gateClient');
const config  = require('../config');
const db      = require('../db');

// GET /agent/stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    // Gate.io에서 실시간 포지션 상태 확인
    const position = await gateClient.getPosition(config.tradePair).catch(() => null);
    const settings = db.prepare('SELECT * FROM agent_settings WHERE user_id = ?').get(req.user.id);

    const status = settings?.status ?? 'running';

    res.json({
      status,
      lastTradeAt:    new Date().toISOString(),
      winRate30d:     0,   // TODO: 실제 체결 내역 집계
      totalTrades:    0,
      avgHoldingDays: 0,
      riskLevel:      settings?.risk_level ?? 'medium',
    });
  } catch (err) {
    res.status(502).json({ message: err.message });
  }
});

// GET /agent/settings
router.get('/settings', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM agent_settings WHERE user_id = ?').get(req.user.id);
  if (!row) {
    // 최초 조회 시 기본값 생성
    db.prepare(`INSERT OR IGNORE INTO agent_settings (user_id) VALUES (?)`).run(req.user.id);
    return res.json({ status: 'running', riskLevel: 'medium' });
  }
  res.json({ status: row.status, riskLevel: row.risk_level });
});

// PATCH /agent/settings
router.patch('/settings', requireAuth, (req, res) => {
  const { status, riskLevel } = req.body;

  const allowed = { status: ['running','paused','waiting'], riskLevel: ['low','medium','high'] };
  if (status    && !allowed.status.includes(status))    return res.status(400).json({ message: '올바르지 않은 상태입니다.' });
  if (riskLevel && !allowed.riskLevel.includes(riskLevel)) return res.status(400).json({ message: '올바르지 않은 리스크 수준입니다.' });

  db.prepare(`INSERT OR IGNORE INTO agent_settings (user_id) VALUES (?)`).run(req.user.id);

  if (status)    db.prepare('UPDATE agent_settings SET status = ? WHERE user_id = ?').run(status, req.user.id);
  if (riskLevel) db.prepare('UPDATE agent_settings SET risk_level = ? WHERE user_id = ?').run(riskLevel, req.user.id);

  const row = db.prepare('SELECT * FROM agent_settings WHERE user_id = ?').get(req.user.id);
  res.json({ status: row.status, riskLevel: row.risk_level });
});

module.exports = router;
