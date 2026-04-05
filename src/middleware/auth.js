const jwt       = require('jsonwebtoken');
const { getDb } = require('../db');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET  || 'osprey-access-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'osprey-refresh-secret-change-me';

function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: '15m' });
}

function signRefresh(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: '30d' });
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: '인증이 필요합니다.' });

  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    const db   = await getDb();
    const user = await db.get('SELECT id, email, name, created_at FROM users WHERE id = ?', payload.sub);
    if (!user) return res.status(401).json({ message: '존재하지 않는 계정입니다.' });
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ message: 'token_expired' });
    return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
  }
}

module.exports = { signAccess, signRefresh, requireAuth };
