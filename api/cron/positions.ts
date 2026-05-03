/**
 * Vercel Cron Job
 * GET /api/cron/positions — 외부 cron이 2분마다 호출
 *
 * 1. 모든 사용자의 Gate.io 계정을 Supabase에서 조회
 * 2. 각 계정의 활성 포지션 조회
 * 3. 새 포지션에 대해 ICT 분석 실행 → ict_snapshots 저장
 * 4. 잔고 스냅샷 → balance_history 저장
 *
 * Env: CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ACCOUNTS_ENCRYPTION_KEY
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '../_encryption';
import { gateGet } from '../_gate';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

interface Account { userId: string; exchange: string; apiKey: string; apiSecret: string; }

async function getAllAccounts(): Promise<Account[]> {
  const sb = getSupabase(); if (!sb) return [];
  const { data, error } = await sb.from('exchange_accounts').select('user_id, data');
  if (error || !data) return [];
  const accounts: Account[] = [];
  for (const row of data) {
    try {
      const parsed: any[] = JSON.parse(decrypt(row.data));
      for (const acc of parsed) {
        if (acc.exchange === 'gate' && acc.apiKey && acc.apiSecret)
          accounts.push({ userId: row.user_id, exchange: acc.exchange, apiKey: acc.apiKey, apiSecret: acc.apiSecret });
      }
    } catch (e: any) { console.error(`[cron] decrypt failed for user ${row.user_id}:`, e?.message); }
  }
  return accounts;
}

interface SimplePosition { contract: string; entryAt: string; entryTs: number; size: number; }

async function fetchPositions(apiKey: string, apiSecret: string): Promise<SimplePosition[]> {
  const data = await gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/positions', '');
  return data.filter((p: any) => Number(p.size) !== 0).map((p: any) => {
    const rawTime = p.open_time || p.update_time || 0; const entryTs = Number(rawTime);
    const kst = rawTime ? new Date(rawTime * 1000 + 9 * 3_600_000) : null;
    const DOW = ['일', '월', '화', '수', '목', '금', '토'];
    const entryAt = kst ? `${kst.getUTCFullYear()}.${String(kst.getUTCMonth()+1).padStart(2,'0')}.${String(kst.getUTCDate()).padStart(2,'0')} (${DOW[kst.getUTCDay()]}) ${String(kst.getUTCHours()).padStart(2,'0')}:${String(kst.getUTCMinutes()).padStart(2,'0')}` : '';
    return { contract: p.contract as string, entryAt, entryTs, size: Math.abs(Number(p.size)) };
  });
}

async function hasIctSnapshot(userId: string, contract: string, entryTs: number): Promise<boolean> {
  const sb = getSupabase(); if (!sb || entryTs <= 0) return false;
  const { data } = await sb.from('ict_snapshots').select('id').eq('user_id', userId).eq('contract', contract).gte('entry_ts', entryTs - 120).lte('entry_ts', entryTs + 120).limit(1);
  return !!(data && data.length > 0);
}

async function saveIctSnapshot(userId: string, contract: string, entryTs: number, entryAt: string, analysis: any): Promise<void> {
  const sb = getSupabase(); if (!sb) return;
  await sb.from('ict_snapshots').upsert({ user_id: userId, contract, entry_ts: entryTs, entry_at: entryAt, analysis }, { onConflict: 'user_id,contract,entry_ts' });
}

async function saveBalanceSnapshot(userId: string, total: number): Promise<void> {
  const sb = getSupabase(); if (!sb) return;
  const ts = Math.floor(Date.now() / 1000);
  await sb.from('balance_history').upsert({ user_id: userId, account_id: '', ts, total }, { onConflict: 'user_id,account_id,ts', ignoreDuplicates: true });
}

async function fetchBalance(apiKey: string, apiSecret: string): Promise<number> {
  let usdtKrw = 1350;
  try { const [t] = await (await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT')).json(); usdtKrw = t.trade_price; } catch {}
  const futures = await gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/accounts', '');
  return parseFloat(futures.total ?? '0') * usdtKrw;
}

async function fetchIctViaHttp(apiKey: string, apiSecret: string, contract: string, baseUrl: string): Promise<any> {
  try {
    const res = await fetch(`${baseUrl}/api/ict-analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey, apiSecret, contract }) });
    if (!res.ok) return null; const data = await res.json(); return data?.htf !== undefined ? data : null;
  } catch { return null; }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') { res.status(405).end(); return; }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) { res.status(500).json({ error: 'CRON_SECRET not configured' }); return; }
  const auth = (req.headers?.authorization ?? '') as string;
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const a = Buffer.from(token); const b = Buffer.from(cronSecret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const baseUrl = `https://${req.headers.host}`; const results: any[] = [];
  try {
    const accounts = await getAllAccounts();
    for (const acc of accounts) {
      const result: any = { userId: acc.userId, positions: 0, ictCaptured: 0, balance: 0 };
      try {
        const positions = await fetchPositions(acc.apiKey, acc.apiSecret); result.positions = positions.length;
        for (const pos of positions) {
          if (!pos.entryTs) continue;
          const exists = await hasIctSnapshot(acc.userId, pos.contract, pos.entryTs); if (exists) continue;
          const analysis = await fetchIctViaHttp(acc.apiKey, acc.apiSecret, pos.contract, baseUrl);
          if (analysis) { await saveIctSnapshot(acc.userId, pos.contract, pos.entryTs, pos.entryAt, analysis); result.ictCaptured++; }
        }
        const total = await fetchBalance(acc.apiKey, acc.apiSecret); result.balance = Math.round(total); await saveBalanceSnapshot(acc.userId, total);
      } catch (e: any) { result.error = e?.message; }
      results.push(result);
    }
    res.status(200).json({ ok: true, users: accounts.length, results });
  } catch (err: any) { res.status(500).json({ error: err?.message ?? 'Internal error' }); }
}
