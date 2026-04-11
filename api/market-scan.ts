/**
 * Vercel Serverless Function
 * GET /api/market-scan
 * Returns top 50 Gate.io USDT futures by 24h volume (public — no auth needed)
 */

export interface Ticker {
  contract:     string;
  symbol:       string;
  coin:         string;
  last:         number;
  change24h:    number;   // %
  volume24hUsd: number;   // USD
  fundingRate:  number;   // 현재 펀딩비
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const r = await fetch('https://api.gateio.ws/api/v4/futures/usdt/tickers', {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`Gate.io tickers ${r.status}`);
    const data: any[] = await r.json();

    const tickers: Ticker[] = data
      .filter((t) => (t.contract as string).endsWith('_USDT'))
      .map((t) => ({
        contract:     t.contract as string,
        symbol:       (t.contract as string).replace('_', '/'),
        coin:         (t.contract as string).replace('_USDT', ''),
        last:         parseFloat(t.last               || '0'),
        change24h:    parseFloat(t.change_percentage  || '0'),
        volume24hUsd: parseFloat(t.volume_24h_usd     || t.volume_24h_settle || '0'),
        fundingRate:  parseFloat(t.funding_rate        || '0'),
      }))
      .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
      .slice(0, 50);

    res.status(200).json(tickers);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? 'Failed to fetch tickers' });
  }
}
