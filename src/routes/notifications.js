const router  = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const db      = require('../db');

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
router.get('/settings', requireAuth, (req, res) => {
  let row = db.prepare('SELECT * FROM notification_settings WHERE user_id = ?').get(req.user.id);
  if (!row) {
    db.prepare(`INSERT OR IGNORE INTO notification_settings (user_id) VALUES (?)`).run(req.user.id);
    row = db.prepare('SELECT * FROM notification_settings WHERE user_id = ?').get(req.user.id);
  }
  res.json(rowToSettings(row));
});

// PATCH /notifications/settings
router.patch('/settings', requireAuth, (req, res) => {
  const fields = ['trade', 'bigProfit', 'bigLoss', 'weekly', 'deposit'];
  db.prepare(`INSERT OR IGNORE INTO notification_settings (user_id) VALUES (?)`).run(req.user.id);

  const colMap = { trade: 'trade', bigProfit: 'big_profit', bigLoss: 'big_loss', weekly: 'weekly', deposit: 'deposit' };
  for (const key of fields) {
    if (req.body[key] !== undefined) {
      db.prepare(`UPDATE notification_settings SET ${colMap[key]} = ? WHERE user_id = ?`)
        .run(req.body[key] ? 1 : 0, req.user.id);
    }
  }

  const row = db.prepare('SELECT * FROM notification_settings WHERE user_id = ?').get(req.user.id);
  res.json(rowToSettings(row));
});

module.exports = router;
