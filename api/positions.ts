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

// ── Gate.io 청산 트리거 가격 수집 ─────────────────────────────────────────────
// price_orders(조건부) + orders(지정가 reduce_only) 두 엔드포인트에서 트리거 가격을 모두 수집.
// TP/SL 분류는 여기서 하지 않고 fetchGatePositions에서 진입가+방향 기준으로 처리.

async function fetchClosePrices(
  apiKey: string,
  apiSecret: string,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();

  const add = (contract: string, price: number) => {
    if (!price || !contract) return;
    if (!result.has(contract)) result.set(contract, []);
    result.get(contract)!.push(price);
  };

  await Promise.all([
    // ① 조건부 주문 (price_orders) — 모든 open 주문 수집, 플래그 필터 없음
    gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/price_orders', 'status=open')
      .then((orders: any[]) => {
        for (const o of orders) {
          const contract     = o.initial?.contract ?? (o.contract as string);
          const triggerPrice = parseFloat(o.trigger?.price ?? '0');
          add(contract, triggerPrice);
        }
      })
      .catch(() => {}),

    // ② 일반 지정가/시장가 주문 중 reduce_only=true (포지션 청산용 limit 주문)
    gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/orders', 'status=open')
      .then((orders: any[]) => {
        for (const o of orders) {
          if (!o.reduce_only && !o.close) continue;
          const contract = o.contract as string;
          const price    = parseFloat(o.price ?? '0');
          add(contract, price);
        }
      })
      .catch(() => {}),
  ]);

  return result;
}

// 트리거 가격 목록과 진입가+방향으로 TP/SL 분류
function classifyTpSl(
  prices: number[],
  entryPrice: number,
  isLong: boolean,
): { tp: number | null; sl: number | null } {
  let tp: number | null = null;
  let sl: number | null = null;
  for (const p of prices) {
    if (isLong) {
      // 롱: 진입가 위 → TP, 진입가 아래 → SL (가장 가까운 값)
      if (p > entryPrice) { if (!tp || p < tp) tp = p; }
      else                { if (!sl || p > sl) sl = p; }
    } else {
      // 숏: 진입가 아래 → TP, 진입가 위 → SL (가장 가까운 값)
      if (p < entryPrice) { if (!tp || p > tp) tp = p; }
      else                { if (!sl || p < sl) sl = p; }
    }
  }
  return { tp, sl };
}

// ── Gate.io 선물 포지션 조회 ───────────────────────────────────────────────────

async function fetchGatePositions(apiKey: string, apiSecret: string): Promise<Position[]> {
  // 포지션, 청산 트리거 가격, USDT 환율 병렬 조회
  const [data, closePrices, usdtKrwRaw] = await Promise.all([
    gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/positions', ''),
    fetchClosePrices(apiKey, apiSecret),
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
      const rawTime    = p.open_time || p.update_time || 0;
      const openTime   = rawTime ? new Date(rawTime * 1000) : null;
      const holdingMs  = openTime ? Date.now() - openTime.getTime() : 0;
      const holdingDays  = Math.floor(holdingMs / (1000 * 60 * 60 * 24));
      const holdingHours = Math.floor((holdingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const holdingMins  = Math.floor((holdingMs % (1000 * 60 * 60)) / (1000 * 60));
      const holdingPeriod = holdingDays > 0
        ? `${holdingDays}일 ${holdingHours}시간 ${holdingMins}분`
        : holdingHours > 0
          ? `${holdingHours}시간 ${holdingMins}분`
          : holdingMins > 0 ? `${holdingMins}분` : '1분 미만';

      const DOW = ['일', '월', '화', '수', '목', '금', '토'];
      // KST = UTC+9 (한국 표준시, DST 없음) — Vercel 서버는 UTC이므로 명시적 변환
      const kst = openTime ? new Date(openTime.getTime() + 9 * 3_600_000) : null;
      const entryAt = kst
        ? `${kst.getUTCFullYear()}.${String(kst.getUTCMonth()+1).padStart(2,'0')}.${String(kst.getUTCDate()).padStart(2,'0')} (${DOW[kst.getUTCDay()]}) ${String(kst.getUTCHours()).padStart(2,'0')}:${String(kst.getUTCMinutes()).padStart(2,'0')}`
        : '-';

      const isLong = size > 0;

      // 수집된 트리거 가격을 진입가+방향 기준으로 TP/SL 분류
      const rawPrices  = closePrices.get(contract) ?? [];
      const fromOrders = classifyTpSl(rawPrices, entryPrice, isLong);

      // 포지션 레벨 TP/SL (Gate.io가 직접 포지션 응답에 포함하는 필드)
      const posLvlTp = parseFloat(p.take_profit || '0') || null;
      const posLvlSl = parseFloat(p.stop_loss   || '0') || null;

      // 우선순위: 포지션 레벨 → 주문 기반 → 없음
      // 포지션 레벨 TP/SL이 더 직접적이므로 우선 적용
      const finalTp = posLvlTp ?? fromOrders.tp;
      const finalSl = posLvlSl ?? fromOrders.sl;

      return {
        id:           p.contract + '_' + (p.open_time || p.update_time || Date.now()),
        symbol:       contract.replace('_', '/'),
        coin,
        direction:    isLong ? 'Long' : 'Short',
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
        ...(finalTp ? { targetPrice: finalTp } : {}),
        ...(finalSl ? { stopLoss:    finalSl } : {}),
      };
    });
}

// ── Binance USDT-M Futures ───────────────────────────────────────────────────

function binanceSign(query: string, apiSecret: string): string {
  return crypto.createHmac('sha256', apiSecret).update(query).digest('hex');
}

async function binanceFapiGet(apiKey: string, apiSecret: string, path: string): Promise<any> {
  const ts  = Date.now();
  const qs  = `timestamp=${ts}&recvWindow=10000`;
  const sig = binanceSign(qs, apiSecret);
  const url = `https://fapi.binance.com${path}?${qs}&signature=${sig}`;
  const res = await fetch(url, { headers: { 'X-MBX-APIKEY': apiKey, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Binance ${path} error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchBinancePositions(apiKey: string, apiSecret: string): Promise<Position[]> {
  // 환율
  let usdtKrw = 1350;
  try {
    const [t] = await (await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT')).json();
    usdtKrw = t.trade_price;
  } catch {}

  // /fapi/v2/positionRisk: 모든 심볼 (열린 + 닫힌). 열린 포지션만 필터.
  const all = await binanceFapiGet(apiKey, apiSecret, '/fapi/v2/positionRisk') as any[];
  const open = (Array.isArray(all) ? all : []).filter((p) => parseFloat(p.positionAmt ?? '0') !== 0);
  if (!open.length) return [];

  // 진입 시각 추정용: /fapi/v1/userTrades 는 심볼당 호출이라 비쌈 → updateTime 사용.
  // (Binance 는 positionRisk 응답에 updateTime 을 ms 로 줌)
  return open.map((p) => {
    const symbol     = String(p.symbol ?? '');
    const coin       = symbol.replace(/USDT$/, '').replace(/USDC$/, '');
    const size       = parseFloat(p.positionAmt ?? '0');
    const isLong     = size > 0;
    const entryPrice = parseFloat(p.entryPrice ?? '0') || 0;
    const markPrice  = parseFloat(p.markPrice  ?? '0') || 0;
    const leverage   = parseInt(p.leverage     ?? '1', 10) || 1;
    const liqPrice   = parseFloat(p.liquidationPrice ?? '0') || 0;
    const unrealUsdt = parseFloat(p.unRealizedProfit ?? '0') || 0;

    const notionalUsdt = Math.abs(size) * entryPrice;
    const marginUsdt   = leverage > 0 ? notionalUsdt / leverage : notionalUsdt;
    const profitKrw    = Math.round(unrealUsdt * usdtKrw);
    const marginKrw    = Math.round(marginUsdt * usdtKrw);
    const notionalKrw  = Math.round(notionalUsdt * usdtKrw);
    const profitRate   = marginUsdt > 0 ? (unrealUsdt / marginUsdt) * 100 : 0;

    const updateTimeMs = Number(p.updateTime ?? 0);
    const entryAt      = updateTimeMs > 0 ? new Date(updateTimeMs).toISOString() : new Date().toISOString();

    // 보유기간 텍스트 (Gate 와 동일 포맷 가깝게)
    const elapsedSec = updateTimeMs > 0 ? (Date.now() - updateTimeMs) / 1000 : 0;
    const holdingPeriod =
      elapsedSec < 3600           ? `${Math.max(1, Math.floor(elapsedSec / 60))}분`        :
      elapsedSec < 86400          ? `${Math.floor(elapsedSec / 3600)}시간`                 :
                                    `${Math.floor(elapsedSec / 86400)}일`;

    // 위험도 1-5 (Gate 와 동일하게 손익률 절댓값 기반 단순 분류)
    const r = Math.abs(profitRate);
    const riskLevel: 1 | 2 | 3 | 4 | 5 =
      r < 5 ? 1 : r < 15 ? 2 : r < 30 ? 3 : r < 60 ? 4 : 5;

    return {
      id:            symbol + '_' + (updateTimeMs || Date.now()),
      symbol:        coin + '/USDT',
      coin,
      direction:     isLong ? 'Long' : 'Short',
      amount:        marginKrw,
      profit:        profitKrw,
      profitRate:    parseFloat(profitRate.toFixed(2)),
      entryPrice,
      markPrice,
      leverage,
      currentPrice:  markPrice,
      currentValue:  notionalKrw,
      weight:        100,
      entryAt,
      holdingPeriod,
      riskLevel,
      liqPrice,
      size:          Math.abs(size),
      usdtKrw,
    } as Position;
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
    } else if (exchange === 'binance') {
      positions = await fetchBinancePositions(apiKey, apiSecret);
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
