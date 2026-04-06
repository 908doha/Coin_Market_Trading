/**
 * Vercel Serverless Function
 * GET /api/agents
 * Returns: AgentDefinition[] parsed from /docs/*.md in the bot branch
 *
 * Requires env var: GITHUB_TOKEN (GitHub PAT with repo read access)
 */

const REPO   = 'openclaw4286-code/Coin_Market_Trading';
const BRANCH = 'claude/gateio-trading-bot-SDKao';
const REF    = `refs/heads/${BRANCH}`;   // full ref — no encodeURIComponent needed

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface AgentDefinition {
  id:              string;
  name:            string;
  description:     string;
  isDashboardOnly: boolean;
  version?:        string;
  fileName:        string;
}

function parseMarkdown(content: string, fileName: string): AgentDefinition {
  const id = fileName.replace(/\.md$/i, '').toLowerCase().replace(/_/g, '-');

  const headingMatch = content.match(/^#\s+(.+)$/m);
  const name = headingMatch ? headingMatch[1].trim() : id;

  const lines = content.split('\n');
  const descLines: string[] = [];
  let pastHeading = false;
  for (const line of lines) {
    if (!pastHeading) {
      if (/^#\s/.test(line)) pastHeading = true;
      continue;
    }
    if (line.trim() === '' || line.startsWith('>') || line.startsWith('#')) {
      if (descLines.length) break;
      continue;
    }
    descLines.push(line.trim());
    if (descLines.length >= 2) break;
  }

  const versionMatch = content.match(/^>\s*v?([\d.]+)/im);
  const version = versionMatch ? versionMatch[1].trim() : undefined;

  const dashboardMatch = content.match(/^>\s*isDashboardOnly\s*:\s*(.+)$/im);
  const isDashboardOnly = dashboardMatch ? dashboardMatch[1].trim() === 'true' : false;

  return {
    id,
    name,
    description: descLines.join(' '),
    isDashboardOnly,
    version,
    fileName,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(200).set(CORS).end();
  if (req.method !== 'GET')    return res.status(405).set(CORS).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(503).set(CORS).json({
      error: 'GITHUB_TOKEN 환경변수가 설정되지 않았습니다. Vercel 프로젝트 설정에서 추가해주세요.',
    });
  }

  const ghHeaders = {
    Accept:        'application/vnd.github.v3+json',
    Authorization: `Bearer ${token}`,
    'User-Agent':  'Coin_Market_Trading',
  };

  try {
    // 1. List docs/ directory — use REF (not encodeURIComponent, slash is valid in query value)
    const listUrl = `https://api.github.com/repos/${REPO}/contents/docs?ref=${REF}`;
    const listRes = await fetch(listUrl, { headers: ghHeaders });

    if (!listRes.ok) {
      const body = await listRes.text();
      return res.status(502).set(CORS).json({
        error: `GitHub 디렉토리 조회 실패 (${listRes.status})`,
        detail: body,
      });
    }

    const files: { name: string; path: string; type: string }[] = await listRes.json();
    const mdFiles = files.filter((f) => f.type === 'file' && f.name.endsWith('.md'));

    // 2. Fetch each file content via GitHub API (base64) — avoids short-lived download_url tokens
    const defs = await Promise.all(
      mdFiles.map(async (file): Promise<AgentDefinition | null> => {
        try {
          const contentUrl = `https://api.github.com/repos/${REPO}/contents/${file.path}?ref=${REF}`;
          const r = await fetch(contentUrl, { headers: ghHeaders });
          if (!r.ok) return null;
          const json: { content?: string; encoding?: string } = await r.json();
          if (!json.content || json.encoding !== 'base64') return null;
          // GitHub returns base64 with newlines — strip them before decoding
          const text = Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf-8');
          return parseMarkdown(text, file.name);
        } catch {
          return null;
        }
      }),
    );

    const data = defs.filter((d): d is AgentDefinition => d !== null);
    return res.status(200).set(CORS).json(data);
  } catch (err: any) {
    return res.status(500).set(CORS).json({ error: err?.message ?? 'Internal error' });
  }
}
