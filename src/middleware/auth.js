const jwt = require('jsonwebtoken');
const db  = require('../db');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET  || 'osprey-access-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'osprey-refresh-secret-change-me';

/**
 * Access token 발급 (15분)
 */
function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: '15m' });
}

/**
 * Refresh token 발급 (30일)
 */
function signRefresh(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: '30d' });
}

/**
 * Access token 검증 미들웨어
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return res.status(401).json({ message: '인증이 필요합니다.' });

  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    const user    = db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').get(payload.sub);
    if (!user) return res.status(401).json({ message: '존재하지 않는 계정입니다.' });
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'token_expired' });
    }
    return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
  }
}

module.exports = { signAccess, signRefresh, requireAuth };
