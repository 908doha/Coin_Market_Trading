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

// 거래 상세 조회용 인메모리 캐시 (id → Trade)
const cache = new Map<string, Trade>();

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
    const trades = results.flat().sort((a, b) =>
      new Date(b.exitAt).getTime() - new Date(a.exitAt).getTime(),
    );
    // 캐시 저장
    trades.forEach((t) => cache.set(t.id, t));
    return trades;
  },

  /** id로 단건 조회 — 캐시 우선, 없으면 전체 재조회 */
  getById: async (
    id: string,
    accounts?: { id: string; exchange: ExchangeType; apiKey: string; apiSecret: string }[],
  ): Promise<Trade | null> => {
    if (cache.has(id)) return cache.get(id)!;
    // 캐시 미스 → 계좌가 있으면 전체 재로드해서 채움
    if (accounts?.length) {
      await tradesService.getAllByAccounts(accounts);
      return cache.get(id) ?? null;
    }
    return null;
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
