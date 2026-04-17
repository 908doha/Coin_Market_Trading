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

// ── JWT payload decode (서명 검증 없이 user_id 추출) ─────────────────────────
function getUserId(req: any): string | null {
  try {
    const auth  = (req.headers?.authorization ?? req.headers?.Authorization ?? '') as string;
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;
    const parts   = token.split('.');
    if (parts.length < 2) return null;
    const pad     = (s: string) => s + '='.repeat((4 - s.length % 4) % 4);
    const payload = JSON.parse(Buffer.from(pad(parts[1]), 'base64url').toString('utf8'));
    const id      = payload.user_id ?? payload.id ?? payload.sub;
    return id != null ? String(id) : null;
  } catch { return null; }
}

// ── Supabase 클라이언트 (service_role — RLS 우회, 서버 전용) ─────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── CORS ─────────────────────────────────────────────────────────────────────
function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  setCors(res);
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

    // ── PATCH: orphan account_id → 새 account_id로 재바인딩 ──────────────────
    //  body: { newAccountId: string; keepAccountIds?: string[] }
    //  동작: user의 balance_history 중 account_id 가 (''도 아니고
    //  keepAccountIds 에도 없는) row 들을 newAccountId 로 UPDATE.
    //  사용처: exchange_accounts 초기화 후 재등록 시 과거 계좌별 스냅샷을
    //  신규 랜덤 ID로 흡수.
    } else if (req.method === 'PATCH') {
      const body             = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const newAccountId     = (body?.newAccountId ?? '').toString();
      const keepAccountIdsIn = Array.isArray(body?.keepAccountIds) ? body.keepAccountIds : [];
      if (!newAccountId) {
        res.status(400).json({ error: 'newAccountId 가 필요해요' });
        return;
      }
      // 현재 활성 계좌 + '' (총자산) 은 보존
      const keepSet = new Set<string>(['', ...keepAccountIdsIn.map(String)]);

      // 1) orphan account_id 후보 수집
      const { data: rows, error: listErr } = await sb
        .from('balance_history')
        .select('account_id')
        .eq('user_id', userId);
      if (listErr) throw new Error(listErr.message);

      const orphans = Array.from(
        new Set((rows ?? []).map((r: any) => String(r.account_id ?? '')))
      ).filter((id) => !keepSet.has(id));

      if (!orphans.length) { res.status(200).json({ rebound: 0, orphans: [] }); return; }

      // 2) orphan 전체를 newAccountId 로 rebind
      //    UNIQUE (user_id, account_id, ts) 충돌을 피하기 위해 per-orphan 으로 반복.
      //    기존 newAccountId 스냅샷과 ts 가 겹치면 insert 되지 않도록 upsert-merge 방식:
      //    먼저 동일 ts row 제거 후 UPDATE.
      let rebound = 0;
      for (const oldId of orphans) {
        const { data: oldRows, error: selErr } = await sb
          .from('balance_history')
          .select('ts, total')
          .eq('user_id', userId)
          .eq('account_id', oldId);
        if (selErr) throw new Error(selErr.message);
        if (!oldRows?.length) continue;

        // 대상 newAccountId 쪽 기존 ts 수집
        const tsList = oldRows.map((r: any) => Number(r.ts));
        const { data: dupRows } = await sb
          .from('balance_history')
          .select('ts')
          .eq('user_id', userId)
          .eq('account_id', newAccountId)
          .in('ts', tsList);
        const dupSet = new Set<number>((dupRows ?? []).map((r: any) => Number(r.ts)));

        // 중복 ts 는 old 에서 삭제, 나머지는 account_id 업데이트
        const dupTs    = tsList.filter((t) => dupSet.has(t));
        const uniqueTs = tsList.filter((t) => !dupSet.has(t));

        if (dupTs.length) {
          await sb
            .from('balance_history')
            .delete()
            .eq('user_id', userId)
            .eq('account_id', oldId)
            .in('ts', dupTs);
        }
        if (uniqueTs.length) {
          const { error: updErr } = await sb
            .from('balance_history')
            .update({ account_id: newAccountId })
            .eq('user_id', userId)
            .eq('account_id', oldId)
            .in('ts', uniqueTs);
          if (updErr) throw new Error(updErr.message);
          rebound += uniqueTs.length;
        }
      }

      res.status(200).json({ rebound, orphans });

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (err: any) {
    console.error('[balance-history]', err);
    res.status(502).json({ error: err?.message ?? 'Internal error' });
  }
}
