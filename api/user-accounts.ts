/**
 * Vercel Serverless Function
 * GET  /api/user-accounts  — 저장된 계좌 목록 반환
 * POST /api/user-accounts  — 계좌 목록 저장 (덮어쓰기)
 *
 * 인증: Authorization: Bearer <jwt> 헤더
 * 저장: Railway PostgreSQL (pg Pool) — exchange_accounts 테이블
 * 암호화: AES-256-GCM (ACCOUNTS_ENCRYPTION_KEY)
 *
 * 필요한 Vercel 환경변수:
 *   DATABASE_URL             — postgresql://user:pass@host:5432/railway
 *   ACCOUNTS_ENCRYPTION_KEY  — 32자 이상 암호화 키
 *   FRONTEND_URL             — https://your-app.vercel.app (CORS 허용)
 */

import crypto from 'crypto';
import { Pool } from 'pg';

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

// ── PostgreSQL 연결 (Railway — SSL + 서버리스 최적화) ─────────────────────────
let pool: Pool | null = null;

function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,                        // 서버리스: 최소 연결
      idleTimeoutMillis: 10_000,     // 유휴 연결 빠르게 정리
      connectionTimeoutMillis: 10_000,
      ssl: { rejectUnauthorized: false },  // Railway 자체서명 인증서 허용
    });
    pool.on('error', (err) => {
      console.error('[pg pool] unexpected error:', err.message);
      pool = null;  // 다음 요청에서 새 풀 생성
    });
  }
  return pool;
}

let tableEnsured = false;

async function ensureTable(p: Pool): Promise<void> {
  if (tableEnsured) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS exchange_accounts (
      user_id    TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  tableEnsured = true;
}

async function dbGet(userId: string): Promise<string | null> {
  const p = getPool();
  if (!p) return null;
  await ensureTable(p);
  const { rows } = await p.query(
    'SELECT data FROM exchange_accounts WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.data ?? null;
}

async function dbUpsert(userId: string, enc: string): Promise<void> {
  const p = getPool();
  if (!p) return;
  await ensureTable(p);
  await p.query(
    `INSERT INTO exchange_accounts (user_id, data, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [userId, enc],
  );
}

// ── CORS 헤더 (FRONTEND_URL 환경변수 기반) ────────────────────────────────────
function setCors(req: any, res: any) {
  const allowed = process.env.FRONTEND_URL;   // e.g. https://my-app.vercel.app
  const origin  = req.headers?.origin ?? '';

  if (allowed && origin === allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (allowed) {
    // 요청 origin이 없거나 다르더라도 허용 (same-origin 요청은 origin 헤더 없음)
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    // FRONTEND_URL 미설정 시 개발용 와일드카드
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: '인증이 필요해요' }); return; }

  if (!process.env.DATABASE_URL) {
    // DB 미설정 — 빈 배열 반환 (클라이언트가 로컬 스토리지만 사용)
    res.status(200).json([]);
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
