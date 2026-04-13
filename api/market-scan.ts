/**
 * Vercel Serverless Function
 * GET /api/market-scan
 *
 * CoinGecko 시가총액 상위 50개 코인 조회
 * → ICT 종목 스캔용 Ticker 형식으로 변환
 */

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets' +
        '?vs_currency=usd&order=market_cap_desc&per_page=50&page=1' +
        '&sparkline=false&price_change_percentage=24h',
      { headers: { Accept: 'application/json' } },
    );

    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const coins: any[] = await res.json();

    const tickers = coins.map((c) => ({
      contract:     c.symbol.toUpperCase() + '_USDT',
      symbol:       c.symbol.toUpperCase() + 'USDT',
      coin:         c.symbol.toUpperCase(),
      name:         c.name,
      last:         c.current_price ?? 0,
      change24h:    c.price_change_percentage_24h ?? 0,
      volume24hUsd: c.total_volume ?? 0,
      fundingRate:  0,
    }));

    return new Response(JSON.stringify(tickers), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
