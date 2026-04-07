import type { ExchangeType } from '../store/accounts';

export interface Position {
  id:            string;
  coin:          string;
  symbol:        string;
  direction:     'Long' | 'Short';
  entryPrice:    number;
  markPrice:     number;
  amount:        number;
  profit:        number;
  profitRate:    number;
  leverage:      number;
  agentReason?:  string;
  // compat fields (상세 화면용)
  currentPrice?: number;
  currentValue?: number;
  weight?:       number;
  entryAt?:      string;
  targetPrice?:  number;
  stopLoss?:     number;
  holdingPeriod?: string;
  riskLevel?:    number;
  agentPlan?:    string;
}

const API_BASE =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : process.env.EXPO_PUBLIC_APP_URL ?? '';

// 마지막으로 조회한 포지션 캐시 (id → Position)
const positionsCache = new Map<string, Position>();

export const positionsService = {
  /** 특정 계좌의 실제 포지션 조회 */
  getByAccount: async (params: {
    exchange: ExchangeType;
    apiKey:   string;
    apiSecret: string;
  }): Promise<Position[]> => {
    const res = await fetch(`${API_BASE}/api/positions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(params),
    });
    if (!res.ok) throw new Error('포지션 조회 실패');
    return res.json();
  },

  /** 모든 계좌의 포지션 합산 (캐시에 저장) */
  getAllByAccounts: async (
    accounts: { id: string; exchange: ExchangeType; apiKey: string; apiSecret: string }[],
  ): Promise<Position[]> => {
    if (!accounts.length) return [];
    const results = await Promise.all(
      accounts.map((acc) =>
        positionsService
          .getByAccount({ exchange: acc.exchange, apiKey: acc.apiKey, apiSecret: acc.apiSecret })
          .catch(() => [] as Position[]),
      ),
    );
    const all = results.flat();
    // 캐시 갱신
    positionsCache.clear();
    all.forEach((p) => positionsCache.set(p.id, p));
    return all;
  },

  /** 캐시에서 단일 포지션 조회 */
  getById: async (id: string): Promise<Position | null> => {
    return positionsCache.get(id) ?? null;
  },
};
