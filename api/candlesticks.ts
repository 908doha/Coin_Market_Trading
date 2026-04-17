/**
 * Vercel Serverless Function
 * GET /api/candlesticks?contract=BTC_USDT&from=1234567890[&to=1234567890]
 *   → Gate.io 선물 캔들스틱을 PricePoint[] 형태로 반환
 *
 * Gate.io 캔들 API는 공개 데이터 — 인증 불필요
 * 주의: Gate.io는 from과 to를 동시에 지원하지 않음 → from만 사용
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

// Gate.io 캔들 fetch (실패/빈 배열은 [] 반환)
async function fetchGateCandles(
  contract: string, fromSec: number, interval: string,
): Promise<{ t: number; c: string }[]> {
  const url =
    `https://api.gateio.ws/api/v4/futures/usdt/candlesticks` +
    `?contract=${encodeURIComponent(contract)}` +
    `&from=${fromSec}&interval=${interval}&limit=1000`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data)
      ? data.filter((d: any) => d.t && d.c)
      : [];
  } catch { return []; }
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET')    { res.status(405).end(); return; }

  const contract = (req.query?.contract as string ?? '').trim();
  const from     = parseInt(req.query?.from as string, 10);
  const rawTo    = parseInt(req.query?.to   as string, 10) || 0;
  const to       = rawTo || Math.floor(Date.now() / 1000);

  if (!contract || !from || from <= 0) {
    res.status(400).json({ error: 'contract, from 파라미터 필요' });
    return;
  }

  const safeTo = Math.max(to, from + 60);
  if (safeTo - from < 60) { res.status(200).json([]); return; }

  const interval = pickInterval(from, safeTo);

  // 1차: 실제 체결 캔들
  // 2차: mark price 캔들 (저유동성 원자재/지표 perp — XBR/XTI/XAU/XAG 등은
  //      체결 캔들이 sparse하거나 빈 응답을 주는 경우가 있음. mark price는
  //      funding/오라클 기반으로 항상 계산되어 거의 항상 데이터가 존재)
  // 3차: mark price 캔들 + 더 큰 interval (1h) — 최후 fallback
  let raw = await fetchGateCandles(contract, from, interval);
  let source = 'contract';
  if (raw.length < 2) {
    raw = await fetchGateCandles(`mark_${contract}`, from, interval);
    source = 'mark';
  }
  if (raw.length < 2 && interval !== '1h' && interval !== '4h') {
    raw = await fetchGateCandles(`mark_${contract}`, from, '1h');
    source = 'mark_1h';
  }

  if (!raw.length) {
    console.log('[candlesticks] empty after fallbacks', contract, from, interval);
  } else if (source !== 'contract') {
    console.log('[candlesticks] served via', source, 'for', contract);
  }

  const points = raw
    .map((d: any) => ({
      t: Number(d.t) * 1000,
      p: parseFloat(d.c),
    }))
    .filter((pt: any) => rawTo ? pt.t <= rawTo * 1000 : true);

  res.status(200).json(points);
}
