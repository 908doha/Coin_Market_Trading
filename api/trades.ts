/**
 * Vercel Serverless Function
 * POST /api/trades
 * Body: { exchange, apiKey, apiSecret }
 * Returns: Trade[]
 *
 * Gate.io 선물 거래 내역 조회 + Supabase DB 저장/캐시 폴백
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { gateGet } from './_gate';

interface Trade {
  id: string; symbol: string; coin: string; direction: 'Long' | 'Short';
  type: 'take_profit' | 'stop_loss' | 'manual'; profit: number; profitRate: number;
  holdingDays: number; holdingPeriod: string; entryAt: string; exitAt: string;
  entryPrice: number; exitPrice: number; amount: number; leverage: number;
  agentEntryReason?: string; agentExitReason?: string;
}

async function fetchGateTrades(apiKey: string, apiSecret: string): Promise<Trade[]> {
  const [closeData, fillData]: [any[], any[]] = await Promise.all([
    gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/position_close', 'limit=100'),
    gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/my_trades', 'limit=200&close_position=true'),
  ]);
  let usdtKrw = 1350;
  try { const [t] = await (await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT')).json(); usdtKrw = t.trade_price; } catch {}
  const fillMap = new Map<string, any[]>();
  for (const f of fillData) { const k = f.contract as string; if (!fillMap.has(k)) fillMap.set(k, []); fillMap.get(k)!.push(f); }
  return closeData.map((t: any): Trade => {
    const pnl = parseFloat(t.pnl || '0'); const contract = t.contract as string; const side = (t.side as string) ?? ''; const text = (t.text as string) ?? '';
    const closeTime = Number(t.time ?? 0); const coin = contract.replace('_USDT', '');
    let openTime = Number(t.first_open_time ?? t.open_time ?? 0);
    if (!openTime) { const contractFills = fillMap.get(contract) ?? []; if (contractFills.length) { const earliest = contractFills.reduce((a: any, b: any) => Number(a.create_time) < Number(b.create_time) ? a : b); openTime = Number(earliest.create_time ?? 0); } }
    const exitAt = closeTime ? new Date(closeTime * 1000).toISOString() : new Date().toISOString();
    const entryAt = openTime ? new Date(openTime * 1000).toISOString() : exitAt;
    const holdingMs = openTime && closeTime ? (closeTime - openTime) * 1000 : 0;
    const holdingDays = Math.floor(holdingMs / (1000 * 60 * 60 * 24));
    const holdingHours = Math.floor((holdingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const holdingMins = Math.floor((holdingMs % (1000 * 60 * 60)) / (1000 * 60));
    const holdingPeriod = holdingDays > 0 ? `${holdingDays}일 ${holdingHours}시간 ${holdingMins}분` : holdingHours > 0 ? `${holdingHours}시간 ${holdingMins}분` : holdingMins > 0 ? `${holdingMins}분` : '1분 미만';
    const isLiq = text.includes('liq_');
    let type: Trade['type']; if (isLiq) type = 'stop_loss'; else if (text === 'take_profit') type = 'take_profit'; else if (text === 'stop_loss') type = 'stop_loss'; else if (pnl < 0) type = 'stop_loss'; else if (pnl > 0) type = 'take_profit'; else type = 'manual';
    const entryPrice = parseFloat((side === 'long' ? t.long_price : t.short_price) || '0');
    let exitPrice = 0; const fills = fillMap.get(contract) ?? [];
    if (fills.length) { const best = fills.reduce((a: any, b: any) => Math.abs(Number(a.create_time) - closeTime) < Math.abs(Number(b.create_time) - closeTime) ? a : b); exitPrice = parseFloat(best.price || '0'); }
    const leverage = parseInt(t.leverage || '1', 10); const marginUsdt = parseFloat(t.margin || '0'); const amount = marginUsdt * usdtKrw;
    let profitRate = 0;
    if (entryPrice > 0 && exitPrice > 0) { const diff = side === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice; profitRate = parseFloat(((diff / entryPrice) * 100 * leverage).toFixed(2)); }
    else if (pnl !== 0) { profitRate = pnl < 0 ? -0.01 : 0.01; }
    return { id: `${closeTime}_${contract}`, symbol: contract.replace('_', '/'), coin, direction: side === 'long' ? 'Long' : 'Short', type, profit: pnl * usdtKrw, profitRate, holdingDays, holdingPeriod, entryAt, exitAt, entryPrice, exitPrice, amount, leverage };
  });
}

function getSupabase() { const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!url || !key) return null; return createClient(url, key, { auth: { persistSession: false } }); }
function accountKey(apiKey: string): string { return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16); }

async function saveTradesToDb(trades: Trade[], exchange: string, apiKey: string): Promise<void> {
  const sb = getSupabase(); if (!sb || !trades.length) return;
  const accKey = accountKey(apiKey);
  const rows = trades.map((t) => ({ id: t.id, account_key: accKey, exchange, symbol: t.symbol, coin: t.coin, direction: t.direction, type: t.type, profit: t.profit, profit_rate: t.profitRate, holding_days: t.holdingDays, entry_at: t.entryAt, exit_at: t.exitAt, entry_price: t.entryPrice, exit_price: t.exitPrice, amount: t.amount, leverage: t.leverage, agent_entry_reason: t.agentEntryReason ?? null, agent_exit_reason: t.agentExitReason ?? null }));
  await sb.from('trades').upsert(rows, { onConflict: 'id,account_key', ignoreDuplicates: false }).then(({ error }) => { if (error) console.error('[trades] DB upsert error:', error.message); });
}

async function loadTradesFromDb(exchange: string, apiKey: string): Promise<Trade[] | null> {
  const sb = getSupabase(); if (!sb) return null;
  const accKey = accountKey(apiKey);
  const { data, error } = await sb.from('trades').select('*').eq('account_key', accKey).eq('exchange', exchange).order('exit_at', { ascending: false }).limit(200);
  if (error || !data?.length) return null;
  return data.map((r: any): Trade => ({ id: r.id, symbol: r.symbol, coin: r.coin, direction: r.direction, type: r.type, profit: Number(r.profit ?? 0), profitRate: Number(r.profit_rate ?? 0), holdingDays: Number(r.holding_days ?? 0), entryAt: r.entry_at, exitAt: r.exit_at, entryPrice: Number(r.entry_price ?? 0), exitPrice: Number(r.exit_price ?? 0), amount: Number(r.amount ?? 0), leverage: Number(r.leverage ?? 1), holdingPeriod: '', agentEntryReason: r.agent_entry_reason ?? undefined, agentExitReason: r.agent_exit_reason ?? undefined }));
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const { exchange, apiKey, apiSecret } = req.body ?? {};
  if (!apiKey || !apiSecret) { res.status(400).json({ error: 'apiKey, apiSecret 필요' }); return; }
  const exc = exchange ?? 'gate';
  try {
    let trades: Trade[] = []; if (exc === 'gate') { trades = await fetchGateTrades(apiKey, apiSecret); }
    saveTradesToDb(trades, exc, apiKey).catch((e) => { console.error('[trades] DB save failed:', e?.message); });
    res.status(200).json(trades);
  } catch (err: any) {
    const cached = await loadTradesFromDb(exc, apiKey).catch(() => null);
    if (cached?.length) { res.status(200).json(cached); } else { res.status(502).json({ error: err?.message ?? 'Internal error' }); }
  }
}
