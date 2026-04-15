/**
 * Vercel Serverless Function
 * GET /api/candlesticks?contract=BTC_USDT&from=1234567890[&to=1234567890]
 *   → Gate.io 선물 캔들스틱을 PricePoint[] 형태로 반환
 *
 * Gate.io 캔들 API는 공개 데이터 — 인증 불필요
 *
 * 보유 기간별 자동 interval 선택:
 *   ≤ 1h  → 1m   (~60개)
 *   ≤ 6h  → 5m   (~72개)
 *   ≤ 24h → 15m  (~96개)
 *   ≤ 7d  → 1h   (~168개)
 *   그 외  → 4h
 */

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function pickInterval(fromSec: number, toSec: number): string {
  const diff = toSec - fromSec;
  if (diff <=      3_600) return '1m';
  if (diff <=     21_600) return '5m';
  if (diff <=     86_400) return '15m';
  if (diff <= 7 * 86_400) return '1h';
  return '4h';
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET')    { res.status(405).end(); return; }

  const contract = (req.query?.contract as string ?? '').trim();
  const from     = parseInt(req.query?.from as string, 10);
  const to       = parseInt(req.query?.to   as string, 10) || Math.floor(Date.now() / 1000);

  if (!contract || !from || from <= 0) {
    res.status(400).json({ error: 'contract, from 파라미터 필요' });
    return;
  }

  const interval = pickInterval(from, to);

  try {
    const url =
      `https://api.gateio.ws/api/v4/futures/usdt/candlesticks` +
      `?contract=${encodeURIComponent(contract)}` +
      `&from=${from}&to=${to}&interval=${interval}&limit=1000`;

    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      res.status(502).json({ error: `Gate.io ${r.status}` });
      return;
    }

    const data: any[] = await r.json();
    const points = data
      .filter((d: any) => d.t && d.c)
      .map((d: any) => ({
        t: Number(d.t) * 1000,   // Gate.io seconds → ms
        p: parseFloat(d.c),      // close price
      }));

    res.status(200).json(points);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? 'fetch failed' });
  }
}
