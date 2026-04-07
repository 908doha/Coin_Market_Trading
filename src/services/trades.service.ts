import type { ExchangeType } from '../store/accounts';

export interface Trade {
  id:          string;
  symbol:      string;
  coin:        string;
  direction:   'Long' | 'Short';
  type:        'take_profit' | 'stop_loss' | 'manual';
  profit:      number;
  profitRate:  number;
  holdingDays: number;
  entryAt:     string;
  exitAt:      string;
  // compat
  entryPrice?:       number;
  exitPrice?:        number;
  amount?:           number;
  agentEntryReason?: string;
  agentExitReason?:  string;
}

const API_BASE =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : process.env.EXPO_PUBLIC_APP_URL ?? '';

export const tradesService = {
  getByAccount: async (params: {
    exchange:  ExchangeType;
    apiKey:    string;
    apiSecret: string;
  }): Promise<Trade[]> => {
    const res = await fetch(`${API_BASE}/api/trades`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(params),
    });
    if (!res.ok) throw new Error('거래내역 조회 실패');
    return res.json();
  },

  getAllByAccounts: async (
    accounts: { id: string; exchange: ExchangeType; apiKey: string; apiSecret: string }[],
  ): Promise<Trade[]> => {
    if (!accounts.length) return [];
    const results = await Promise.all(
      accounts.map((acc) =>
        tradesService
          .getByAccount({ exchange: acc.exchange, apiKey: acc.apiKey, apiSecret: acc.apiSecret })
          .catch(() => [] as Trade[]),
      ),
    );
    return results.flat().sort((a, b) =>
      new Date(b.exitAt).getTime() - new Date(a.exitAt).getTime(),
    );
  },
  /** accountId → Trade[] 로 묶어서 반환 (에이전트별 통계 계산용) */
  getGroupedByAccount: async (
    accounts: { id: string; exchange: ExchangeType; apiKey: string; apiSecret: string }[],
  ): Promise<Record<string, Trade[]>> => {
    if (!accounts.length) return {};
    const entries = await Promise.all(
      accounts.map(async (acc) => {
        const trades = await tradesService
          .getByAccount({ exchange: acc.exchange, apiKey: acc.apiKey, apiSecret: acc.apiSecret })
          .catch(() => [] as Trade[]);
        return [acc.id, trades] as [string, Trade[]];
      }),
    );
    return Object.fromEntries(entries);
  },
};
