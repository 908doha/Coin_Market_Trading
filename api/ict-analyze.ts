/**
 * Vercel Serverless Function
 * POST /api/ict-analyze
 * Body: { apiKey, apiSecret, contract }
 *
 * ICT 분석 직접 실행 (봇 서버 의존 없음)
 * Gate.io에서 4h/15m/5m 캔들을 병렬로 가져와 HTF→MTF→LTF 분석
 */

import crypto from 'crypto';

// ─── 설정 ────────────────────────────────────────────────────────────────────

const CFG = {
  timeframes: { htf: '4h', mtf: '15m', ltf: '5m' },
  ict: {
    orderBlockLookback: 50,
    structureShiftBars: 5,
    fvgMinGapPercent:   0.05,
    fvgCeThreshold:     0.01,
    iofedMinBars:       3,
    stopLossPercent:    2,
  },
  sessions: {
    asian:  { name: 'Asian',    am: { start: '00:00', end: '03:00' }, pm: { start: '04:00', end: '06:30' }, full: { start: '00:00', end: '06:30' } },
    london: { name: 'London',   am: { start: '07:00', end: '10:30' }, pm: { start: '11:30', end: '14:00' }, full: { start: '07:00', end: '14:00' } },
    ny:     { name: 'New York', am: { start: '13:30', end: '16:00' }, pm: { start: '17:00', end: '19:30' }, full: { start: '13:30', end: '19:30' } },
  },
};

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface Candle {
  timestamp: number;
  open:  number;
  high:  number;
  low:   number;
  close: number;
}

interface SwingPoint { index: number; price: number; timestamp: number; }

interface OBBlock {
  index: number; high: number; low: number; mid: number; timestamp: number;
}

interface FVGap {
  index: number; top: number; bottom: number; ce: number;
  gapPercent: number; fillPercent: number; isFilled: boolean;
  timestamp: number; atCE: boolean; inRange: boolean;
}

interface SessionInfo {
  active: boolean;
  session: string | null;
  name: string;
  reason?: string;
}

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

// ─── 캔들 변환 ────────────────────────────────────────────────────────────────

function parseCandles(raw: any[]): Candle[] {
  return raw
    .map((c: any) => ({
      timestamp: Number(c.t) * 1000,
      open:  parseFloat(c.o),
      high:  parseFloat(c.h),
      low:   parseFloat(c.l),
      close: parseFloat(c.c),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

// ─── 지표 함수 ────────────────────────────────────────────────────────────────

function findSwingHighs(candles: Candle[], lookback = 5): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let ok = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        ok = false; break;
      }
    }
    if (ok) out.push({ index: i, price: candles[i].high, timestamp: candles[i].timestamp });
  }
  return out;
}

function findSwingLows(candles: Candle[], lookback = 5): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let ok = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        ok = false; break;
      }
    }
    if (ok) out.push({ index: i, price: candles[i].low, timestamp: candles[i].timestamp });
  }
  return out;
}

function detectMSS(candles: Candle[], swingHighs: SwingPoint[], swingLows: SwingPoint[]): string | null {
  if (swingHighs.length < 2 || swingLows.length < 2 || candles.length < 2) return null;
  const last  = candles[candles.length - 1];
  const prev  = candles[candles.length - 2];
  const recentH = swingHighs[swingHighs.length - 1];
  const recentL = swingLows[swingLows.length - 1];

  if (recentL.index > recentH.index) {
    if (last.close > recentH.price && prev.close <= recentH.price) return 'bullish';
  }
  if (recentH.index > recentL.index) {
    if (last.close < recentL.price && prev.close >= recentL.price) return 'bearish';
  }
  return null;
}

function findOrderBlocks(candles: Candle[]): { bullish: OBBlock[]; bearish: OBBlock[] } {
  const out: { bullish: OBBlock[]; bearish: OBBlock[] } = { bullish: [], bearish: [] };
  const start = Math.max(0, candles.length - CFG.ict.orderBlockLookback);

  for (let i = start + 2; i < candles.length; i++) {
    const p = candles[i - 1];
    const c = candles[i];

    if (p.close < p.open && c.close > c.open && (c.close - c.open) / c.open > 0.002) {
      out.bullish.push({ index: i - 1, high: p.open, low: p.close, mid: (p.open + p.close) / 2, timestamp: p.timestamp });
    }
    if (p.close > p.open && c.close < c.open && (c.open - c.close) / c.open > 0.002) {
      out.bearish.push({ index: i - 1, high: p.close, low: p.open, mid: (p.open + p.close) / 2, timestamp: p.timestamp });
    }
  }
  return out;
}

function findFVGs(candles: Candle[]): { bullish: FVGap[]; bearish: FVGap[] } {
  const out: { bullish: FVGap[]; bearish: FVGap[] } = { bullish: [], bearish: [] };
  const start = Math.max(0, candles.length - CFG.ict.orderBlockLookback);
  const curP  = candles[candles.length - 1].close;
  const minG  = CFG.ict.fvgMinGapPercent / 100;

  for (let i = start + 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];

    // Bullish FVG: c1.high < c3.low
    if (c1.high < c3.low && (c3.low - c1.high) / c2.close >= minG) {
      const top = c3.low; const bot = c1.high; const ce = (top + bot) / 2;
      let fill = top;
      for (let k = i + 1; k < candles.length; k++) if (candles[k].low < fill) fill = candles[k].low;
      const pct = fill <= bot ? 100 : Math.max(0, ((top - fill) / (top - bot)) * 100);
      out.bullish.push({
        index: i - 1, top, bottom: bot, ce,
        gapPercent: (c3.low - c1.high) / c2.close * 100,
        fillPercent: parseFloat(pct.toFixed(1)), isFilled: pct >= 100,
        timestamp: c2.timestamp,
        atCE:    Math.abs(curP - ce) / ce <= CFG.ict.fvgCeThreshold,
        inRange: curP >= bot && curP <= top,
      });
    }

    // Bearish FVG: c1.low > c3.high
    if (c1.low > c3.high && (c1.low - c3.high) / c2.close >= minG) {
      const top = c1.low; const bot = c3.high; const ce = (top + bot) / 2;
      let fill = bot;
      for (let k = i + 1; k < candles.length; k++) if (candles[k].high > fill) fill = candles[k].high;
      const pct = fill >= top ? 100 : Math.max(0, ((fill - bot) / (top - bot)) * 100);
      out.bearish.push({
        index: i - 1, top, bottom: bot, ce,
        gapPercent: (c1.low - c3.high) / c2.close * 100,
        fillPercent: parseFloat(pct.toFixed(1)), isFilled: pct >= 100,
        timestamp: c2.timestamp,
        atCE:    Math.abs(curP - ce) / ce <= CFG.ict.fvgCeThreshold,
        inRange: curP >= bot && curP <= top,
      });
    }
  }
  return out;
}

function detectIOFED(candles: Candle[]): Array<{ type: string; index: number; consecutiveBars: number; timestamp: number }> {
  const out: Array<{ type: string; index: number; consecutiveBars: number; timestamp: number }> = [];
  const min = CFG.ict.iofedMinBars;
  const len = candles.length;
  if (len < min + 2) return out;

  for (let i = Math.max(0, len - 30) + min; i < len; i++) {
    const c = candles[i];
    let bears = 0;
    for (let j = 1; j <= Math.min(min + 5, i); j++) {
      if (candles[i - j].close < candles[i - j].open) bears++;
      else break;
    }
    let bulls = 0;
    for (let j = 1; j <= Math.min(min + 5, i); j++) {
      if (candles[i - j].close > candles[i - j].open) bulls++;
      else break;
    }
    if (c.close > c.open && bears >= min)
      out.push({ type: 'bullish', index: i, consecutiveBars: bears, timestamp: c.timestamp });
    if (c.close < c.open && bulls >= min)
      out.push({ type: 'bearish', index: i, consecutiveBars: bulls, timestamp: c.timestamp });
  }
  return out;
}

function calculatePDHL(candles: Candle[]) {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  let pdh = -Infinity, pdl = Infinity, hasPrev = false;
  const last = candles[candles.length - 1];

  for (const c of candles) {
    const t = new Date(c.timestamp);
    if (t >= yesterdayStart && t < todayStart) {
      if (c.high > pdh) pdh = c.high;
      if (c.low  < pdl) pdl = c.low;
      hasPrev = true;
    }
  }
  if (!hasPrev) return null;
  return {
    pdh, pdl,
    pdhSweep: last.high > pdh && last.close < pdh,
    pdlSweep: last.low  < pdl && last.close > pdl,
  };
}

function calculateSessionRanges(candles: Candle[]): Record<string, any> {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const last = candles[candles.length - 1];
  const ranges: Record<string, any> = {};

  for (const [key, sess] of Object.entries(CFG.sessions)) {
    const toMs = (t: string) => { const [h, m] = t.split(':').map(Number); return (h * 60 + m) * 60000; };
    const sStart = new Date(todayStart.getTime() + toMs(sess.full.start));
    const sEnd   = new Date(todayStart.getTime() + toMs(sess.full.end));
    let high = -Infinity, low = Infinity, hasData = false;

    for (const c of candles) {
      const t = new Date(c.timestamp);
      if (t >= sStart && t < sEnd) {
        if (c.high > high) high = c.high;
        if (c.low  < low)  low  = c.low;
        hasData = true;
      }
    }
    if (hasData && high !== -Infinity) {
      ranges[key] = {
        name: sess.name, high, low, mid: (high + low) / 2,
        highSweep: last.high > high && last.close < high,
        lowSweep:  last.low  < low  && last.close > low,
      };
    }
  }
  return ranges;
}

function detectLiquiditySweep(candles: Candle[], swingHighs: SwingPoint[], swingLows: SwingPoint[]) {
  const out: Array<{ type: string; level: number }> = [];
  if (candles.length < 2) return out;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  for (const sh of swingHighs.slice(-3)) {
    if (last.high > sh.price && last.close < sh.price && prev.close < sh.price)
      out.push({ type: 'bearish', level: sh.price });
  }
  for (const sl of swingLows.slice(-3)) {
    if (last.low < sl.price && last.close > sl.price && prev.close > sl.price)
      out.push({ type: 'bullish', level: sl.price });
  }
  return out;
}

function getActiveSession(now: Date = new Date()): SessionInfo {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return { active: false, session: null, name: '주말', reason: '주말' };

  const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();

  for (const [key, sess] of Object.entries(CFG.sessions)) {
    const amS = toMins(sess.am.start), amE = toMins(sess.am.end);
    const pmS = toMins(sess.pm.start), pmE = toMins(sess.pm.end);
    if (cur >= amS && cur < amE) return { active: true,  session: key, name: `${sess.name} AM` };
    if (cur >= pmS && cur < pmE) return { active: true,  session: key, name: `${sess.name} PM` };
    if (cur >= amE && cur < pmS) return { active: false, session: key, name: `${sess.name} 점심`, reason: '점심시간' };
  }
  return { active: false, session: null, name: '세션 외', reason: '세션 외 시간' };
}

// ─── 3단계 분석 ───────────────────────────────────────────────────────────────

function analyzeHTF(candles: Candle[]) {
  const lb = CFG.ict.structureShiftBars;
  const sH = findSwingHighs(candles, lb);
  const sL = findSwingLows(candles, lb);
  const pdhl = calculatePDHL(candles);
  const obs  = findOrderBlocks(candles);
  const fvgs = findFVGs(candles);
  const curP = candles[candles.length - 1].close;

  let direction: string | null = null;
  let structure: string | null = null;

  if (sH.length >= 2 && sL.length >= 2) {
    const lH = sH[sH.length - 1].price, pH = sH[sH.length - 2].price;
    const lL = sL[sL.length - 1].price, pL = sL[sL.length - 2].price;
    if (lH > pH && lL > pL)      { direction = 'bullish'; structure = 'HH+HL'; }
    else if (lH < pH && lL < pL) { direction = 'bearish'; structure = 'LH+LL'; }
    else {
      const mss = detectMSS(candles, sH, sL);
      if (mss) { direction = mss; structure = `MSS`; }
    }
  }
  if (!direction && pdhl) {
    if (pdhl.pdlSweep) { direction = 'bullish'; structure = 'PDL Sweep'; }
    else if (pdhl.pdhSweep) { direction = 'bearish'; structure = 'PDH Sweep'; }
  }

  // POI 체크
  const inBullOB  = obs.bullish.some(ob => curP >= ob.low && curP <= ob.high);
  const inBearOB  = obs.bearish.some(ob => curP >= ob.low && curP <= ob.high);
  const unfBullFVG = fvgs.bullish.filter(f => !f.isFilled);
  const unfBearFVG = fvgs.bearish.filter(f => !f.isFilled);
  const inBullFVG  = unfBullFVG.some(f => f.inRange);
  const inBearFVG  = unfBearFVG.some(f => f.inRange);
  const inPOI = (direction === 'bullish' && (inBullOB || inBullFVG)) ||
                (direction === 'bearish' && (inBearOB || inBearFVG));
  const poiType = inBullOB || inBearOB ? 'OB' : inBullFVG || inBearFVG ? 'FVG' : null;

  return {
    direction, structure, swingHighs: sH, swingLows: sL, pdhl, obs, fvgs,
    inPOI, poiType,
    lastBullFVG: unfBullFVG.length > 0 ? unfBullFVG[unfBullFVG.length - 1] : null,
    lastBearFVG: unfBearFVG.length > 0 ? unfBearFVG[unfBearFVG.length - 1] : null,
  };
}

function analyzeMTF(candles: Candle[], direction: string | null) {
  const lb = CFG.ict.structureShiftBars;
  const sH = findSwingHighs(candles, lb);
  const sL = findSwingLows(candles, lb);
  const mss  = detectMSS(candles, sH, sL);
  const obs  = findOrderBlocks(candles);
  const fvgs = findFVGs(candles);

  const relOBs  = direction === 'bullish' ? obs.bullish : obs.bearish;
  const relFVGs = (direction === 'bullish' ? fvgs.bullish : fvgs.bearish).filter(f => !f.isFilled);
  const unfBull = fvgs.bullish.filter(f => !f.isFilled);
  const unfBear = fvgs.bearish.filter(f => !f.isFilled);

  const confluence: string[] = [];
  if (mss === direction) confluence.push(`MTF ${direction} MSS`);
  if (relOBs.length > 0) {
    const ob = relOBs[relOBs.length - 1];
    confluence.push(`MTF OB [${ob.low.toFixed(2)}-${ob.high.toFixed(2)}]`);
  }
  if (relFVGs.length > 0) {
    const f = relFVGs[relFVGs.length - 1];
    confluence.push(`MTF FVG [${f.bottom.toFixed(2)}-${f.top.toFixed(2)}] CE:${f.ce.toFixed(2)}`);
  }

  const confirmed = (mss === direction || relOBs.length > 0) && (relOBs.length > 0 || relFVGs.length > 0);

  return {
    mss, obs, fvgs, relOBs, relFVGs, confluence, confirmed,
    lastBullFVG: unfBull.length > 0 ? unfBull[unfBull.length - 1] : null,
    lastBearFVG: unfBear.length > 0 ? unfBear[unfBear.length - 1] : null,
    swingHighs: sH, swingLows: sL,
  };
}

function analyzeLTF(candles: Candle[], direction: string | null, session: SessionInfo) {
  const lb = CFG.ict.structureShiftBars;
  const sH = findSwingHighs(candles, lb);
  const sL = findSwingLows(candles, lb);
  const fvgs = findFVGs(candles);
  const sessionRanges = calculateSessionRanges(candles);

  const relFVGs  = (direction === 'bullish' ? fvgs.bullish : fvgs.bearish).filter(f => !f.isFilled);
  const iofeds   = detectIOFED(candles);
  const sweeps   = detectLiquiditySweep(candles, sH, sL);
  const ltfMss   = detectMSS(candles, sH, sL);

  const confluence: string[] = [];
  let ready = false;
  let entryType: string | null = null;

  // Session range sweeps
  if (session.session && sessionRanges[session.session]) {
    const sr = sessionRanges[session.session];
    if (sr.highSweep || sr.lowSweep) confluence.push(`${sr.name} Range Sweep`);
  }

  // 1. FVG CE
  for (const f of relFVGs) {
    if (f.atCE) {
      confluence.push(`LTF FVG CE @ ${f.ce.toFixed(2)} (${f.fillPercent}% filled)`);
      ready = true; entryType = 'FVG_CE'; break;
    }
  }
  // 2. FVG Fill
  if (!ready) {
    for (const f of relFVGs) {
      if (f.inRange && f.fillPercent >= 50 && f.fillPercent < 100) {
        confluence.push(`LTF FVG Fill @ ${f.fillPercent}% [${f.bottom.toFixed(2)}-${f.top.toFixed(2)}]`);
        ready = true; entryType = 'FVG_FILL'; break;
      }
    }
  }
  // 3. IOFED
  if (!ready) {
    const rel = iofeds.filter(d => d.type === direction);
    if (rel.length > 0) {
      const latest = rel[rel.length - 1];
      if (candles.length - latest.index <= 5) {
        confluence.push(`IOFED ${latest.type} (${latest.consecutiveBars}연속봉 후 반전)`);
        ready = true; entryType = 'IOFED';
      }
    }
  }
  // 4. Liquidity Sweep
  const relSweep = sweeps.find(s => s.type === direction);
  if (relSweep) {
    confluence.push(`LTF Sweep @ ${relSweep.level.toFixed(2)}`);
    if (!ready) { ready = true; entryType = 'SWEEP'; }
  }
  // LTF MSS (보조)
  if (ltfMss === direction) confluence.push(`LTF ${direction} MSS`);

  return {
    ready, entryType, confluence, sessionRanges,
    swingHighs: sH, swingLows: sL,
    fvgCE: {
      bull: fvgs.bullish.filter(f => !f.isFilled && f.atCE).length,
      bear: fvgs.bearish.filter(f => !f.isFilled && f.atCE).length,
    },
    fvgFill: {
      bull: fvgs.bullish.filter(f => !f.isFilled && f.inRange && f.fillPercent >= 50 && f.fillPercent < 100).length,
      bear: fvgs.bearish.filter(f => !f.isFilled && f.inRange && f.fillPercent >= 50 && f.fillPercent < 100).length,
    },
    iofed: iofeds
      .filter(d => candles.length - d.index <= 5)
      .map(d => ({ type: d.type, bars: d.consecutiveBars })),
  };
}

// ─── SL/TP 계산 ───────────────────────────────────────────────────────────────

function calcSLTP(
  price: number, direction: string,
  relOBs: OBBlock[], ltfSH: SwingPoint[], ltfSL: SwingPoint[], pdhl: any,
): { sl: number; tp: number } {
  let sl: number;
  if (direction === 'bullish') {
    if (relOBs.length > 0)   sl = relOBs[relOBs.length - 1].low * (1 - CFG.ict.stopLossPercent / 100 * 0.3);
    else if (ltfSL.length > 0) sl = ltfSL[ltfSL.length - 1].price * 0.999;
    else if (pdhl)             sl = pdhl.pdl * 0.999;
    else                       sl = price * (1 - CFG.ict.stopLossPercent / 100);
    return { sl: parseFloat(sl.toFixed(2)), tp: parseFloat((price + (price - sl) * 3).toFixed(2)) };
  } else {
    if (relOBs.length > 0)   sl = relOBs[relOBs.length - 1].high * (1 + CFG.ict.stopLossPercent / 100 * 0.3);
    else if (ltfSH.length > 0) sl = ltfSH[ltfSH.length - 1].price * 1.001;
    else if (pdhl)             sl = pdhl.pdh * 1.001;
    else                       sl = price * (1 + CFG.ict.stopLossPercent / 100);
    return { sl: parseFloat(sl.toFixed(2)), tp: parseFloat((price - (sl - price) * 3).toFixed(2)) };
  }
}

// ─── 점수 / 등급 ──────────────────────────────────────────────────────────────

function calcScore(
  htf: ReturnType<typeof analyzeHTF>,
  mtf: ReturnType<typeof analyzeMTF>,
  ltf: ReturnType<typeof analyzeLTF>,
  session: SessionInfo,
): { score: number; grade: string } {
  let score = 0;

  // HTF (30점)
  if (htf.direction)                        score += 20;
  if (htf.pdhl?.pdhSweep || htf.pdhl?.pdlSweep) score += 10;

  // MTF (25점)
  if (mtf.mss === htf.direction)            score += 15;
  if (mtf.relOBs.length > 0)               score += 5;
  if (mtf.relFVGs.length > 0)              score += 5;

  // LTF (35점)
  if (ltf.entryType === 'FVG_CE')          score += 35;
  else if (ltf.entryType === 'FVG_FILL')   score += 25;
  else if (ltf.entryType === 'IOFED')      score += 20;
  else if (ltf.entryType === 'SWEEP')      score += 15;

  // 세션 (10점)
  if (session.active)                       score += 10;

  score = Math.min(100, score);

  const grade =
    score >= 90 ? 'S'  :
    score >= 75 ? 'A'  :
    score >= 65 ? 'B+' :
    score >= 55 ? 'B'  :
    score >= 45 ? 'C'  :
    score >= 35 ? 'D'  : 'F';

  return { score, grade };
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
    const session = getActiveSession();

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
      reason = !htf.direction     ? 'HTF 방향 불명확'
             : !mtf.confirmed    ? 'MTF 구조 미확인'
             :                     'LTF 진입 미충족';
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
