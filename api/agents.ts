/**
 * Vercel Serverless Function
 * GET /api/agents
 * Returns: AgentDefinition[] parsed from /docs/*.md in the bot branch
 *
 * Requires env var: GITHUB_TOKEN (GitHub PAT with repo read access)
 */

const REPO   = 'openclaw4286-code/Coin_Market_Trading';
const BRANCH = 'claude/gateio-trading-bot-SDKao';

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

  // Extract first meaningful paragraph after the heading (skip ---, >, empty lines)
  const lines = content.split('\n');
  const descLines: string[] = [];
  let pastHeading = false;
  for (const line of lines) {
    if (!pastHeading) {
      if (/^#\s/.test(line)) pastHeading = true;
      continue;
    }
    const t = line.trim();
    if (t === '' || t === '---' || line.startsWith('>') || line.startsWith('#')) {
      if (descLines.length) break;
      continue;
    }
    descLines.push(t);
    if (descLines.length >= 2) break;
  }

  const versionMatch = content.match(/^>\s*v?([\d.]+)/im);
  const version = versionMatch ? versionMatch[1].trim() : undefined;

  const dashboardMatch = content.match(/^>\s*isDashboardOnly\s*:\s*(.+)$/im);
  const isDashboardOnly = dashboardMatch ? dashboardMatch[1].trim() === 'true' : false;

  return {
    id,
    name,
    description: descLines.join(' ') || '에이전트 전략 문서',
    isDashboardOnly,
    version,
    fileName,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(503).json({
      error: 'GITHUB_TOKEN 환경변수가 설정되지 않았습니다. Vercel 프로젝트 설정에서 추가해주세요.',
    });
    return;
  }

  const ghHeaders = {
    Accept:        'application/vnd.github.v3+json',
    Authorization: `Bearer ${token}`,
    'User-Agent':  'Coin_Market_Trading',
  };

  try {
    // 1. List docs/ directory
    const listUrl = `https://api.github.com/repos/${REPO}/contents/docs?ref=${BRANCH}`;
    const listRes = await fetch(listUrl, { headers: ghHeaders });

    if (!listRes.ok) {
      const body = await listRes.text();
      res.status(502).json({
        error: `GitHub 디렉토리 조회 실패 (${listRes.status})`,
        detail: body,
      });
      return;
    }

    const files: { name: string; path: string; type: string }[] = await listRes.json();
    const mdFiles = files.filter((f) => f.type === 'file' && f.name.endsWith('.md'));

    // 2. Fetch each file content via GitHub API (base64)
    const defs = await Promise.all(
      mdFiles.map(async (file): Promise<AgentDefinition | null> => {
        try {
          const contentUrl = `https://api.github.com/repos/${REPO}/contents/${file.path}?ref=${BRANCH}`;
          const r = await fetch(contentUrl, { headers: ghHeaders });
          if (!r.ok) return null;
          const json: { content?: string; encoding?: string } = await r.json();
          if (!json.content || json.encoding !== 'base64') return null;
          const text = Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf-8');
          return parseMarkdown(text, file.name);
        } catch {
          return null;
        }
      }),
    );

    const data = defs.filter((d): d is AgentDefinition => d !== null);
    res.status(200).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
}
