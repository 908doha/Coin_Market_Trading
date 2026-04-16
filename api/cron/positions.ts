/**
 * Vercel Cron Function
 * GET /api/cron/positions
 * Schedule: */5 * * * * (every 5 minutes — Vercel Pro required)
 *
 * For every user in exchange_accounts (Gate.io only):
 *   1. Decrypt Gate.io credentials
 *   2. Fetch open positions and recent opening trades
 *   3. For each open position with no ICT snapshot yet: run analysis → save
 *   4. Save balance snapshot to balance_history
 *
 * Required Vercel env vars:
 *   CRON_SECRET                — random secret set in Vercel project settings
 *   ACCOUNTS_ENCRYPTION_KEY    — same key used by /api/user-accounts
 *   SUPABASE_URL               — https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  — service_role key
 */

import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  parseCandles,
  analyzeHTF, analyzeMTF, analyzeLTF,
  getActiveSession, calcSLTP, calcScore,
} from '../_ict';

// ── AES-256-GCM decrypt (mirrors user-accounts.ts) ───────────────────────────

function getKey(): Buffer {
  const secret = process.env.ACCOUNTS_ENCRYPTION_KEY;
  if (!secret) throw new Error('ACCOUNTS_ENCRYPTION_KEY is not set');
  return crypto.scryptSync(secret, 'accounts_salt_v1', 32);
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

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Gate.io helpers ───────────────────────────────────────────────────────────

function gateSign(apiSecret: string, method: string, path: string, query: string, ts: string): string {
  const bodyHash = crypto.createHash('sha512').update('').digest('hex');
  return crypto.createHmac('sha512', apiSecret)
    .update(`${method}\n${path}\n${query}\n${bodyHash}\n${ts}`)
    .digest('hex');
}

async function gateGet(apiKey: string, apiSecret: string, path: string, query: string): Promise<any> {
  const ts  = Math.floor(Date.now() / 1000).toString();
  const sig = gateSign(apiSecret, 'GET', path, query, ts);
  const res = await fetch(`https://api.gateio.ws${path}${query ? '?' + query : ''}`, {
    headers: { KEY: apiKey, Timestamp: ts, SIGN: sig, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Gate.io ${path}: ${res.status}`);
  return res.json();
}

// Gate.io public candlestick endpoint — no auth required
async function fetchCandles(contract: string, interval: string, limit: number): Promise<any[]> {
  try {
    const res = await fetch(
      `https://api.gateio.ws/api/v4/futures/usdt/candlesticks` +
      `?contract=${encodeURIComponent(contract)}&interval=${interval}&limit=${limit}`,
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// ── ICT analysis for one contract ────────────────────────────────────────────

async function runIctAnalysis(contract: string): Promise<Record<string, any> | null> {
  const [htfRaw, mtfRaw, ltfRaw] = await Promise.all([
    fetchCandles(contract, '4h',  200),
    fetchCandles(contract, '15m', 200),
    fetchCandles(contract, '5m',  100),
  ]);

  const htfC = parseCandles(htfRaw);
  const mtfC = parseCandles(mtfRaw);
  const ltfC = parseCandles(ltfRaw);
  if (!htfC.length || !mtfC.length || !ltfC.length) return null;

  const currentPrice = ltfC[ltfC.length - 1].close;
  const session      = getActiveSession();
  const htf          = analyzeHTF(htfC);
  const mtf          = analyzeMTF(mtfC, htf.direction);
  const ltf          = analyzeLTF(ltfC, htf.direction, session);
  const { score, grade } = calcScore(htf, mtf, ltf, session);

  let signal: string | null = null;
  let entry: number | null = null;
  let sl: number | null = null;
  let tp: number | null = null;
  let rr: string | null = null;
  const confluence: string[] = [...mtf.confluence, ...ltf.confluence];
  let reason = '';

  if (htf.direction && mtf.confirmed && ltf.ready) {
    signal = htf.direction === 'bullish' ? 'long' : 'short';
    entry  = currentPrice;
    const sltp = calcSLTP(currentPrice, htf.direction, mtf.relOBs, ltf.swingHighs, ltf.swingLows, htf.pdhl);
    sl = sltp.sl; tp = sltp.tp;
    reason = `ICT v2 ${signal.toUpperCase()} — ${confluence.length}개 컨플루언스`;
    rr = Math.abs(tp - entry) / Math.abs(entry - sl) > 0
      ? (Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2) : null;
  } else {
    reason = !htf.direction ? 'HTF 방향 불명확'
           : !mtf.confirmed ? 'MTF 구조 미확인'
           :                  'LTF 진입 미충족';
  }

  return {
    contract, currentPrice,
    session: { active: session.active, name: session.name },
    htf: {
      direction: htf.direction ? htf.direction.toUpperCase() : null,
      structure: htf.structure,
      inPOI: htf.inPOI, poiType: htf.poiType,
    },
    mtf: { mss: { found: !!mtf.mss, label: mtf.mss ?? undefined }, confirmed: mtf.confirmed },
    ltf: { ready: ltf.ready, entryType: ltf.entryType, fvgCE: ltf.fvgCE, fvgFill: ltf.fvgFill, iofed: ltf.iofed },
    summary: { signal, reason, confluence, entry, sl, tp, rr },
    score, grade,
  };
}

// ── USDT/KRW rate ─────────────────────────────────────────────────────────────

async function getUsdtKrw(): Promise<number> {
  try {
    const res = await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT');
    const [t] = await res.json();
    return t?.trade_price ?? 1350;
  } catch {
    return 1350;
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  // Vercel cron 인증: Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = (req.headers?.authorization ?? '') as string;
    if (authHeader !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const sb = getSupabase();
  if (!sb) {
    res.status(503).json({ error: 'Supabase not configured' });
    return;
  }

  try {
    // 1. 모든 사용자의 exchange_accounts 조회
    const { data: rows, error: rowsErr } = await sb
      .from('exchange_accounts')
      .select('user_id, data');
    if (rowsErr) throw new Error(rowsErr.message);
    if (!rows?.length) {
      res.status(200).json({ ok: true, users: 0 });
      return;
    }

    const [usdtKrw] = await Promise.all([getUsdtKrw()]);
    const nowTs = Math.floor(Date.now() / 1000);
    const results: Array<{ userId: string; snapshots: number; balances: number; error?: string }> = [];

    for (const row of rows) {
      const userId = row.user_id as string;
      let userSnapshots = 0;
      let userBalances  = 0;

      try {
        // 2. 계좌 정보 복호화
        const accounts: any[] = JSON.parse(decrypt(row.data as string));
        const gateAccounts = accounts.filter(
          (a: any) => a.exchange === 'gate' && a.apiKey && a.apiSecret,
        );
        if (!gateAccounts.length) continue;

        for (const account of gateAccounts) {
          const { apiKey, apiSecret } = account;
          const accountId: string = account.id ?? account.name ?? 'gate';

          // 3. 열린 포지션 + 최근 오픈 체결 병렬 조회
          let positions: any[] = [];
          let openingTrades: any[] = [];

          try {
            [positions, openingTrades] = await Promise.all([
              gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/positions', ''),
              gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/my_trades', 'limit=200'),
            ]);
          } catch (e) {
            console.error(`[cron] fetch failed for user ${userId}:`, e);
            continue;
          }

          // 활성 포지션만 (size != 0)
          const activePositions = positions.filter(
            (p: any) => parseFloat(p.size ?? '0') !== 0,
          );

          // 오픈 체결 타임스탬프 맵: contract → 가장 최근 진입 시각
          const latestOpenTs = new Map<string, number>();
          for (const t of openingTrades) {
            if (t.close_position) continue;
            const contract = t.contract as string;
            const ts       = Number(t.create_time);
            const prev     = latestOpenTs.get(contract) ?? 0;
            if (ts > prev) latestOpenTs.set(contract, ts);
          }

          // 4. ICT 스냅샷 — 아직 없는 포지션만 분석
          for (const pos of activePositions) {
            const contract = pos.contract as string;
            if (!contract) continue;

            // 진입 타임스탬프 (오픈 체결 기준, 없으면 현재 시각)
            const entryTs = latestOpenTs.get(contract) ?? nowTs;

            // Supabase에 이미 동일 스냅샷이 있는지 확인 (±120초)
            const { data: existing } = await sb
              .from('ict_snapshots')
              .select('id')
              .eq('user_id', userId)
              .eq('contract', contract)
              .gte('entry_ts', entryTs - 120)
              .lte('entry_ts', entryTs + 120)
              .limit(1);

            if (existing?.length) continue;

            // ICT 분석 실행 → 저장
            try {
              const analysis = await runIctAnalysis(contract);
              if (!analysis) continue;

              const entryAt = new Date(entryTs * 1000).toISOString();
              const { error: upsertErr } = await sb
                .from('ict_snapshots')
                .upsert(
                  { user_id: userId, contract, entry_ts: entryTs, entry_at: entryAt, analysis },
                  { onConflict: 'user_id,contract,entry_ts' },
                );
              if (!upsertErr) userSnapshots++;
            } catch (e) {
              console.error(`[cron] ICT analysis failed for ${contract}:`, e);
            }
          }

          // 5. 잔고 스냅샷 저장
          try {
            const futData: any = await gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/accounts', '');
            const totalUsdt   = parseFloat(futData?.total ?? '0');
            const totalKrw    = Math.round(totalUsdt * usdtKrw);

            const { error: balErr } = await sb
              .from('balance_history')
              .upsert(
                { user_id: userId, account_id: accountId, ts: nowTs, total: totalKrw },
                { onConflict: 'user_id,account_id,ts' },
              );
            if (!balErr) userBalances++;
          } catch (e) {
            console.error(`[cron] balance snapshot failed for user ${userId}:`, e);
          }
        }

        results.push({ userId, snapshots: userSnapshots, balances: userBalances });
      } catch (e: any) {
        console.error(`[cron] user ${userId} failed:`, e);
        results.push({ userId, snapshots: 0, balances: 0, error: e?.message });
      }
    }

    res.status(200).json({ ok: true, users: results.length, results });
  } catch (err: any) {
    console.error('[cron/positions]', err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
}
