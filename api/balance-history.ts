/**
 * Vercel Serverless Function
 * GET  /api/balance-history?accountId=&limit=
 * POST /api/balance-history { snapshots }
 * PATCH /api/balance-history { newAccountId, keepAccountIds }
 *
 * Auth: JWT, Storage: Supabase balance_history
 */

import { createClient } from '@supabase/supabase-js';
import { getUserId, setCors } from './_auth';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req: any, res: any) {
  setCors(res, 'GET,POST,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { res.status(204).end(); return; }
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: '인증이 필요해요' }); return; }
  const sb = getSupabase()!;
  try {
    if (req.method === 'GET') {
      const accountId = (req.query?.accountId as string) ?? '';
      const since     = parseInt((req.query?.since as string) ?? '0', 10) || 0;
      const limit     = Math.min(parseInt((req.query?.limit  as string) ?? '2000', 10), 10_000);
      const query = sb.from('balance_history').select('ts, total').eq('user_id', userId).eq('account_id', accountId).order('ts', { ascending: true }).limit(limit);
      if (since > 0) query.gt('ts', since);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      res.status(200).json((data ?? []).map((r: any) => ({ ts: Number(r.ts), total: Number(r.total) })));
    } else if (req.method === 'POST') {
      let body: any;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { res.status(400).json({ error: 'Invalid JSON body' }); return; }
      const snapshots = body?.snapshots;
      if (!Array.isArray(snapshots) || !snapshots.length) { res.status(400).json({ error: 'snapshots 배열이 필요해요' }); return; }
      const batch = snapshots.slice(0, 5_000);
      const rows = batch.map((s: any) => ({ user_id: userId, account_id: s.accountId ?? '', ts: Number(s.ts), total: Number(s.total) }));
      const { error } = await sb.from('balance_history').upsert(rows, { onConflict: 'user_id,account_id,ts' });
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true, count: rows.length });
    } else if (req.method === 'PATCH') {
      let body: any;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { res.status(400).json({ error: 'Invalid JSON body' }); return; }
      const newAccountId = (body?.newAccountId ?? '').toString();
      const keepAccountIdsIn = Array.isArray(body?.keepAccountIds) ? body.keepAccountIds : [];
      if (!newAccountId) { res.status(400).json({ error: 'newAccountId 가 필요해요' }); return; }
      const keepSet = new Set<string>(['', ...keepAccountIdsIn.map(String)]);
      const { data: rows, error: listErr } = await sb.from('balance_history').select('account_id').eq('user_id', userId);
      if (listErr) throw new Error(listErr.message);
      const orphans = Array.from(new Set((rows ?? []).map((r: any) => String(r.account_id ?? '')))).filter((id) => !keepSet.has(id));
      if (!orphans.length) { res.status(200).json({ rebound: 0, orphans: [] }); return; }
      const { data: allOrphan, error: selErr } = await sb.from('balance_history').select('account_id, ts, total').eq('user_id', userId).in('account_id', orphans);
      if (selErr) throw new Error(selErr.message);
      if (!allOrphan?.length) { res.status(200).json({ rebound: 0, orphans }); return; }
      const allTs = allOrphan.map((r: any) => Number(r.ts));
      const { data: existingRows } = await sb.from('balance_history').select('ts').eq('user_id', userId).eq('account_id', newAccountId).in('ts', allTs);
      const existSet = new Set<number>((existingRows ?? []).map((r: any) => Number(r.ts)));
      const dupTs = allTs.filter((t) => existSet.has(t));
      const uniqueTs = allTs.filter((t) => !existSet.has(t));
      if (dupTs.length) { await sb.from('balance_history').delete().eq('user_id', userId).in('account_id', orphans).in('ts', dupTs); }
      if (uniqueTs.length) {
        const { error: updErr } = await sb.from('balance_history').update({ account_id: newAccountId }).eq('user_id', userId).in('account_id', orphans);
        if (updErr) throw new Error(updErr.message);
      }
      res.status(200).json({ rebound: uniqueTs.length, orphans });
    } else { res.status(405).json({ error: 'Method not allowed' }); }
  } catch (err: any) { console.error('[balance-history]', err); res.status(502).json({ error: err?.message ?? 'Internal error' }); }
}
