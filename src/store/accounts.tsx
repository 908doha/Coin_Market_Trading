/**
 * Exchange Accounts Store
 * - Loads/saves from backend API (/exchange-accounts/)
 * - Falls back to localStorage cache when offline
 * - JWT auth via client.ts
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { exchangeAccountsService } from '../services/exchange-accounts.service';
import { exchangeService } from '../services/exchange.service';
import type { Balance } from '../services/account.service';

export type ExchangeType = 'binance' | 'upbit' | 'bybit' | 'okx' | 'gate' | 'custom';

export interface ExchangeAccount {
  id:         string;
  name:       string;
  exchange:   ExchangeType;
  apiKey:     string;
  apiSecret:  string;
  agentId:    string | null;
  isActive:   boolean;
  createdAt:  string;
}

// ── 로컬 캐시 (오프라인 대비) ─────────────────────────────────────────────────

const CACHE_KEY = 'exchange_accounts_cache_v2';

function readCache(): ExchangeAccount[] {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem(CACHE_KEY)
      : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeCache(accounts: ExchangeAccount[]): void {
  try {
    if (Platform.OS === 'web') {
      localStorage.setItem(CACHE_KEY, JSON.stringify(accounts));
    }
  } catch { /* ignore */ }
}

// ── Context ───────────────────────────────────────────────────────────────────

interface AccountsContextValue {
  accounts:        ExchangeAccount[];
  balances:        Record<string, Balance | null>;
  totalBalance:    Balance | null;
  balancesLoading: boolean;
  isLoading:       boolean;
  error:           string | null;
  addAccount:      (input: Omit<ExchangeAccount, 'id' | 'createdAt'>) => Promise<ExchangeAccount>;
  updateAccount:   (id: string, updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>) => Promise<void>;
  removeAccount:   (id: string) => Promise<void>;
  refreshBalances: () => Promise<void>;
  reload:          () => Promise<void>;
}

const AccountsContext = createContext<AccountsContextValue | null>(null);

function sumBalances(bals: (Balance | null)[]): Balance | null {
  const valid = bals.filter((b): b is Balance => b !== null);
  if (!valid.length) return null;
  return valid.reduce<Balance>(
    (acc, b) => ({
      total:           acc.total           + b.total,
      invested:        acc.invested        + b.invested,
      available:       acc.available       + b.available,
      profitTotal:     acc.profitTotal     + b.profitTotal,
      profitRate:      acc.profitRate      + b.profitRate,
      profitToday:     acc.profitToday     + b.profitToday,
      profitTodayRate: acc.profitTodayRate + b.profitTodayRate,
    }),
    { total: 0, invested: 0, available: 0, profitTotal: 0, profitRate: 0, profitToday: 0, profitTodayRate: 0 },
  );
}

export function AccountsProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts]          = useState<ExchangeAccount[]>(readCache);
  const [isLoading, setIsLoading]        = useState(true);
  const [error, setError]                = useState<string | null>(null);
  const [balances, setBalances]          = useState<Record<string, Balance | null>>({});
  const [balancesLoading, setBalLoading] = useState(false);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const loadFromServer = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await exchangeAccountsService.list();
      setAccounts(data);
      writeCache(data);
    } catch (e: any) {
      const msg = e?.message ?? '계좌 목록을 불러오지 못했어요';
      setError(msg);
      // 캐시 유지 (오프라인일 때도 기존 목록 표시)
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadFromServer(); }, []);

  // 잔고 fetch
  const refreshBalances = useCallback(async () => {
    const list = accountsRef.current;
    if (!list.length) return;
    setBalLoading(true);
    const results = await Promise.all(
      list.map(async (acc) => {
        try {
          const bal = await exchangeService.getBalance({
            exchange:  acc.exchange,
            apiKey:    acc.apiKey,
            apiSecret: acc.apiSecret,
          });
          return { id: acc.id, bal };
        } catch {
          return { id: acc.id, bal: null };
        }
      }),
    );
    const map: Record<string, Balance | null> = {};
    results.forEach(({ id, bal }) => { map[id] = bal; });
    setBalances(map);
    setBalLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoading && accounts.length > 0) refreshBalances();
  }, [isLoading, accounts.length]);

  const totalBalance = accounts.length
    ? sumBalances(accounts.map((a) => balances[a.id] ?? null))
    : null;

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  const addAccount = useCallback(async (
    input: Omit<ExchangeAccount, 'id' | 'createdAt'>,
  ): Promise<ExchangeAccount> => {
    const account = await exchangeAccountsService.create(input);
    const next = [...accountsRef.current, account];
    setAccounts(next);
    writeCache(next);
    return account;
  }, []);

  const updateAccount = useCallback(async (
    id: string,
    updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>,
  ): Promise<void> => {
    await exchangeAccountsService.update(id, updates);
    const next = accountsRef.current.map((a) => a.id === id ? { ...a, ...updates } : a);
    setAccounts(next);
    writeCache(next);
  }, []);

  const removeAccount = useCallback(async (id: string): Promise<void> => {
    await exchangeAccountsService.remove(id);
    const next = accountsRef.current.filter((a) => a.id !== id);
    setAccounts(next);
    writeCache(next);
    setBalances((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  return (
    <AccountsContext.Provider value={{
      accounts, isLoading, error,
      balances, totalBalance, balancesLoading,
      addAccount, updateAccount, removeAccount,
      refreshBalances, reload: loadFromServer,
    }}>
      {children}
    </AccountsContext.Provider>
  );
}

export function useAccounts(): AccountsContextValue {
  const ctx = useContext(AccountsContext);
  if (!ctx) throw new Error('useAccounts must be used within AccountsProvider');
  return ctx;
}

export const EXCHANGE_LABELS: Record<ExchangeType, string> = {
  binance: 'Binance',
  upbit:   'Upbit',
  bybit:   'Bybit',
  okx:     'OKX',
  gate:    'Gate.io',
  custom:  'Custom',
};

export const EXCHANGE_COLORS: Record<ExchangeType, string> = {
  binance: '#F0B90B',
  upbit:   '#0062FF',
  bybit:   '#F7A600',
  okx:     '#000000',
  gate:    '#2354E6',
  custom:  '#888888',
};
