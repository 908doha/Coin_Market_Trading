/**
 * GitHub Service
 * - Fetches agent definition .md files from /docs folder of the repo
 * - Parses YAML frontmatter for agent metadata
 * - 5-minute memory cache to avoid rate limits
 */

const REPO  = 'openclaw4286-code/Coin_Market_Trading';
const API   = `https://api.github.com/repos/${REPO}/contents/docs`;

export interface AgentDefinition {
  id:              string;
  name:            string;
  description:     string;
  isDashboardOnly: boolean;
  version?:        string;
  fileName:        string;
}

// ── Frontmatter parser ────────────────────────────────────────────────────────

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  match[1].split('\n').forEach((line) => {
    const colon = line.indexOf(':');
    if (colon === -1) return;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '');
    result[key] = val;
  });
  return result;
}

// ── Memory cache (5 min) ──────────────────────────────────────────────────────

let cache: { data: AgentDefinition[]; at: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

// ── Service ───────────────────────────────────────────────────────────────────

export const githubService = {
  async getAgentDefinitions(): Promise<AgentDefinition[]> {
    if (cache && Date.now() - cache.at < CACHE_TTL) return cache.data;

    // 1. List docs/ directory
    const listRes = await fetch(API, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!listRes.ok) throw new Error('GitHub API 요청 실패');
    const files: { name: string; download_url: string; type: string }[] =
      await listRes.json();

    const mdFiles = files.filter((f) => f.type === 'file' && f.name.endsWith('.md'));

    // 2. Fetch each file and parse frontmatter
    const defs = await Promise.all(
      mdFiles.map(async (file): Promise<AgentDefinition | null> => {
        try {
          const res = await fetch(file.download_url);
          const text = await res.text();
          const fm = parseFrontmatter(text);
          if (!fm.id || !fm.name) return null;
          return {
            id:              fm.id,
            name:            fm.name,
            description:     fm.description ?? '',
            isDashboardOnly: fm.isDashboardOnly === 'true',
            version:         fm.version,
            fileName:        file.name,
          };
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
