/**
 * Vercel Serverless catch-all — /api/bot/*
 * /api/bot/agents, /api/bot/start, /api/bot/stop, /api/bot/status 등
 * 모든 하위 경로를 Railway 봇 서버로 프록시한다.
 *
 * env:
 *   BOT_SERVER_URL  = https://your-app.railway.app
 *   BOT_API_SECRET  = (봇 서버와 공유하는 시크릿)
 */

// /agents 엔드포인트용 하드코딩 폴백 (BOT_SERVER_URL 미설정 시)
const FALLBACK_AGENTS = [
  {
    id:          'ict-strategy-1-indicators',
    name:        'ICT 전략 — 지표',
    description: 'HTF/MTF/LTF 멀티 타임프레임 + 스윙 구조 지표 기반 ICT 자동매매',
    version:     '1.0',
  },
  {
    id:          'ict-strategy-2-sessions-liquidity',
    name:        'ICT 전략 — 세션/유동성',
    description: '킬존(런던·뉴욕) + 유동성 스윕 중심의 ICT 진입 전략',
    version:     '1.0',
  },
  {
    id:          'ict-strategy-3-entry-sltp',
    name:        'ICT 전략 — OTE 진입/SL·TP',
    description: 'OTE 구간 정밀 진입 + MSS 기반 손절·익절 자동 설정',
    version:     '1.0',
  },
];

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // path 배열 → '/agents' 또는 '/start' 등
  const segments = (req.query.path as string[] | undefined) ?? [];
  const subPath  = '/' + segments.join('/');

  // /agents 는 봇 서버 없이도 폴백 제공
  if (subPath === '/agents' && req.method === 'GET') {
    const BOT_URL = process.env.BOT_SERVER_URL;
    if (!BOT_URL) {
      res.status(200).json(FALLBACK_AGENTS);
      return;
    }
  }

  const BOT_URL    = process.env.BOT_SERVER_URL;
  const BOT_SECRET = process.env.BOT_API_SECRET ?? '';

  if (!BOT_URL) {
    res.status(503).json({ error: 'BOT_SERVER_URL 환경변수가 설정되지 않았습니다.' });
    return;
  }

  // query string 재구성 (path 제외)
  const { path: _p, ...restQuery } = req.query;
  const qs = new URLSearchParams(restQuery as Record<string, string>).toString();
  const upstreamUrl = `${BOT_URL}/bot${subPath}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method:  req.method,
      headers: {
        'Content-Type': 'application/json',
        'x-bot-secret': BOT_SECRET,
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body ?? {}) : undefined,
    });

    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `봇 서버 연결 실패: ${err.message}` });
  }
}
