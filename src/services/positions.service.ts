import { client } from './client';

export interface IctConfluence {
  label:  string;   // e.g. "HTF OB 진입", "MTF OB", "LTF FVG CE"
  detail: string;   // e.g. "[4692.30-4693.60]", "@ 4700.10"
  isKey:  boolean;  // ★ 표시 여부
}

export interface IctAnalysis {
  session:          string;                // e.g. "London AM"
  htfBias:          'BULLISH' | 'BEARISH';
  htfTimeframe:     string;                // e.g. "4h"
  confluences:      IctConfluence[];
  confluenceCount:  number;
}

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
  ictAnalysis?:  IctAnalysis;
}

export const positionsService = {
  getAll: () =>
    client.get<Position[]>('/positions'),

  getById: (id: string) =>
    client.get<Position>(`/positions/${id}`),
};
