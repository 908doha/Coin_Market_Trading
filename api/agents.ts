/**
 * Vercel Serverless Function
 * GET /api/agents
 * Returns: AgentDefinition[] parsed from /docs/*.md in the bot branch
 */

const REPO   = 'openclaw4286-code/Coin_Market_Trading';
const BRANCH = 'claude/gateio-trading-bot-SDKao';

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

// ── Markdown parser ────────────────────────────────────────────────────────────

function parseMarkdown(content: string, fileName: string): AgentDefinition {
  const id = fileName.replace(/\.md$/i, '').toLowerCase().replace(/_/g, '-');

  // Name: first # heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  const name = headingMatch ? headingMatch[1].trim() : id;

  // Description: first non-blank, non-blockquote, non-heading paragraph
  const lines = content.split('\n');
  let descLines: string[] = [];
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
  const description = descLines.join(' ');

  // Version: blockquote line "v1.0.0" or "> 버전: 1.0.0" or "> v2.0.0"
  const versionMatch = content.match(/^>\s*(?:버전\s*:\s*|version\s*:\s*|v)([\d.]+)/im);
  const version = versionMatch ? versionMatch[1].trim() : undefined;

  const dashboardMatch = content.match(/^>\s*isDashboardOnly\s*:\s*(.+)$/im);
  const isDashboardOnly = dashboardMatch ? dashboardMatch[1].trim() === 'true' : false;

  return { id, name, description, isDashboardOnly, version, fileName };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).set(CORS).json({ error: 'Method not allowed' });
  }

  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    // 1. List docs/ directory
    const listRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/docs?ref=${encodeURIComponent(BRANCH)}`,
      { headers },
    );
    if (!listRes.ok) {
      const err = await listRes.text();
      return res.status(502).set(CORS).json({ error: `GitHub API error: ${listRes.status}`, detail: err });
    }
    const files: { name: string; download_url: string; type: string }[] =
      await listRes.json();

    const mdFiles = files.filter((f) => f.type === 'file' && f.name.endsWith('.md'));

    // 2. Fetch and parse each file
    const defs = await Promise.all(
      mdFiles.map(async (file): Promise<AgentDefinition | null> => {
        try {
          const r = await fetch(file.download_url, { headers });
          const text = await r.text();
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
