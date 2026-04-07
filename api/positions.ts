/**
 * Vercel Serverless Function
 * POST /api/positions
 * Body: { exchange, apiKey, apiSecret }
 * Returns: Position[]
 *
 * Gate.io 선물 포지션 실시간 조회
 */

import crypto from 'crypto';

interface Position {
  id:            string;
  symbol:        string;
  coin:          string;
  direction:     'Long' | 'Short';
  amount:        number;   // KRW (증거금)
  profit:        number;   // KRW
  profitRate:    number;   // %
  entryPrice:    number;
  markPrice:     number;
  leverage:      number;
  agentReason?:  string;
  // 상세 화면용
  currentPrice:  number;
  currentValue:  number;   // KRW (평가금)
  weight:        number;   // 포트폴리오 내 비중 (단일 포지션에서는 100)
  entryAt:       string;
  holdingPeriod: string;
  riskLevel:     1 | 2 | 3 | 4 | 5;
  liqPrice:      number;   // 청산가
  size:          number;   // 계약 수
  usdtKrw:       number;
}

// ── Gate.io 선물 포지션 조회 ───────────────────────────────────────────────────

function gateSign(apiSecret: string, method: string, path: string, query: string, ts: string): string {
  const bodyHash = crypto.createHash('sha512').update('').digest('hex');
  return crypto.createHmac('sha512', apiSecret)
    .update(`${method}\n${path}\n${query}\n${bodyHash}\n${ts}`)
    .digest('hex');
}

async function fetchGatePositions(apiKey: string, apiSecret: string): Promise<Position[]> {
  const method = 'GET';
  const path   = '/api/v4/futures/usdt/positions';
  const ts     = Math.floor(Date.now() / 1000).toString();
  const sig    = gateSign(apiSecret, method, path, '', ts);

  const res = await fetch(`https://api.gateio.ws${path}`, {
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
      const size          = Number(p.size);
      const entryPrice    = parseFloat(p.entry_price || '0');
      const markPrice     = parseFloat(p.mark_price || '0');
      const unrealisedPnl = parseFloat(p.unrealised_pnl || '0');
      const leverage      = parseInt(p.leverage || '1', 10);
      const contract      = p.contract as string; // e.g. BTC_USDT
      const coin          = contract.replace('_USDT', '');

      // Gate.io가 내려주는 margin(증거금 USDT), value(명목가치 USDT) 직접 사용
      // → size * markPrice 계산은 quanto_multiplier 미적용으로 수천 배 오차 발생
      const marginUsdt   = parseFloat(p.margin || '0');
      const notionalUsdt = parseFloat(p.value  || '0') || (marginUsdt * leverage);

      const profitKrw    = unrealisedPnl * usdtKrw;
      const marginKrw    = marginUsdt * usdtKrw;
      const notionalKrw  = notionalUsdt * usdtKrw;

      // 증거금 대비 수익률
      const profitRate = marginUsdt > 0
        ? (unrealisedPnl / marginUsdt) * 100
        : entryPrice > 0
          ? ((markPrice - entryPrice) / entryPrice) * 100 * (size > 0 ? 1 : -1) * leverage
          : 0;

      // 레버리지별 리스크 레벨 (1~5)
      const riskLevel = leverage <= 3 ? 1 : leverage <= 5 ? 2 : leverage <= 10 ? 3 : leverage <= 20 ? 4 : 5;

      // 보유 기간 계산
      const openTime   = p.open_time ? new Date(p.open_time * 1000) : null;
      const holdingMs  = openTime ? Date.now() - openTime.getTime() : 0;
      const holdingDays = Math.floor(holdingMs / (1000 * 60 * 60 * 24));
      const holdingHours = Math.floor((holdingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const holdingPeriod = holdingDays > 0
        ? `${holdingDays}일 ${holdingHours}시간`
        : holdingHours > 0 ? `${holdingHours}시간` : '1시간 미만';

      const entryAt = openTime
        ? `${openTime.getFullYear()}.${String(openTime.getMonth()+1).padStart(2,'0')}.${String(openTime.getDate()).padStart(2,'0')}`
        : '-';

      return {
        id:           p.contract + '_' + (p.update_time || Date.now()),
        symbol:       contract.replace('_', '/'),
        coin,
        direction:    size > 0 ? 'Long' : 'Short',
        amount:       marginKrw,           // 실제 증거금 (KRW)
        profit:       profitKrw,
        profitRate:   parseFloat(profitRate.toFixed(2)),
        entryPrice,
        markPrice,
        leverage,
        currentPrice: markPrice,
        currentValue: notionalKrw,         // 명목가치 (KRW)
        weight:       100,
        entryAt,
        holdingPeriod,
        riskLevel:    riskLevel as 1|2|3|4|5,
        liqPrice:     parseFloat(p.liq_price || '0'),
        size:         Math.abs(size),
        usdtKrw,
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
    let positions: Position[] = [];

    if (exchange === 'gate') {
      positions = await fetchGatePositions(apiKey, apiSecret);
    }

    res.status(200).json(positions);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? 'Internal error' });
  }
}
