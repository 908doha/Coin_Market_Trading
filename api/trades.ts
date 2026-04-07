/**
 * Vercel Serverless Function
 * POST /api/trades
 * Body: { exchange, apiKey, apiSecret }
 * Returns: Trade[]
 *
 * Gate.io 선물 거래 내역 실시간 조회
 */

import crypto from 'crypto';

function gateSign(apiSecret: string, method: string, path: string, query: string, ts: string): string {
  const bodyHash = crypto.createHash('sha512').update('').digest('hex');
  return crypto.createHmac('sha512', apiSecret)
    .update(`${method}\n${path}\n${query}\n${bodyHash}\n${ts}`)
    .digest('hex');
}

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

// ── Gate.io 포지션 청산 내역 조회 ────────────────────────────────────────────
// /my_trades 대신 /position_close 사용:
//   - 포지션 단위 실현 PnL (음수 = 손실 정확히 반영)
//   - text 필드로 청산 이유 확인 (take_profit / stop_loss / liq_long / liq_short / close manually)

async function fetchGateTrades(apiKey: string, apiSecret: string): Promise<Trade[]> {
  const method = 'GET';
  const query  = 'limit=100';
  const path   = '/api/v4/futures/usdt/position_close';
  const ts     = Math.floor(Date.now() / 1000).toString();
  const sig    = gateSign(apiSecret, method, path, query, ts);

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

  return data.map((t: any): Trade => {
    const pnl       = parseFloat(t.pnl || '0');            // 실현 손익 (USDT, 음수 = 손실)
    const profitKrw = pnl * usdtKrw;
    const contract  = t.contract as string;
    const side      = (t.side as string) ?? '';             // 'long' | 'short'
    const text      = (t.text as string) ?? '';             // 청산 이유
    const exitAt    = t.time ? new Date(t.time * 1000).toISOString() : new Date().toISOString();

    // 청산 이유 분류
    // liq_long / liq_short = 강제청산 → 항상 손실
    const isLiquidation = text.includes('liq_');
    let type: Trade['type'];
    if (isLiquidation)              type = 'stop_loss';
    else if (text === 'take_profit') type = 'take_profit';
    else if (text === 'stop_loss')   type = 'stop_loss';
    else if (pnl < 0)               type = 'stop_loss';
    else if (pnl > 0)               type = 'take_profit';
    else                             type = 'manual';

    // 수익률: entry_price 기준
    const entryPrice = parseFloat(t.entry_price || '0');
    const fillPrice  = parseFloat(t.fill_price  || '0');
    let profitRate = 0;
    if (entryPrice > 0 && fillPrice > 0) {
      const diff = side === 'long' ? fillPrice - entryPrice : entryPrice - fillPrice;
      profitRate = parseFloat(((diff / entryPrice) * 100).toFixed(2));
    }

    return {
      id:          `${t.time}_${contract}`,
      symbol:      contract.replace('_', '/'),
      direction:   side === 'long' ? 'Long' : 'Short',
      type,
      profit:      profitKrw,
      profitRate,
      holdingDays: 0,
      entryAt:     exitAt,   // position_close 엔드포인트는 진입 시각 미제공
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
