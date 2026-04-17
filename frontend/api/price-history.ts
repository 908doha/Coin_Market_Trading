/**
 * Vercel Serverless Function
 * POST /api/price-history
 * Body: { apiKey, apiSecret, contract, from (unix sec), to (unix sec) }
 * Returns: { points: { t: number, p: number }[] }
 *
 * Gate.io 선물 캔들스틱 조회 → 시계열 가격 이력 반환
 */

import crypto from 'crypto';

interface PricePoint { t: number; p: number; }

function gateSign(apiSecret: string, method: string, path: string, query: string, ts: string): string {
  const bodyHash = crypto.createHash('sha512').update('').digest('hex');
  return crypto.createHmac('sha512', apiSecret)
    .update(`${method}\n${path}\n${query}\n${bodyHash}\n${ts}`)
    .digest('hex');
}

async function fetchCandlesticks(
  apiKey: string,
  apiSecret: string,
  contract: string,
  from: number,
  to: number,
): Promise<PricePoint[]> {
  // 기간에 따라 적절한 인터벌 선택
  const durationSec = to - from;
  let interval = '5m';
  if (durationSec <= 3600)         interval = '1m';   // 1시간 이하 → 1분봉
  else if (durationSec <= 86400)   interval = '5m';   // 하루 이하 → 5분봉
  else if (durationSec <= 604800)  interval = '1h';   // 1주 이하 → 1시간봉
  else                              interval = '4h';   // 그 이상 → 4시간봉

  const method = 'GET';
  const path   = '/api/v4/futures/usdt/candlesticks';
  const query  = `contract=${contract}&interval=${interval}&from=${from}&to=${to}&limit=200`;
  const ts     = Math.floor(Date.now() / 1000).toString();
  const sig    = gateSign(apiSecret, method, path, query, ts);

  const res = await fetch(`https://api.gateio.ws${path}?${query}`, {
    method,
    headers: {
      KEY:       apiKey,
      Timestamp: ts,
      SIGN:      sig,
      Accept:    'application/json',
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gate.io candlestick error ${res.status}: ${err}`);
  }

  const data: any[] = await res.json();

  // Gate.io candlestick 응답: [{ t, v, c, h, l, o }, ...]
  // t = unix timestamp (sec), c = close price (string)
  return data
    .filter((d) => d.t && d.c)
    .map((d) => ({
      t: Number(d.t) * 1000, // ms로 변환
      p: parseFloat(d.c),
    }));
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { apiKey, apiSecret, contract, from, to } = req.body ?? {};
  if (!apiKey || !apiSecret || !contract) {
    res.status(400).json({ error: 'apiKey, apiSecret, contract 필요' });
    return;
  }

  const fromSec = Number(from) || Math.floor(Date.now() / 1000) - 86400;
  const toSec   = Number(to)   || Math.floor(Date.now() / 1000);

  try {
    const points = await fetchCandlesticks(apiKey, apiSecret, contract, fromSec, toSec);
    res.status(200).json({ points });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? 'Internal error' });
  }
}
