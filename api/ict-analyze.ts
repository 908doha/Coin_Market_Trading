/**
 * Vercel Serverless Function
 * POST /api/ict-analyze
 * Body: { apiKey, apiSecret, contract }
 *
 * ICT 분석 직접 실행 (봇 서버 의존 없음)
 * Gate.io에서 4h/15m/5m 캔들을 병렬로 가져와 HTF→MTF→LTF 분석
 */

import crypto from 'crypto';
import {
  CFG, parseCandles,
  analyzeHTF, analyzeMTF, analyzeLTF,
  getActiveSession, calcSLTP, calcScore,
} from './_ict';

// ─── Gate.io 서명 / 요청 ──────────────────────────────────────────────────────

function gateSign(secret: string, method: string, path: string, query: string, ts: string): string {
  const bodyHash = crypto.createHash('sha512').update('').digest('hex');
  return crypto.createHmac('sha512', secret)
    .update(`${method}\n${path}\n${query}\n${bodyHash}\n${ts}`)
    .digest('hex');
}

async function gateGet(apiKey: string, apiSecret: string, path: string, query: string): Promise<any> {
  const method = 'GET';
  const ts  = Math.floor(Date.now() / 1000).toString();
  const sig = gateSign(apiSecret, method, path, query, ts);
  const url = `https://api.gateio.ws${path}${query ? '?' + query : ''}`;
  const res = await fetch(url, {
    method,
    headers: { KEY: apiKey, Timestamp: ts, SIGN: sig, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Gate.io ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── 핸들러 ───────────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { apiKey, apiSecret, contract } = req.body ?? {};
  if (!apiKey || !apiSecret || !contract) {
    res.status(400).json({ error: 'apiKey, apiSecret, contract 필요' }); return;
  }

  try {
    // Gate.io 캔들 병렬 fetch
    const [htfRaw, mtfRaw, ltfRaw] = await Promise.all([
      gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/candlesticks', `contract=${contract}&interval=4h&limit=200`),
      gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/candlesticks', `contract=${contract}&interval=15m&limit=200`),
      gateGet(apiKey, apiSecret, '/api/v4/futures/usdt/candlesticks', `contract=${contract}&interval=5m&limit=100`),
    ]);

    const htfC = parseCandles(htfRaw);
    const mtfC = parseCandles(mtfRaw);
    const ltfC = parseCandles(ltfRaw);

    if (!htfC.length || !mtfC.length || !ltfC.length) {
      res.status(200).json({ error: '캔들 데이터 없음' }); return;
    }

    const currentPrice = ltfC[ltfC.length - 1].close;
    const session      = getActiveSession();

    // 3단계 분석
    const htf = analyzeHTF(htfC);
    const mtf = analyzeMTF(mtfC, htf.direction);
    const ltf = analyzeLTF(ltfC, htf.direction, session);

    // SL/TP + 신호
    let signal: string | null = null;
    let reason = '';
    let entry: number | null = null;
    let sl: number | null = null;
    let tp: number | null = null;
    let rr: string | null = null;
    const confluence: string[] = [...mtf.confluence, ...ltf.confluence];

    if (htf.direction && mtf.confirmed && ltf.ready) {
      signal = htf.direction === 'bullish' ? 'long' : 'short';
      entry  = currentPrice;
      const sltp = calcSLTP(currentPrice, htf.direction, mtf.relOBs, ltf.swingHighs, ltf.swingLows, htf.pdhl);
      sl = sltp.sl; tp = sltp.tp;
      reason = `ICT v2 ${signal.toUpperCase()} — ${confluence.length}개 컨플루언스`;
      rr = Math.abs(tp - entry) / Math.abs(entry - sl) > 0
        ? (Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2) : null;
    } else {
      reason = !htf.direction  ? 'HTF 방향 불명확'
             : !mtf.confirmed  ? 'MTF 구조 미확인'
             :                   'LTF 진입 미충족';
    }

    const { score, grade } = calcScore(htf, mtf, ltf, session);

    // Session 레인지
    const sessions = Object.values(ltf.sessionRanges).map((sr: any) => ({
      name: sr.name, low: sr.low, high: sr.high,
      sweep: !!(sr.highSweep || sr.lowSweep),
    }));

    res.status(200).json({
      contract,
      currentPrice,
      session: { active: session.active, name: session.name },
      htf: {
        timeframe: CFG.timeframes.htf,
        direction: htf.direction ? htf.direction.toUpperCase() : null,
        structure: htf.structure,
        swingHigh: htf.swingHighs.length > 0 ? htf.swingHighs[htf.swingHighs.length - 1].price : null,
        swingLow:  htf.swingLows.length  > 0 ? htf.swingLows[htf.swingLows.length - 1].price  : null,
        pdh:       htf.pdhl?.pdh ?? null,
        pdl:       htf.pdhl?.pdl ?? null,
        pdhSweep:  htf.pdhl?.pdhSweep ?? false,
        pdlSweep:  htf.pdhl?.pdlSweep ?? false,
        ob:  { bull: htf.obs.bullish.length, bear: htf.obs.bearish.length },
        fvg: {
          bull:     htf.fvgs.bullish.filter(f => !f.isFilled).length,
          bear:     htf.fvgs.bearish.filter(f => !f.isFilled).length,
          lastBull: htf.lastBullFVG ? { ce: htf.lastBullFVG.ce, fillPct: htf.lastBullFVG.fillPercent } : null,
          lastBear: htf.lastBearFVG ? { ce: htf.lastBearFVG.ce, fillPct: htf.lastBearFVG.fillPercent } : null,
        },
        inPOI:   htf.inPOI,
        poiType: htf.poiType,
      },
      mtf: {
        timeframe: CFG.timeframes.mtf,
        mss: { found: !!mtf.mss, label: mtf.mss ?? undefined },
        ob:  { bull: mtf.obs.bullish.length, bear: mtf.obs.bearish.length },
        fvg: {
          bull:     mtf.fvgs.bullish.filter(f => !f.isFilled).length,
          bear:     mtf.fvgs.bearish.filter(f => !f.isFilled).length,
          lastBull: mtf.lastBullFVG ? { ce: mtf.lastBullFVG.ce, fillPct: mtf.lastBullFVG.fillPercent } : null,
          lastBear: mtf.lastBearFVG ? { ce: mtf.lastBearFVG.ce, fillPct: mtf.lastBearFVG.fillPercent } : null,
        },
      },
      ltf: {
        timeframe: CFG.timeframes.ltf,
        fvgCE:   ltf.fvgCE,
        fvgFill: ltf.fvgFill,
        iofed:   ltf.iofed,
      },
      sessions,
      summary: { signal, reason, confluence, entry, sl, tp, rr },
      score,
      grade,
    });
  } catch (err: any) {
    console.error('[ict-analyze]', err);
    res.status(502).json({ error: err?.message ?? 'Internal error' });
  }
}
