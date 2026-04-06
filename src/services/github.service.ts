/**
 * GitHub Service
 * - Fetches agent definition .md files from /docs folder of the repo
 * - Parses # Title heading and blockquote metadata (no YAML frontmatter)
 * - Branch: claude/gateio-trading-bot-SDKao
 * - 5-minute memory cache to avoid rate limits
 */

const REPO   = 'openclaw4286-code/Coin_Market_Trading';
const BRANCH = 'claude/gateio-trading-bot-SDKao';
const API    = `https://api.github.com/repos/${REPO}/contents/docs?ref=${encodeURIComponent(BRANCH)}`;

export interface AgentDefinition {
  id:              string;
  name:            string;
  description:     string;
  isDashboardOnly: boolean;
  version?:        string;
  fileName:        string;
}

// ── Markdown parser (no frontmatter) ─────────────────────────────────────────

function parseMarkdown(content: string, fileName: string): AgentDefinition {
  // ID: filename without extension, lowercased, underscores → hyphens
  const id = fileName.replace(/\.md$/i, '').toLowerCase().replace(/_/g, '-');

  // Name: first # heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  const name = headingMatch ? headingMatch[1].trim() : id;

  // Description: first paragraph after the heading (skip blank lines & blockquotes)
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

  // Version: blockquote line containing "버전:" or "version:"
  const versionMatch = content.match(/^>\s*(?:버전|version)\s*:\s*(.+)$/im);
  const version = versionMatch ? versionMatch[1].trim() : undefined;

  // isDashboardOnly: blockquote line or explicit flag; default false for trading bots
  const dashboardMatch = content.match(/^>\s*isDashboardOnly\s*:\s*(.+)$/im);
  const isDashboardOnly = dashboardMatch ? dashboardMatch[1].trim() === 'true' : false;

  return { id, name, description, isDashboardOnly, version, fileName };
}

// ── Memory cache (5 min) ──────────────────────────────────────────────────────

let cache: { data: AgentDefinition[]; at: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

// ── Service ───────────────────────────────────────────────────────────────────

export const githubService = {
  async getAgentDefinitions(): Promise<AgentDefinition[]> {
    if (cache && Date.now() - cache.at < CACHE_TTL) return cache.data;

    // 1. List docs/ directory on the specified branch
    const listRes = await fetch(API, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!listRes.ok) throw new Error('GitHub API 요청 실패');
    const files: { name: string; download_url: string; type: string }[] =
      await listRes.json();

    const mdFiles = files.filter((f) => f.type === 'file' && f.name.endsWith('.md'));

    // 2. Fetch each file and parse heading + metadata
    const defs = await Promise.all(
      mdFiles.map(async (file): Promise<AgentDefinition | null> => {
        try {
          const res  = await fetch(file.download_url);
          const text = await res.text();
          return parseMarkdown(text, file.name);
        } catch {
          return null;
        }
      }),
    );

    const data = defs.filter((d): d is AgentDefinition => d !== null);
    cache = { data, at: Date.now() };
    return data;
  },

  clearCache() {
    cache = null;
  },
};
