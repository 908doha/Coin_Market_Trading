/**
 * Vercel Serverless Function
 * GET  /api/ict-snapshot?contract=BTC_USDT&entryTs=1234567890
 *   → { entryAt, analysis } | null
 * POST /api/ict-snapshot
 *   body: { contract, entryTs, entryAt, analysis }
 *   → { ok: true }
 *
 * 인증: Authorization: Bearer <jwt>
 * 저장: Supabase ict_snapshots 테이블
 *
 * ── Supabase 테이블 생성 SQL ─────────────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS ict_snapshots (
 *   id         bigserial PRIMARY KEY,
 *   user_id    text    NOT NULL,
 *   contract   text    NOT NULL,
 *   entry_ts   bigint  NOT NULL,
 *   entry_at   text,
 *   analysis   jsonb   NOT NULL,
 *   created_at timestamptz DEFAULT now(),
 *   UNIQUE (user_id, contract, entry_ts)
 * );
 * CREATE INDEX IF NOT EXISTS ict_snapshots_lookup
 *   ON ict_snapshots (user_id, contract, entry_ts DESC);
 * ────────────────────────────────────────────────────────────────────────────
 */

import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

// ── JWT 검증 후 user_id 추출 ──────────────────────────────────────────────────
function getUserId(req: any): string | null {
  try {
    const auth  = (req.headers?.authorization ?? req.headers?.Authorization ?? '') as string;
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;

    const secret = process.env.JWT_SIGNING_KEY;
    if (secret) {
      const payload = jwt.verify(token, secret) as any;
      const id = payload.user_id ?? payload.id ?? payload.sub;
      return id != null ? String(id) : null;
    }

    console.warn('[ict-snapshot] JWT_SIGNING_KEY not set — skipping signature verification');
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const pad     = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
    const payload = JSON.parse(Buffer.from(pad(parts[1]), 'base64url').toString('utf8'));
    const id      = payload.user_id ?? payload.id ?? payload.sub;
    return id != null ? String(id) : null;
  } catch { return null; }
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── CORS (허용 Origin 제한) ───────────────────────────────────────────────────
function setCors(req: any, res: any) {
  const origin  = (req.headers?.origin ?? '') as string;
  const allowed = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  if (allowed.length > 0) {
    if (allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
}

export default async function handler(req: any, res: any) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(204).end();
    return;
  }

  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: '인증이 필요해요' }); return; }

  const sb = getSupabase()!;

  try {
    // ── GET: 단일 스냅샷 조회 ──────────────────────────────────────────────
    if (req.method === 'GET') {
      const contract = (req.query?.contract as string ?? '').trim();
      const entryTs  = parseInt(req.query?.entryTs as string, 10);

      if (!contract || !entryTs) {
        res.status(400).json({ error: 'contract, entryTs 파라미터 필요' });
        return;
      }

      // ±120초 허용 범위 내 가장 가까운 스냅샷 조회
      const { data, error } = await sb
        .from('ict_snapshots')
        .select('entry_at, analysis, entry_ts')
        .eq('user_id', userId)
        .eq('contract', contract)
        .gte('entry_ts', entryTs - 120)
        .lte('entry_ts', entryTs + 120)
        .order('entry_ts', { ascending: false })
        .limit(1);

      if (error) throw new Error(error.message);
      if (!data?.length) { res.status(200).json(null); return; }

      const row = data[0];
      res.status(200).json({ entryAt: row.entry_at, analysis: row.analysis });

    // ── POST: 스냅샷 upsert ───────────────────────────────────────────────
    } else if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { contract, entryTs, entryAt, analysis } = body ?? {};

      if (!contract || !entryTs || !analysis) {
        res.status(400).json({ error: 'contract, entryTs, analysis 필요' });
        return;
      }

      const { error } = await sb
        .from('ict_snapshots')
        .upsert(
          { user_id: userId, contract, entry_ts: Number(entryTs), entry_at: entryAt ?? '', analysis },
          { onConflict: 'user_id,contract,entry_ts' },
        );
      if (error) throw new Error(error.message);

      res.status(200).json({ ok: true });

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err: any) {
    console.error('[ict-snapshot]', err);
    res.status(502).json({ error: err?.message ?? 'Internal error' });
  }
}
