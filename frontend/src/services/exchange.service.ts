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
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/exchange/balance`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(params),
      });
    } catch (e: any) {
      throw new Error(`네트워크 오류: ${e?.message ?? e}`);
    }

    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = j?.error ?? JSON.stringify(j);
      } catch {
        detail = await res.text().catch(() => '');
      }
      // Gate.io IP 제한 안내
      if (detail.toLowerCase().includes('ip') || res.status === 403) {
        throw new Error(`IP 차단: Gate.io API 키 설정에서 IP 제한을 해제해주세요 (${res.status})`);
      }
      throw new Error(`[${res.status}] ${detail || res.statusText}`);
    }

    return res.json();
  },
};
