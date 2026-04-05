const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { v4: uuid } = require('uuid');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { signAccess, signRefresh } = require('../middleware/auth');

const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'osprey-refresh-secret-change-me';

// ── 인증 코드 발송 ─────────────────────────────────────────────────
// POST /auth/send-code
router.post('/send-code', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: '이메일을 입력해주세요.' });

  // 기존 미사용 코드 만료 처리
  db.prepare(`UPDATE verification_codes SET used = 1 WHERE email = ? AND used = 0`).run(email);

  // 6자리 코드 생성
  const code      = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10분

  db.prepare(
    `INSERT INTO verification_codes (id, email, code, expires_at) VALUES (?, ?, ?, ?)`
  ).run(uuid(), email, code, expiresAt);

  // TODO: 실제 이메일 발송 (nodemailer 등)
  // 개발 단계에서는 로그로 확인
  console.log(`[인증코드] ${email} → ${code}`);

  res.json({ message: '인증코드가 발송됐습니다.' });
});

// ── 인증 코드 검증 ─────────────────────────────────────────────────
// POST /auth/verify-code
router.post('/verify-code', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ message: '이메일과 코드를 입력해주세요.' });

  const record = db.prepare(
    `SELECT * FROM verification_codes
     WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
     ORDER BY created_at DESC LIMIT 1`
  ).get(email, code);

  if (!record) return res.status(400).json({ message: '코드가 올바르지 않거나 만료됐습니다.' });

  db.prepare(`UPDATE verification_codes SET used = 1 WHERE id = ?`).run(record.id);

  res.json({ message: '인증 완료' });
});

// ── 회원가입 ──────────────────────────────────────────────────────
// POST /auth/signup
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
  if (password.length < 6) return res.status(400).json({ message: '비밀번호는 6자 이상이어야 합니다.' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ message: '이미 사용 중인 이메일입니다.' });

  const hash   = await bcrypt.hash(password, 10);
  const id     = uuid();
  const name   = email.split('@')[0];

  db.prepare(
    `INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)`
  ).run(id, email, hash, name);

  // 기본 설정 초기화
  db.prepare(`INSERT OR IGNORE INTO notification_settings (user_id) VALUES (?)`).run(id);
  db.prepare(`INSERT OR IGNORE INTO agent_settings (user_id) VALUES (?)`).run(id);

  const user    = { id, email, name, joinedAt: new Date().toISOString() };
  const access  = signAccess({ sub: id });
  const refresh = signRefresh({ sub: id });

  // refresh token 저장
  db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`
  ).run(uuid(), id, refresh, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());

  res.status(201).json({ access, refresh, user });
});

// ── 로그인 ────────────────────────────────────────────────────────
// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row) return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않아요.' });

  const ok = await bcrypt.compare(password, row.password);
  if (!ok)  return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않아요.' });

  const user    = { id: row.id, email: row.email, name: row.name, joinedAt: row.created_at };
  const access  = signAccess({ sub: row.id });
  const refresh = signRefresh({ sub: row.id });

  db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`
  ).run(uuid(), row.id, refresh, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());

  res.json({ access, refresh, user });
});

// ── 토큰 갱신 ─────────────────────────────────────────────────────
// POST /auth/refresh
router.post('/refresh', (req, res) => {
  const { refresh } = req.body;
  if (!refresh) return res.status(400).json({ message: 'refresh token이 필요합니다.' });

  try {
    const payload = jwt.verify(refresh, REFRESH_SECRET);
    const stored  = db.prepare(
      `SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime('now')`
    ).get(refresh);
    if (!stored) return res.status(401).json({ message: '만료된 refresh token입니다.' });

    const access = signAccess({ sub: payload.sub });
    res.json({ access });
  } catch {
    return res.status(401).json({ message: '유효하지 않은 refresh token입니다.' });
  }
});

// ── 로그아웃 ──────────────────────────────────────────────────────
// POST /auth/logout
router.post('/logout', (req, res) => {
  const { refresh } = req.body;
  if (refresh) db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refresh);
  res.json({ message: '로그아웃 완료' });
});

module.exports = router;
