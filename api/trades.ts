/**
 * Vercel Serverless Function
 * POST /api/trades
 * Body: { exchange, apiKey, apiSecret }
 * Returns: Trade[]
 *
 * Gate.io 선물 거래 내역 실시간 조회
 */

import crypto from 'crypto';

interface Trade {
  id:          string;
  symbol:      string;
  direction:   'Long' | 'Short';
  type:        'take_profit' | 'stop_loss' | 'manual';
  profit:      number;   // KRW
  profitRate:  number;   // %
  holdingDays: number;
  entryAt:     string;
  exitAt:      string;
}

// ── Gate.io 청산 내역 조회 ────────────────────────────────────────────────────

async function fetchGateTrades(apiKey: string, apiSecret: string): Promise<Trade[]> {
  const method = 'GET';
  const query  = 'limit=100';
  const path   = '/api/v4/futures/usdt/my_trades';
  const ts     = Math.floor(Date.now() / 1000).toString();
  const msg    = `${method}\n${path}\n${query}\n\n${ts}`;
  const sig    = crypto.createHmac('sha512', apiSecret).update(msg).digest('hex');

  const res = await fetch(`https://api.gateio.ws${path}?${query}`, {
    method,
    headers: {
      KEY:       apiKey,
      Timestamp: ts,
      SIGN:      sig,
      'Accept':  'application/json',
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gate.io API error ${res.status}: ${err}`);
  }

  const data: any[] = await res.json();

  // USDT/KRW 환율
  let usdtKrw = 1350;
  try {
    const ticker = await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT');
    const [t] = await ticker.json();
    usdtKrw = t.trade_price;
  } catch { /* fallback */ }

  // 청산 거래만 (size가 0인 closing trade)
  const closingTrades = data.filter((t: any) => t.close_position === true);

  return closingTrades.map((t: any): Trade => {
    const pnl        = parseFloat(t.close_pnl || '0');
    const profitKrw  = pnl * usdtKrw;
    const contract   = t.contract as string;
    const size       = Number(t.size);
    const price      = parseFloat(t.price || '0');
    const createTime = t.create_time ? new Date(t.create_time * 1000) : new Date();
    const exitAt     = createTime.toISOString();

    // 진입 시각은 직접 추적이 어려워 임시로 동일하게
    const entryAt    = exitAt;
    const holdingDays = 0;

    return {
      id:          t.id?.toString() ?? String(Date.now()),
      symbol:      contract.replace('_', '/'),
      direction:   size < 0 ? 'Long' : 'Short', // closing: sell = 롱 청산
      type:        pnl >= 0 ? 'take_profit' : 'stop_loss',
      profit:      profitKrw,
      profitRate:  price > 0 ? parseFloat(((pnl / (price * Math.abs(size))) * 100).toFixed(2)) : 0,
      holdingDays,
      entryAt,
      exitAt,
    };
  });
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { exchange, apiKey, apiSecret } = req.body ?? {};
  if (!apiKey || !apiSecret) {
    res.status(400).json({ error: 'apiKey, apiSecret 필요' });
    return;
  }

  try {
    let trades: Trade[] = [];

    if (exchange === 'gate') {
      trades = await fetchGateTrades(apiKey, apiSecret);
    }

    res.status(200).json(trades);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? 'Internal error' });
  }
}
