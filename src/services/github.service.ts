/**
 * GitHub Service
 * - Fetches /agents.json (static file bundled in the web build)
 * - Falls back to /api/agents (Vercel function) if static file fails
 * - 5-minute memory cache
 */

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

    // Try static JSON first (no auth needed, works everywhere)
    const res = await fetch('/agents.json');
    if (!res.ok) {
      throw new Error(`에이전트 목록 로드 실패 (${res.status}): /agents.json`);
    }

    const data: AgentDefinition[] = await res.json();
    cache = { data, at: Date.now() };
    return data;
  },

  clearCache() {
    cache = null;
  },
};
