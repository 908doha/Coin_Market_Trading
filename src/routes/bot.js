/**
 * POST /bot/start   — 계좌 봇 시작
 * POST /bot/stop    — 계좌 봇 중지
 * GET  /bot/status  — 전체 or 특정 계좌 상태
 *
 * 인증: x-bot-secret 헤더 (BOT_API_SECRET env)
 */

const express    = require('express');
const botManager = require('../services/botManager');
const logger     = require('../utils/logger');
const { definitions } = require('../strategies');

const router = express.Router();

// ── 공유 시크릿 인증 미들웨어 ──────────────────────────────────────
function auth(req, res, next) {
  const secret = process.env.BOT_API_SECRET;
  if (!secret) return next(); // 미설정 시 개발 모드로 허용
  if (req.headers['x-bot-secret'] !== secret) {
    return res.status(401).json({ error: '인증 실패' });
  }
  next();
}

// ── POST /bot/start ───────────────────────────────────────────────
router.post('/start', auth, async (req, res) => {
  const { accountId, apiKey, apiSecret, exchange, agentId } = req.body ?? {};

  if (!accountId || !apiKey || !apiSecret || !agentId) {
    return res.status(400).json({ error: 'accountId, apiKey, apiSecret, agentId 필요' });
  }

  try {
    await botManager.start({ accountId, apiKey, apiSecret, exchange: exchange ?? 'gate', agentId });
    res.json({ ok: true, accountId, agentId, status: 'running' });
  } catch (err) {
    logger.error(`[/bot/start] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /bot/stop ────────────────────────────────────────────────
router.post('/stop', auth, async (req, res) => {
  const { accountId } = req.body ?? {};
  if (!accountId) return res.status(400).json({ error: 'accountId 필요' });

  await botManager.stop(accountId);
  res.json({ ok: true, accountId, status: 'stopped' });
});

// ── GET /bot/status ───────────────────────────────────────────────
router.get('/status', auth, (req, res) => {
  const { accountId } = req.query;
  const status = botManager.getStatus(accountId ?? undefined);
  res.json(status ?? {});
});

// ── GET /bot/agents ── 등록된 에이전트 목록 ──────────────────────
router.get('/agents', (req, res) => {
  const list = Array.from(definitions.values());
  res.json(list);
});

module.exports = router;
