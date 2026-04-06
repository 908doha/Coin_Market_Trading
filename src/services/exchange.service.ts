import type { Balance } from './account.service';
import type { ExchangeType } from '../store/accounts';

const API_BASE =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : process.env.EXPO_PUBLIC_APP_URL ?? '';

export const exchangeService = {
  async getBalance(params: {
    exchange:    ExchangeType;
    apiKey:      string;
    apiSecret:   string;
    passphrase?: string;
  }): Promise<Balance> {
    const res = await fetch(`${API_BASE}/api/exchange/balance`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `Exchange API error ${res.status}`);
    }
    return res.json();
  },
};
