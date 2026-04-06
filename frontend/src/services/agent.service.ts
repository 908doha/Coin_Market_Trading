import { client } from './client';

export type AgentStatus    = 'running' | 'paused' | 'waiting';
export type RiskLevel      = 'low' | 'medium' | 'high';

export interface AgentStats {
  status:         AgentStatus;
  lastTradeAt:    string;
  winRate30d:     number;
  totalTrades:    number;
  avgHoldingDays: number;
  riskLevel:      RiskLevel;
}

export interface AgentSettings {
  status:    AgentStatus;
  riskLevel: RiskLevel;
}

export const agentService = {
  getStats: () =>
    client.get<AgentStats>('/agent/stats'),

  getSettings: () =>
    client.get<AgentSettings>('/agent/settings'),

  updateSettings: (body: Partial<AgentSettings>) =>
    client.patch<AgentSettings>('/agent/settings', body),
};
