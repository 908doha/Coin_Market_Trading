import { client } from './client';

export interface Position {
  id:            string;
  coin:          string;
  symbol:        string;
  direction:     'Long' | 'Short';
  entryPrice:    number;
  currentPrice:  number;
  amount:        number;
  currentValue:  number;
  profit:        number;
  profitRate:    number;
  weight:        number;
  entryAt:       string;
  targetPrice:   number;
  stopLoss:      number;
  holdingPeriod: string;
  riskLevel:     1 | 2 | 3 | 4 | 5;
  agentReason:   string;
  agentPlan:     string;
}

export const positionsService = {
  getAll: () =>
    client.get<Position[]>('/positions'),

  getById: (id: string) =>
    client.get<Position>(`/positions/${id}`),
};
