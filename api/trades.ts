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

async function gateGet(apiKey: string, apiSecret: string, path: string, query: string) {
  const method = 'GET';
  const ts  = Math.floor(Date.now() / 1000).toString();
  const sig = gateSign(apiSecret, method, path, query, ts);
  const res = await fetch(`https://api.gateio.ws${path}${query ? '?' + query : ''}`, {
    method,
    headers: { KEY: apiKey, Timestamp: ts, SIGN: sig, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Gate.io ${path} error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchGateTrades(apiKey: string, apiSecret: string): Promise<Trade[]> {
  // ① position_close: 포지션 단위 PnL + 청산 이유 + 진입가(long_price/short_price)
  // ② my_trades?close_position=true: fill 가격 취득용
  const [closeData, fillData]: [any[], any[]] = await Promise.all([
    gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/position_close', 'limit=100'),
    gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/my_trades',      'limit=200&close_position=true'),
  ]);

  // USDT/KRW 환율
  let usdtKrw = 1350;
  try {
    const [t] = await (await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT')).json();
    usdtKrw = t.trade_price;
  } catch { /* fallback */ }

  // my_trades를 contract + 시간 기준으로 인덱싱 (가장 가까운 fill 매칭용)
  const fillMap = new Map<string, any[]>();
  for (const f of fillData) {
    const k = f.contract as string;
    if (!fillMap.has(k)) fillMap.set(k, []);
    fillMap.get(k)!.push(f);
  }

  return closeData.map((t: any): Trade => {
    const pnl      = parseFloat(t.pnl  || '0');
    const contract = t.contract as string;
    const side     = (t.side  as string) ?? '';
    const text     = (t.text  as string) ?? '';
    const closeTime = Number(t.time ?? 0);
    const exitAt   = closeTime ? new Date(closeTime * 1000).toISOString() : new Date().toISOString();

    // 청산 이유 분류
    const isLiq = text.includes('liq_');
    let type: Trade['type'];
    if (isLiq)                      type = 'stop_loss';
    else if (text === 'take_profit') type = 'take_profit';
    else if (text === 'stop_loss')   type = 'stop_loss';
    else if (pnl < 0)               type = 'stop_loss';
    else if (pnl > 0)               type = 'take_profit';
    else                             type = 'manual';

    // 진입가: position_close의 long_price / short_price
    const entryPrice = parseFloat(
      (side === 'long' ? t.long_price : t.short_price) || '0',
    );

    // fill 가격: my_trades에서 동일 contract + 시간 가장 가까운 건 선택
    let fillPrice = 0;
    const fills = fillMap.get(contract) ?? [];
    if (fills.length) {
      const best = fills.reduce((a: any, b: any) =>
        Math.abs(Number(a.create_time) - closeTime) < Math.abs(Number(b.create_time) - closeTime) ? a : b,
      );
      fillPrice = parseFloat(best.price || '0');
    }

    // 수익률 계산
    // 1순위: entryPrice + fillPrice 모두 있을 때 가격 변화율 (방향 반영)
    // 2순위: pnl 부호만이라도 반영 (0.01% * sign)
    let profitRate = 0;
    if (entryPrice > 0 && fillPrice > 0) {
      const diff = side === 'long' ? fillPrice - entryPrice : entryPrice - fillPrice;
      profitRate  = parseFloat(((diff / entryPrice) * 100).toFixed(2));
    } else if (pnl !== 0) {
      // 가격 데이터 없음 → 부호만 표시
      profitRate = pnl < 0 ? -0.01 : 0.01;
    }

    return {
      id:         `${closeTime}_${contract}`,
      symbol:     contract.replace('_', '/'),
      direction:  side === 'long' ? 'Long' : 'Short',
      type,
      profit:     pnl * usdtKrw,
      profitRate,
      holdingDays: 0,
      entryAt:    exitAt,
      exitAt,
      entryPrice,
      exitPrice:  fillPrice > 0 ? fillPrice : entryPrice,
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
