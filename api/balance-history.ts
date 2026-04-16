/**
 * Vercel Serverless Function
 * GET  /api/balance-history?accountId=&limit=
 *   → 잔고 스냅샷 이력 반환 (시간순 오름차순)
 * POST /api/balance-history
 *   body: { snapshots: { ts: number; total: number; accountId?: string }[] }
 *   → 스냅샷 배치 upsert
 *
 * 인증: Authorization: Bearer <jwt> (Django JWT — user_id 추출만 사용)
 * 저장: Supabase balance_history 테이블
 *
 * ── Supabase 테이블 생성 SQL ─────────────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS balance_history (
 *   id         bigserial PRIMARY KEY,
 *   user_id    text    NOT NULL,
 *   account_id text    NOT NULL DEFAULT '',
 *   ts         bigint  NOT NULL,
 *   total      numeric NOT NULL,
 *   created_at timestamptz DEFAULT now(),
 *   UNIQUE (user_id, account_id, ts)
 * );
 * CREATE INDEX IF NOT EXISTS balance_history_lookup
 *   ON balance_history (user_id, account_id, ts DESC);
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 필요한 Vercel 환경변수:
 *   SUPABASE_URL              — https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service_role 키
 */

import { createClient } from '@supabase/supabase-js';
import { getUserIdFromRequest } from './_jwt';

function getUserId(req: any): string | null {
  return getUserIdFromRequest(req, 'balance-history');
}

// ── Supabase 클라이언트 (service_role — RLS 우회, 서버 전용) ─────────────────
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

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Supabase 미설정 → 클라이언트가 localStorage만 사용
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(204).end();
    return;
  }

  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: '인증이 필요해요' }); return; }

  const sb = getSupabase()!;

  try {
    // ── GET: 잔고 이력 조회 ────────────────────────────────────────────────
    if (req.method === 'GET') {
      const accountId = (req.query?.accountId as string) ?? '';
      const since     = parseInt((req.query?.since as string) ?? '0', 10) || 0;
      const limit     = Math.min(parseInt((req.query?.limit  as string) ?? '52000', 10), 100_000);

      const query = sb
        .from('balance_history')
        .select('ts, total')
        .eq('user_id',    userId)
        .eq('account_id', accountId)
        .order('ts', { ascending: true })
        .limit(limit);

      if (since > 0) query.gt('ts', since);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const snapshots = (data ?? []).map((r: any) => ({
        ts:    Number(r.ts),
        total: Number(r.total),
      }));
      res.status(200).json(snapshots);

    // ── POST: 스냅샷 배치 upsert ──────────────────────────────────────────
    } else if (req.method === 'POST') {
      const body      = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const snapshots = body?.snapshots;
      if (!Array.isArray(snapshots) || !snapshots.length) {
        res.status(400).json({ error: 'snapshots 배열이 필요해요' });
        return;
      }

      // 최대 5,000개 배치 제한 (Supabase 단일 요청 권장 한도)
      const batch = snapshots.slice(0, 5_000);
      const rows  = batch.map((s: any) => ({
        user_id:    userId,
        account_id: s.accountId ?? '',
        ts:         Number(s.ts),
        total:      Number(s.total),
      }));

      const { error } = await sb
        .from('balance_history')
        .upsert(rows, { onConflict: 'user_id,account_id,ts' });
      if (error) throw new Error(error.message);

      res.status(200).json({ ok: true, count: rows.length });

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (err: any) {
    console.error('[balance-history]', err);
    res.status(502).json({ error: err?.message ?? 'Internal error' });
  }
}
