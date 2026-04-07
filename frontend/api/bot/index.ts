/**
 * Vercel Serverless — /api/bot/*
 * 봇 서버(Railway)로 요청을 프록시한다.
 *
 * env:
 *   BOT_SERVER_URL   = https://your-app.railway.app
 *   BOT_API_SECRET   = (봇 서버와 공유하는 시크릿)
 */

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const BOT_URL    = process.env.BOT_SERVER_URL;
  const BOT_SECRET = process.env.BOT_API_SECRET ?? '';

  if (!BOT_URL) {
    res.status(503).json({ error: 'BOT_SERVER_URL 환경변수가 설정되지 않았습니다.' });
    return;
  }

  // /api/bot/start  →  {BOT_URL}/bot/start
  const subPath = (req.url as string).replace(/^\/api\/bot/, '') || '/status';

  try {
    const upstream = await fetch(`${BOT_URL}/bot${subPath}`, {
      method:  req.method,
      headers: {
        'Content-Type':  'application/json',
        'x-bot-secret':  BOT_SECRET,
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body ?? {}) : undefined,
    });

    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `봇 서버 연결 실패: ${err.message}` });
  }
}
