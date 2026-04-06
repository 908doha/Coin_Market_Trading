import { client } from './client';

export interface Balance {
  total:          number;
  invested:       number;
  available:      number;
  profitTotal:    number;
  profitRate:     number;
  profitToday:    number;
  profitTodayRate: number;
}

export interface ChartPoint {
  date:  string;
  value: number;
}

export type ChartPeriod = '1W' | '1M' | '3M' | '6M' | '1Y';

export interface FundTransaction {
  id:           string;
  type:         'deposit' | 'withdraw';
  amount:       number;
  status:       'pending' | 'processing' | 'done' | 'rejected';
  requestedAt:  string;
  completedAt?: string;
}

export interface DepositRequest {
  amount: number;
  senderName: string;
}

export interface WithdrawRequest {
  amount:    number;
  bank:      string;
  account:   string;
  holder:    string;
}

export const accountService = {
  getBalance: () =>
    client.get<Balance>('/account/balance'),

  /** 특정 거래소 계정의 잔고 (백엔드: GET /account/balance?exchange_account_id=xxx) */
  getBalanceByAccountId: (exchangeAccountId: string) =>
    client.get<Balance>(`/account/balance?exchange_account_id=${exchangeAccountId}`),

  getChart: (period: ChartPeriod) =>
    client.get<ChartPoint[]>(`/account/chart?period=${period}`),

  getTransactions: () =>
    client.get<FundTransaction[]>('/account/transactions'),

  requestDeposit: (body: DepositRequest) =>
    client.post<void>('/account/deposit', body),

  requestWithdraw: (body: WithdrawRequest) =>
    client.post<void>('/account/withdraw', body),
};
