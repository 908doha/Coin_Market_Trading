const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { v4: uuid } = require('uuid');
const jwt     = require('jsonwebtoken');
const { getDb } = require('../db');
const { signAccess, signRefresh } = require('../middleware/auth');
const { sendVerificationCode } = require('../services/email');

const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'osprey-refresh-secret-change-me';

// POST /auth/send-code
router.post('/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: '이메일을 입력해주세요.' });
  const db = await getDb();
  await db.run(`UPDATE verification_codes SET used = 1 WHERE email = ? AND used = 0`, email);
  const code      = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.run(`INSERT INTO verification_codes (id, email, code, expires_at) VALUES (?, ?, ?, ?)`,
    uuid(), email, code, expiresAt);
  await sendVerificationCode(email, code);
  res.json({ message: '인증코드가 발송됐습니다.' });
});

// POST /auth/verify-code
router.post('/verify-code', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ message: '이메일과 코드를 입력해주세요.' });
  const db = await getDb();
  const record = await db.get(
    `SELECT * FROM verification_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1`,
    email, code);
  if (!record) return res.status(400).json({ message: '코드가 올바르지 않거나 만료됐습니다.' });
  await db.run(`UPDATE verification_codes SET used = 1 WHERE id = ?`, record.id);
  res.json({ message: '인증 완료' });
});

// POST /auth/signup
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
  if (password.length < 6) return res.status(400).json({ message: '비밀번호는 6자 이상이어야 합니다.' });
  const db = await getDb();
  const existing = await db.get('SELECT id FROM users WHERE email = ?', email);
  if (existing) return res.status(409).json({ message: '이미 사용 중인 이메일입니다.' });
  const hash = await bcrypt.hash(password, 10);
  const id   = uuid();
  const name = email.split('@')[0];
  await db.run(`INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)`, id, email, hash, name);
  await db.run(`INSERT OR IGNORE INTO notification_settings (user_id) VALUES (?)`, id);
  await db.run(`INSERT OR IGNORE INTO agent_settings (user_id) VALUES (?)`, id);
  const user    = { id, email, name, joinedAt: new Date().toISOString() };
  const access  = signAccess({ sub: id });
  const refresh = signRefresh({ sub: id });
  await db.run(`INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`,
    uuid(), id, refresh, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());
  res.status(201).json({ access, refresh, user });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
  const db  = await getDb();
  const row = await db.get('SELECT * FROM users WHERE email = ?', email);
  if (!row) return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않아요.' });
  const ok = await bcrypt.compare(password, row.password);
  if (!ok)  return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않아요.' });
  const user    = { id: row.id, email: row.email, name: row.name, joinedAt: row.created_at };
  const access  = signAccess({ sub: row.id });
  const refresh = signRefresh({ sub: row.id });
  await db.run(`INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`,
    uuid(), row.id, refresh, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());
  res.json({ access, refresh, user });
});

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  const { refresh } = req.body;
  if (!refresh) return res.status(400).json({ message: 'refresh token이 필요합니다.' });
  try {
    const payload = jwt.verify(refresh, REFRESH_SECRET);
    const db      = await getDb();
    const stored  = await db.get(
      `SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime('now')`, refresh);
    if (!stored) return res.status(401).json({ message: '만료된 refresh token입니다.' });
    res.json({ access: signAccess({ sub: payload.sub }) });
  } catch {
    return res.status(401).json({ message: '유효하지 않은 refresh token입니다.' });
  }
});

// POST /auth/logout
router.post('/logout', async (req, res) => {
  const { refresh } = req.body;
  if (refresh) {
    const db = await getDb();
    await db.run('DELETE FROM refresh_tokens WHERE token = ?', refresh);
  }
  res.json({ message: '로그아웃 완료' });
});

module.exports = router;
