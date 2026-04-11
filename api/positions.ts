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
  accountId?:    string;
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
  stopLoss?:     number;   // USD — Gate.io 조건부 주문
  targetPrice?:  number;   // USD — Gate.io 조건부 주문
  openTime?:     number;   // Unix timestamp (seconds) — 진입 시각
}

// ── Gate.io API 헬퍼 ─────────────────────────────────────────────────────────

function gateSign(apiSecret: string, method: string, path: string, query: string, ts: string): string {
  const bodyHash = crypto.createHash('sha512').update('').digest('hex');
  return crypto.createHmac('sha512', apiSecret)
    .update(`${method}\n${path}\n${query}\n${bodyHash}\n${ts}`)
    .digest('hex');
}

async function gateGet(apiKey: string, apiSecret: string, path: string, query: string): Promise<any[]> {
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

// ── Gate.io TP/SL 조건부 주문 조회 ───────────────────────────────────────────
// /api/v4/futures/usdt/price_orders (trigger orders) 에서 reduce-only 주문으로 TP/SL 판별

async function fetchGatePriceOrders(apiKey: string, apiSecret: string): Promise<Map<string, { tp: number | null; sl: number | null }>> {
  const result = new Map<string, { tp: number | null; sl: number | null }>();
  try {
    const orders: any[] = await gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/price_orders', 'status=open');
    for (const o of orders) {
      const contract = o.initial?.contract ?? o.contract as string;
      if (!contract) continue;
      // reduce_only 또는 close 플래그가 있는 주문만 TP/SL
      if (!o.initial?.reduce_only && !o.initial?.close && !o.initial?.auto_size) continue;
      const triggerPrice = parseFloat(o.trigger?.price ?? '0');
      if (!triggerPrice) continue;

      if (!result.has(contract)) result.set(contract, { tp: null, sl: null });
      const entry = result.get(contract)!;
      // auto_size: "close_long" → Long포지션 청산 주문; rule 1(>=) → TP, 2(<=) → SL
      // auto_size: "close_short" → Short포지션 청산 주문; rule 2(<=) → TP, 1(>=) → SL
      const rule      = o.trigger?.rule as number;  // 1 = >=, 2 = <=
      const autoSize  = o.initial?.auto_size as string ?? '';

      if (autoSize === 'close_long') {
        // Long 포지션 청산: rule=1(>=) 이면 위에서 청산 → TP, rule=2(<=) 이면 아래서 청산 → SL
        if (rule === 1) { if (!entry.tp || triggerPrice > entry.tp) entry.tp = triggerPrice; }
        else            { if (!entry.sl || triggerPrice > entry.sl) entry.sl = triggerPrice; }
      } else if (autoSize === 'close_short') {
        // Short 포지션 청산: rule=2(<=) 이면 아래서 청산 → TP, rule=1(>=) 이면 위에서 청산 → SL
        if (rule === 2) { if (!entry.tp || triggerPrice < entry.tp) entry.tp = triggerPrice; }
        else            { if (!entry.sl || triggerPrice < entry.sl) entry.sl = triggerPrice; }
      } else {
        // auto_size 없을 때: size 부호로 판별
        const size = Number(o.initial?.size ?? 0);
        if (size < 0) {  // sell = Long 청산
          if (rule === 1) { if (!entry.tp || triggerPrice > entry.tp) entry.tp = triggerPrice; }
          else            { if (!entry.sl || triggerPrice > entry.sl) entry.sl = triggerPrice; }
        } else {  // buy = Short 청산
          if (rule === 2) { if (!entry.tp || triggerPrice < entry.tp) entry.tp = triggerPrice; }
          else            { if (!entry.sl || triggerPrice < entry.sl) entry.sl = triggerPrice; }
        }
      }
    }
  } catch { /* TP/SL 조회 실패시 빈 Map 반환 */ }
  return result;
}

// ── Gate.io 선물 포지션 조회 ───────────────────────────────────────────────────

async function fetchGatePositions(apiKey: string, apiSecret: string): Promise<Position[]> {
  // 포지션, TP/SL 주문, USDT 환율 병렬 조회
  const [data, priceOrders, usdtKrwRaw] = await Promise.all([
    gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/positions', ''),
    fetchGatePriceOrders(apiKey, apiSecret),
    fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT')
      .then(r => r.json()).then(([t]: any) => t.trade_price as number)
      .catch(() => 1350),
  ]);

  const usdtKrw: number = usdtKrwRaw;

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

      const tpsl = priceOrders.get(contract);

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
        ...(tpsl?.tp ? { targetPrice: tpsl.tp } : {}),
        ...(tpsl?.sl ? { stopLoss:    tpsl.sl } : {}),
        ...(p.open_time ? { openTime: p.open_time } : {}),
      };
    });
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { exchange, apiKey, apiSecret, accountId } = req.body ?? {};
  if (!apiKey || !apiSecret) {
    res.status(400).json({ error: 'apiKey, apiSecret 필요' });
    return;
  }

  try {
    let positions: Position[] = [];

    if (exchange === 'gate') {
      positions = await fetchGatePositions(apiKey, apiSecret);
    }

    // accountId가 있으면 각 포지션에 주입
    if (accountId) {
      positions = positions.map((p) => ({ ...p, accountId }));
    }

    res.status(200).json(positions);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? 'Internal error' });
  }
}
