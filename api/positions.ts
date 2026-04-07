/**
 * Vercel Serverless Function
 * POST /api/positions
 * Body: { exchange, apiKey, apiSecret }
 * Returns: Position[]
 *
 * Gate.io 선물 포지션 실시간 조회
 */

import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface Position {
  id:          string;
  symbol:      string;
  coin:        string;
  direction:   'Long' | 'Short';
  amount:      number;   // KRW
  profit:      number;   // KRW
  profitRate:  number;   // %
  entryPrice:  number;
  markPrice:   number;
  leverage:    number;
  agentReason?: string;
}

// ── Gate.io 선물 포지션 조회 ───────────────────────────────────────────────────

async function fetchGatePositions(apiKey: string, apiSecret: string): Promise<Position[]> {
  const method = 'GET';
  const path   = '/api/v4/futures/usdt/positions';
  const ts     = Math.floor(Date.now() / 1000).toString();
  const msg    = `${method}\n${path}\n\n\n${ts}`;
  const sig    = crypto.createHmac('sha512', apiSecret).update(msg).digest('hex');

  const res = await fetch(`https://api.gateio.ws${path}`, {
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

  // USDT/KRW 환율 조회 (Upbit)
  let usdtKrw = 1350;
  try {
    const ticker = await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT');
    const [t] = await ticker.json();
    usdtKrw = t.trade_price;
  } catch { /* fallback */ }

  // 포지션 크기 != 0 인 것만 반환
  return data
    .filter((p: any) => Number(p.size) !== 0)
    .map((p: any): Position => {
      const size         = Number(p.size);
      const entryPrice   = parseFloat(p.entry_price || '0');
      const markPrice    = parseFloat(p.mark_price || '0');
      const unrealisedPnl = parseFloat(p.unrealised_pnl || '0');
      const leverage     = parseInt(p.leverage || '1', 10);
      const contract     = p.contract as string; // e.g. BTC_USDT
      const coin         = contract.replace('_USDT', '');
      const notional     = Math.abs(size) * markPrice;

      const profitKrw    = unrealisedPnl * usdtKrw;
      const amountKrw    = notional * usdtKrw;
      const profitRate   = entryPrice > 0
        ? ((markPrice - entryPrice) / entryPrice) * 100 * (size > 0 ? 1 : -1)
        : 0;

      return {
        id:         p.contract + '_' + (p.update_time || Date.now()),
        symbol:     contract.replace('_', '/'),
        coin,
        direction:  size > 0 ? 'Long' : 'Short',
        amount:     amountKrw,
        profit:     profitKrw,
        profitRate: parseFloat(profitRate.toFixed(2)),
        entryPrice,
        markPrice,
        leverage,
      };
    });
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(200).set(CORS).end();
  if (req.method !== 'POST')   return res.status(405).set(CORS).json({ error: 'Method not allowed' });

  const { exchange, apiKey, apiSecret } = req.body ?? {};
  if (!apiKey || !apiSecret) {
    return res.status(400).set(CORS).json({ error: 'apiKey, apiSecret 필요' });
  }

  try {
    let positions: Position[] = [];

    if (exchange === 'gate') {
      positions = await fetchGatePositions(apiKey, apiSecret);
    } else {
      // 다른 거래소는 추후 추가
      positions = [];
    }

    return res.status(200).set(CORS).json(positions);
  } catch (err: any) {
    return res.status(502).set(CORS).json({ error: err?.message ?? 'Internal error' });
  }
}
