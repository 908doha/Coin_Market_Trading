/**
 * Vercel Serverless Function
 * GET  /api/user-accounts  — 저장된 계좌 목록 반환
 * POST /api/user-accounts  — 계좌 목록 저장 (덮어쓰기)
 *
 * 인증: Authorization: Bearer <jwt> 헤더 (Django JWT)
 * 저장: PostgreSQL (DATABASE_URL)
 * 암호화: AES-256-GCM (ACCOUNTS_ENCRYPTION_KEY)
 */

import crypto from 'crypto';
import { Client } from 'pg';

// ── JWT payload decode (검증 없이 userId 추출) ────────────────────────────────
function decodeJwtPayload(token: string): { user_id?: number; id?: number; sub?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const pad     = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
    const decoded = Buffer.from(pad(parts[1]), 'base64url').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function getUserId(req: any): string | null {
  const auth = req.headers?.authorization ?? req.headers?.Authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const id = payload.user_id ?? payload.id ?? payload.sub;
  return id != null ? String(id) : null;
}

// ── AES-256-GCM 암호화 ────────────────────────────────────────────────────────
function getKey(): Buffer {
  const secret = process.env.ACCOUNTS_ENCRYPTION_KEY ?? 'default_dev_key_change_in_prod!!';
  return crypto.scryptSync(secret, 'accounts_salt_v1', 32);
}

function encrypt(plain: string): string {
  const key = getKey();
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), enc.toString('hex'), tag.toString('hex')].join(':');
}

function decrypt(encoded: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted data format');
  const [ivHex, encHex, tagHex] = parts;
  const key     = getKey();
  const iv      = Buffer.from(ivHex,  'hex');
  const enc     = Buffer.from(encHex, 'hex');
  const tag     = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString('utf8') + decipher.final('utf8');
}

// ── DATABASE_URL 파싱 (비밀번호 특수문자 URL 디코딩) ──────────────────────────
function buildClientConfig(url: string) {
  try {
    const u = new URL(url);
    return {
      host:     u.hostname,
      port:     parseInt(u.port || '5432', 10),
      database: u.pathname.replace(/^\//, '') || 'postgres',
      user:     decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      ssl:      { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    };
  } catch {
    // URL 파싱 실패 시 connectionString 그대로 사용 (fallback)
    return { connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 };
  }
}

// ── PostgreSQL (Vercel 서버리스 — 매 요청마다 Client 생성) ──────────────────────
async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  const client = new Client(buildClientConfig(url));

  try {
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS exchange_accounts (
        user_id    TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function dbGet(userId: string): Promise<string | null> {
  return withDb(async (c) => {
    const res = await c.query('SELECT data FROM exchange_accounts WHERE user_id = $1', [userId]);
    return res.rows[0]?.data ?? null;
  });
}

async function dbUpsert(userId: string, enc: string): Promise<void> {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO exchange_accounts (user_id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = NOW()`,
      [userId, enc],
    );
  });
}

// ── CORS 헤더 ─────────────────────────────────────────────────────────────────
function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: '인증이 필요해요' }); return; }

  if (!process.env.DATABASE_URL) {
    // DB 미설정 — 클라이언트가 로컬 스토리지만 사용하도록
    res.status(204).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const enc = await dbGet(userId);
      if (!enc) { res.status(200).json([]); return; }
      const plain = decrypt(enc);
      res.status(200).json(JSON.parse(plain));

    } else if (req.method === 'POST') {
      const body    = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const accounts = Array.isArray(body) ? body : body?.accounts;
      if (!Array.isArray(accounts)) {
        res.status(400).json({ error: 'accounts 배열이 필요해요' });
        return;
      }
      const enc = encrypt(JSON.stringify(accounts));
      await dbUpsert(userId, enc);
      res.status(200).json({ ok: true });

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err: any) {
    console.error('[user-accounts]', err);
    res.status(502).json({ error: err?.message ?? 'Internal error' });
  }
}
