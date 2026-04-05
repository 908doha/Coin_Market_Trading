const router  = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db');

function rowToSettings(row) {
  return {
    trade:     !!row.trade,
    bigProfit: !!row.big_profit,
    bigLoss:   !!row.big_loss,
    weekly:    !!row.weekly,
    deposit:   !!row.deposit,
  };
}

// GET /notifications/settings
router.get('/settings', requireAuth, async (req, res) => {
  const db = await getDb();
  await db.run(`INSERT INTO notification_settings (user_id) VALUES (?) ON CONFLICT DO NOTHING`, req.user.id);
  const row = await db.get('SELECT * FROM notification_settings WHERE user_id = ?', req.user.id);
  res.json(rowToSettings(row));
});

// PATCH /notifications/settings
router.patch('/settings', requireAuth, async (req, res) => {
  const db     = await getDb();
  const colMap = { trade: 'trade', bigProfit: 'big_profit', bigLoss: 'big_loss', weekly: 'weekly', deposit: 'deposit' };
  await db.run(`INSERT INTO notification_settings (user_id) VALUES (?) ON CONFLICT DO NOTHING`, req.user.id);
  for (const [key, col] of Object.entries(colMap)) {
    if (req.body[key] !== undefined) {
      await db.run(`UPDATE notification_settings SET ${col} = ? WHERE user_id = ?`,
        req.body[key] ? 1 : 0, req.user.id);
    }
  }
  const row = await db.get('SELECT * FROM notification_settings WHERE user_id = ?', req.user.id);
  res.json(rowToSettings(row));
});

module.exports = router;
