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

    const res = await fetch(`${API_BASE}/api/agents`);
    if (!res.ok) throw new Error('에이전트 목록을 불러오지 못했어요');
    const data: AgentDefinition[] = await res.json();

    cache = { data, at: Date.now() };
    return data;
  },

  clearCache() {
    cache = null;
  },
};
