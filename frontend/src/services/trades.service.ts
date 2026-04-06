import { client } from './client';

export interface Trade {
  id:               string;
  coin:             string;
  symbol:           string;
  direction:        'Long' | 'Short';
  type:             'close' | 'stop_loss';
  entryPrice:       number;
  exitPrice:        number;
  amount:           number;
  profit:           number;
  profitRate:       number;
  entryAt:          string;
  exitAt:           string;
  holdingDays:      number;
  agentEntryReason: string;
  agentExitReason:  string;
}

export const tradesService = {
  getAll: () =>
    client.get<Trade[]>('/trades'),

  getById: (id: string) =>
    client.get<Trade>(`/trades/${id}`),
};
