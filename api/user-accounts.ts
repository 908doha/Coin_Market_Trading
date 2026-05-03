/**
 * Vercel Serverless Function
 * GET  /api/user-accounts  — 저장된 계좌 목록 반환
 * POST /api/user-accounts  — 계좌 목록 저장 (덮어쓰기)
 *
 * 인증: Authorization: Bearer <jwt> 헤더 (Django JWT)
 * 저장: Supabase (supabase-js) — REST API 사용으로 직접 PG 연결 불필요
 * 암호화: AES-256-GCM (ACCOUNTS_ENCRYPTION_KEY)
 *
 * 필요한 Vercel 환경변수:
 *   SUPABASE_URL            — https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service_role 키 (Settings > API)
 */

import { createClient } from '@supabase/supabase-js';
import { getUserId, setCors } from './_auth';
import { encrypt, decrypt } from './_encryption';

// ── Supabase 클라이언트 (service_role — RLS 무시, 서버 전용) ─────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function dbGet(userId: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('exchange_accounts')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.data ?? null;
}

async function dbUpsert(userId: string, enc: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from('exchange_accounts')
    .upsert({ user_id: userId, data: enc, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  setCors(res, 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: '인증이 필요해요' }); return; }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
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
