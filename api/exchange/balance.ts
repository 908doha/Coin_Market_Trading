/**
 * Vercel Serverless Function
 * POST /api/exchange/balance
 * Body: { exchange: string, apiKey: string, apiSecret: string, passphrase?: string }
 * Returns: Balance (same shape as account.service Balance interface)
 */

import * as crypto from 'crypto';

interface Balance {
  total:           number;
  invested:        number;
  available:       number;
  profitTotal:     number;
  profitRate:      number;
  profitToday:     number;
  profitTodayRate: number;
}

// ── KRW exchange rate (fallback if live fetch fails) ─────────────────────────
async function getUsdtKrwRate(): Promise<number> {
  try {
    const res = await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT');
    const data: any[] = await res.json();
    return data[0]?.trade_price ?? 1350;
  } catch {
    return 1350;
  }
}

// ── Upbit ─────────────────────────────────────────────────────────────────────
function makeUpbitJwt(apiKey: string, apiSecret: string): string {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    access_key: apiKey,
    nonce:      crypto.randomUUID(),
  })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', apiSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function fetchUpbitBalance(apiKey: string, apiSecret: string): Promise<Balance> {
  const jwt = makeUpbitJwt(apiKey, apiSecret);
  const res = await fetch('https://api.upbit.com/v1/accounts', {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`Upbit API error: ${res.status}`);
  const accounts: any[] = await res.json();

  let krwAvailable  = 0;
  let totalKrw      = 0;

  // 원화(KRW) 잔고
  const krwAccount = accounts.find((a) => a.currency === 'KRW');
  if (krwAccount) {
    krwAvailable = parseFloat(krwAccount.balance);
    totalKrw += krwAvailable;
  }

  // 코인 잔고: avg_buy_price 기준 평가금
  const coinAccounts = accounts.filter((a) => a.currency !== 'KRW');
  let invested = 0;
  let profitTotal = 0;

  // 코인 현재가 한번에 조회
  if (coinAccounts.length) {
    const markets = coinAccounts.map((a) => `KRW-${a.currency}`).join(',');
    try {
      const priceRes = await fetch(`https://api.upbit.com/v1/ticker?markets=${markets}`);
      const prices: any[] = await priceRes.json();
      const priceMap: Record<string, number> = {};
      prices.forEach((p) => { priceMap[p.market] = p.trade_price; });

      coinAccounts.forEach((a) => {
        const market        = `KRW-${a.currency}`;
        const currentPrice  = priceMap[market] ?? 0;
        const balance       = parseFloat(a.balance) + parseFloat(a.locked);
        const avgBuyPrice   = parseFloat(a.avg_buy_price);
        const currentValue  = balance * currentPrice;
        const purchaseValue = balance * avgBuyPrice;

        invested    += purchaseValue;
        profitTotal += currentValue - purchaseValue;
        totalKrw    += currentValue;
      });
    } catch {
      // 현재가 조회 실패 시 매입가로 계산
      coinAccounts.forEach((a) => {
        const balance       = parseFloat(a.balance) + parseFloat(a.locked);
        const purchaseValue = balance * parseFloat(a.avg_buy_price);
        invested += purchaseValue;
        totalKrw += purchaseValue;
      });
    }
  }

  return {
    total:           Math.round(totalKrw),
    available:       Math.round(krwAvailable),
    invested:        Math.round(invested),
    profitTotal:     Math.round(profitTotal),
    profitRate:      invested > 0 ? parseFloat(((profitTotal / invested) * 100).toFixed(2)) : 0,
    profitToday:     0,
    profitTodayRate: 0,
  };
}

// ── Binance ───────────────────────────────────────────────────────────────────
function binanceSign(queryString: string, apiSecret: string): string {
  return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

async function fetchBinanceBalance(apiKey: string, apiSecret: string): Promise<Balance> {
  const usdtKrw   = await getUsdtKrwRate();
  const timestamp = Date.now();
  const qs        = `timestamp=${timestamp}&recvWindow=10000`;
  const signature = binanceSign(qs, apiSecret);

  const res = await fetch(`https://api.binance.com/api/v3/account?${qs}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': apiKey },
  });
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const data: any = await res.json();

  const balances: any[] = data.balances ?? [];
  let totalUsdt    = 0;
  let availableUsdt = 0;
  let lockedUsdt   = 0;

  // USDT 직접 보유
  const usdtBal = balances.find((b) => b.asset === 'USDT');
  if (usdtBal) {
    const free   = parseFloat(usdtBal.free);
    const locked = parseFloat(usdtBal.locked);
    availableUsdt += free;
    lockedUsdt    += locked;
    totalUsdt     += free + locked;
  }

  // 다른 코인 가격 조회 (USDT 환산)
  const otherBalances = balances.filter(
    (b) => b.asset !== 'USDT' &&
           (parseFloat(b.free) + parseFloat(b.locked)) > 0,
  );

  if (otherBalances.length) {
    const pricePromises = otherBalances.map(async (b) => {
      try {
        const pr = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${b.asset}USDT`);
        const pd: any = await pr.json();
        const price  = parseFloat(pd.price ?? '0');
        const amount = parseFloat(b.free) + parseFloat(b.locked);
        return amount * price;
      } catch {
        return 0;
      }
    });
    const values = await Promise.all(pricePromises);
    const otherTotal = values.reduce((s, v) => s + v, 0);
    lockedUsdt += otherTotal;
    totalUsdt  += otherTotal;
  }

  const totalKrw     = Math.round(totalUsdt     * usdtKrw);
  const availableKrw = Math.round(availableUsdt * usdtKrw);
  const investedKrw  = Math.round(lockedUsdt    * usdtKrw);

  return {
    total:           totalKrw,
    available:       availableKrw,
    invested:        investedKrw,
    profitTotal:     0,
    profitRate:      0,
    profitToday:     0,
    profitTodayRate: 0,
  };
}

// ── Bybit ─────────────────────────────────────────────────────────────────────
async function fetchBybitBalance(apiKey: string, apiSecret: string): Promise<Balance> {
  const usdtKrw   = await getUsdtKrwRate();
  const timestamp = String(Date.now());
  const recvWindow = '10000';
  const queryStr  = `accountType=UNIFIED`;
  const toSign    = `${timestamp}${apiKey}${recvWindow}${queryStr}`;
  const signature = crypto.createHmac('sha256', apiSecret).update(toSign).digest('hex');

  const res = await fetch(
    `https://api.bybit.com/v5/account/wallet-balance?${queryStr}`,
    {
      headers: {
        'X-BAPI-API-KEY':    apiKey,
        'X-BAPI-SIGN':       signature,
        'X-BAPI-TIMESTAMP':  timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
      },
    },
  );
  if (!res.ok) throw new Error(`Bybit API error: ${res.status}`);
  const data: any = await res.json();

  const account    = data?.result?.list?.[0];
  const totalUsd   = parseFloat(account?.totalEquity      ?? '0');
  const availUsd   = parseFloat(account?.totalAvailableBalance ?? '0');
  const investedUsd = totalUsd - availUsd;

  return {
    total:           Math.round(totalUsd    * usdtKrw),
    available:       Math.round(availUsd    * usdtKrw),
    invested:        Math.round(investedUsd * usdtKrw),
    profitTotal:     Math.round(parseFloat(account?.totalPerpUPL ?? '0') * usdtKrw),
    profitRate:      0,
    profitToday:     0,
    profitTodayRate: 0,
  };
}

// ── OKX ──────────────────────────────────────────────────────────────────────
async function fetchOkxBalance(apiKey: string, apiSecret: string, passphrase: string): Promise<Balance> {
  const usdtKrw   = await getUsdtKrwRate();
  const timestamp = new Date().toISOString();
  const method    = 'GET';
  const path      = '/api/v5/account/balance';
  const toSign    = `${timestamp}${method}${path}`;
  const signature = crypto.createHmac('sha256', apiSecret).update(toSign).digest('base64');

  const res = await fetch(`https://www.okx.com${path}`, {
    headers: {
      'OK-ACCESS-KEY':        apiKey,
      'OK-ACCESS-SIGN':       signature,
      'OK-ACCESS-TIMESTAMP':  timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase,
    },
  });
  if (!res.ok) throw new Error(`OKX API error: ${res.status}`);
  const data: any = await res.json();

  const details    = data?.data?.[0]?.details ?? [];
  let totalUsd = 0, availUsd = 0;
  details.forEach((d: any) => {
    const usdVal  = parseFloat(d.eqUsd ?? '0');
    const avlBal  = parseFloat(d.availEq ?? '0');
    totalUsd += usdVal;
    availUsd += avlBal;
  });

  return {
    total:           Math.round(totalUsd               * usdtKrw),
    available:       Math.round(availUsd               * usdtKrw),
    invested:        Math.round((totalUsd - availUsd)  * usdtKrw),
    profitTotal:     0,
    profitRate:      0,
    profitToday:     0,
    profitTodayRate: 0,
  };
}

// ── Gate.io HMAC 서명 헬퍼 ───────────────────────────────────────────────────
function gateSign(apiSecret: string, method: string, path: string, queryStr: string, timestamp: string): string {
  const bodyHash = crypto.createHash('sha512').update('').digest('hex');
  const toSign   = `${method}\n${path}\n${queryStr}\n${bodyHash}\n${timestamp}`;
  return crypto.createHmac('sha512', apiSecret).update(toSign).digest('hex');
}

function gateHeaders(apiKey: string, sig: string, timestamp: string) {
  return { KEY: apiKey, SIGN: sig, Timestamp: timestamp };
}

// ── Gate.io (spot + futures 합산) ─────────────────────────────────────────────
async function fetchGateBalance(apiKey: string, apiSecret: string): Promise<Balance> {
  const usdtKrw = await getUsdtKrwRate();
  const ts      = String(Math.floor(Date.now() / 1000));

  // ① Spot 잔고
  let spotTotalUsdt = 0;
  let spotAvailUsdt = 0;
  try {
    const spotPath = '/api/v4/spot/accounts';
    const spotSig  = gateSign(apiSecret, 'GET', spotPath, '', ts);
    const spotRes  = await fetch(`https://api.gateio.ws${spotPath}`, { headers: gateHeaders(apiKey, spotSig, ts) });
    if (spotRes.ok) {
      const accounts: any[] = await spotRes.json();
      const usdtAcct = accounts.find((a) => a.currency === 'USDT');
      if (usdtAcct) {
        spotAvailUsdt = parseFloat(usdtAcct.available ?? '0');
        spotTotalUsdt = spotAvailUsdt + parseFloat(usdtAcct.locked ?? '0');
      }
      // 다른 코인 spot 평가
      const others = accounts.filter(
        (a) => a.currency !== 'USDT' && (parseFloat(a.available ?? '0') + parseFloat(a.locked ?? '0')) > 0,
      );
      if (others.length) {
        const pairs = others.map((a) => `${a.currency}_USDT`).join(',');
        const pr = await fetch(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pairs}`).catch(() => null);
        if (pr?.ok) {
          const tickers: any[] = await pr.json();
          const pm: Record<string, number> = {};
          tickers.forEach((t) => { pm[t.currency_pair] = parseFloat(t.last ?? '0'); });
          others.forEach((a) => {
            const amount = parseFloat(a.available ?? '0') + parseFloat(a.locked ?? '0');
            spotTotalUsdt += amount * (pm[`${a.currency}_USDT`] ?? 0);
          });
        }
      }
    }
  } catch {}

  // ② USDT 선물 잔고
  let futuresAvailUsdt = 0;
  let futuresTotalUsdt = 0;
  let futuresPnl       = 0;
  try {
    const futPath = '/api/v4/futures/usdt/accounts';
    const futSig  = gateSign(apiSecret, 'GET', futPath, '', ts);
    const futRes  = await fetch(`https://api.gateio.ws${futPath}`, { headers: gateHeaders(apiKey, futSig, ts) });
    if (futRes.ok) {
      const fut: any = await futRes.json();
      // total: 총 자산, available: 가용 마진, unrealised_pnl: 미실현 손익
      futuresTotalUsdt = parseFloat(fut.total         ?? '0');
      futuresAvailUsdt = parseFloat(fut.available     ?? '0');
      futuresPnl       = parseFloat(fut.unrealised_pnl ?? '0');
    }
  } catch {}

  const totalUsdt  = spotTotalUsdt  + futuresTotalUsdt;
  const availUsdt  = spotAvailUsdt  + futuresAvailUsdt;
  const investedUsdt = totalUsdt - availUsdt;

  return {
    total:           Math.round(totalUsdt    * usdtKrw),
    available:       Math.round(availUsdt    * usdtKrw),
    invested:        Math.round(Math.max(0, investedUsdt) * usdtKrw),
    profitTotal:     Math.round(futuresPnl   * usdtKrw),
    profitRate:      futuresTotalUsdt > 0
      ? parseFloat(((futuresPnl / futuresTotalUsdt) * 100).toFixed(2))
      : 0,
    profitToday:     0,
    profitTodayRate: 0,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { exchange, apiKey, apiSecret, passphrase } = req.body ?? {};
  if (!exchange || !apiKey || !apiSecret) {
    res.status(400).json({ error: 'exchange, apiKey, apiSecret required' });
    return;
  }

  try {
    let balance: Balance;
    switch (exchange) {
      case 'upbit':
        balance = await fetchUpbitBalance(apiKey, apiSecret);
        break;
      case 'binance':
        balance = await fetchBinanceBalance(apiKey, apiSecret);
        break;
      case 'bybit':
        balance = await fetchBybitBalance(apiKey, apiSecret);
        break;
      case 'okx':
        balance = await fetchOkxBalance(apiKey, apiSecret, passphrase ?? '');
        break;
      case 'gate':
        balance = await fetchGateBalance(apiKey, apiSecret);
        break;
      default:
        res.status(400).json({ error: `Unsupported exchange: ${exchange}` });
        return;
    }
    res.status(200).json(balance);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? 'Exchange API error' });
  }
}
