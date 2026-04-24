/**
 * Vercel Serverless Function
 * GET /api/market-scan
 *
 * Gate.io USDT-M 선물 상장 전 종목 조회 (크립토 + 원자재 perp 모두 포함).
 *
 * 이전 버전은 CoinGecko top-50 만 반환했기 때문에:
 *   - 시총 50위 밖 종목 누락
 *   - Gate.io 원자재 perp (XBR/XTI/XAU/XAG) 전부 누락 (CoinGecko DB 에 없음)
 *   - CoinGecko symbol ↔ Gate.io contract 매핑 불일치
 * 의 제약이 있었다. Gate.io 자체 tickers 엔드포인트로 교체해 제약 해소.
 */

export const config = { runtime: 'edge' };

interface Ticker {
  contract:     string;  // 'BTC_USDT'
  symbol:       string;  // 'BTCUSDT'
  coin:         string;  // 'BTC'
  name:         string;  // 표시명 (Gate.io 는 이름 없음 → coin 과 동일)
  last:         number;
  change24h:    number;
  volume24hUsd: number;
  fundingRate:  number;
}

export default async function handler(_req: Request) {
  try {
    const res = await fetch(
      'https://api.gateio.ws/api/v4/futures/usdt/tickers',
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`Gate.io tickers ${res.status}`);
    const raw: any[] = await res.json();

    const tickers: Ticker[] = raw
      .map((t) => {
        const contract = String(t.contract ?? '');
        const coin     = contract.replace('_USDT', '');
        return {
          contract,
          symbol:       contract.replace('_', ''),
          coin,
          name:         coin,
          last:         parseFloat(t.last ?? '0') || 0,
          change24h:    parseFloat(t.change_percentage ?? '0') || 0,
          volume24hUsd: parseFloat(t.volume_24h_quote ?? t.volume_24h_usd ?? '0') || 0,
          fundingRate:  parseFloat(t.funding_rate ?? '0') || 0,
        };
      })
      .filter((t) => t.contract && t.contract.endsWith('_USDT'))
      // 거래량 큰 순 정렬 — 분석 페이지 기본 정렬에 유리
      .sort((a, b) => b.volume24hUsd - a.volume24hUsd);

    return new Response(JSON.stringify(tickers), {
      headers: {
        'Content-Type':  'application/json',
        // 60초 edge 캐시 + 2분 SWR — 실시간성 유지하면서 Gate.io rate limit 보호
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status:  500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
