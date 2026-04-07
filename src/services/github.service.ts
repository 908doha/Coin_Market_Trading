/**
 * GitHub Service
 * - Calls /api/agents (Vercel function) which fetches from private GitHub repo server-side
 * - 5-minute memory cache
 */

const API_BASE =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : process.env.EXPO_PUBLIC_APP_URL ?? '';

export interface AgentDefinition {
  id:              string;
  name:            string;
  description:     string;
  isDashboardOnly: boolean;
  version?:        string;
  fileName:        string;
}

let cache: { data: AgentDefinition[]; at: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

export const githubService = {
  async getAgentDefinitions(): Promise<AgentDefinition[]> {
    if (cache && Date.now() - cache.at < CACHE_TTL) return cache.data;

    const url = `${API_BASE}/api/agents`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e: any) {
      throw new Error(`네트워크 오류: ${e?.message ?? e} (${url})`);
    }

    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j?.error ?? JSON.stringify(j); } catch { detail = await res.text().catch(() => ''); }
      throw new Error(`[${res.status}] ${detail || res.statusText} — ${url}`);
    }

    const data: AgentDefinition[] = await res.json();
    cache = { data, at: Date.now() };
    return data;
  },

  clearCache() {
    cache = null;
  },
};
