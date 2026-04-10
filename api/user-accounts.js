/**
 * Vercel Serverless Function
 * GET  /api/user-accounts   — 현재 유저의 계좌 목록 반환
 * POST /api/user-accounts   — 현재 유저의 계좌 목록 저장
 *
 * Authorization: Bearer <jwt_access>
 *
 * 환경 변수 (Vercel > Settings > Environment Variables):
 *   DATABASE_URL             — PostgreSQL 연결 문자열
 *   ACCOUNTS_ENCRYPTION_KEY  — 32자+ 임의 문자열 (API 키 암호화)
 *
 * 최초 1회 테이블 생성:
 *   CREATE TABLE IF NOT EXISTS exchange_accounts (
 *     user_id    TEXT PRIMARY KEY,
 *     data       TEXT NOT NULL,
 *     updated_at TIMESTAMPTZ DEFAULT now()
 *   );
 */

const crypto = require('crypto');
const { Pool } = require('pg');

// ── DB 연결 (커넥션 풀 재사용) ────────────────────────────────────────────────
let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 1,                        // 서버리스는 1로
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000, // 이거 추가
    });

    // 에러 시 pool 리셋
    pool.on('error', () => { pool = null; });
  }
  return pool;
}
}

// ── AES-256-GCM 암호화 / 복호화 ─────────────────────────────────────────────
function getKey() {
  const secret = process.env.ACCOUNTS_ENCRYPTION_KEY ?? 'osprey-default-change-me-in-prod!';
  return crypto.scryptSync(secret, 'osprey-accounts-salt', 32);
}

function encrypt(plain) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc    = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

function decrypt(encoded) {
  const [ivHex, tagHex, encHex] = encoded.split(':');
  const iv       = Buffer.from(ivHex, 'hex');
  const tag      = Buffer.from(tagHex, 'hex');
  const enc      = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString('utf8') + decipher.final('utf8');
}

// ── JWT 디코딩 (서명 검증 없이 payload만 파싱) ───────────────────────────────
function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch { return null; }
}

// ── DB 쿼리 ──────────────────────────────────────────────────────────────────
async function ensureTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS exchange_accounts (
      user_id    TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);
}

async function dbGet(userId) {
  const { rows } = await getPool().query(
    'SELECT data FROM exchange_accounts WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.data ?? null;
}

async function dbUpsert(userId, encryptedData) {
  await getPool().query(
    `INSERT INTO exchange_accounts (user_id, data, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE
     SET data = EXCLUDED.data, updated_at = now()`,
    [userId, encryptedData],
  );
}

// ── Handler ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // DATABASE_URL 미설정이면 204 (기능 비활성화, 로컬만 사용)
  if (!process.env.DATABASE_URL) {
    res.status(204).end();
    return;
  }

  // JWT에서 userId 추출
  const token = (req.headers.authorization ?? '').replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: '인증 필요' }); return; }

  const payload = decodeJwtPayload(token);
  const userId  = String(payload?.sub ?? payload?.id ?? payload?.user_id ?? '');
  if (!userId) { res.status(401).json({ error: '유저 ID를 읽을 수 없어요' }); return; }

  try {
    await ensureTable();

    // ── GET: 계좌 목록 조회 ────────────────────────────────────────────────
    if (req.method === 'GET') {
      const enc = await dbGet(userId);
      if (!enc) { res.status(200).json([]); return; }
      const accounts = JSON.parse(decrypt(enc));
      res.status(200).json(accounts);
      return;
    }

    // ── POST: 계좌 목록 저장 ───────────────────────────────────────────────
    if (req.method === 'POST') {
      const accounts = req.body;
      if (!Array.isArray(accounts)) {
        res.status(400).json({ error: 'accounts must be an array' });
        return;
      }
      const enc = encrypt(JSON.stringify(accounts));
      await dbUpsert(userId, enc);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    console.error('[user-accounts]', e);
    res.status(500).json({ error: e?.message ?? 'DB 오류' });
  }
};
