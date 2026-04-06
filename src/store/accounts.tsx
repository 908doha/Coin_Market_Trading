/**
 * Exchange Accounts Store
 * - Stores multiple exchange API accounts locally
 * - SecureStore on mobile, localStorage on web (same pattern as tokenStorage)
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
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

const STORAGE_KEY = 'exchange_accounts_v1';

// ── Storage helpers ───────────────────────────────────────────────────────────

async function loadAccounts(): Promise<ExchangeAccount[]> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem(STORAGE_KEY)
      : await SecureStore.getItemAsync(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveAccounts(accounts: ExchangeAccount[]): Promise<void> {
  const raw = JSON.stringify(accounts);
  if (Platform.OS === 'web') {
    localStorage.setItem(STORAGE_KEY, raw);
  } else {
    await SecureStore.setItemAsync(STORAGE_KEY, raw);
  }
}

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Context ───────────────────────────────────────────────────────────────────

interface AccountsContextValue {
  accounts:       ExchangeAccount[];
  balances:       Record<string, Balance | null>;  // keyed by account.id
  totalBalance:   Balance | null;                   // sum of all balances
  balancesLoading: boolean;
  isLoading:      boolean;
  addAccount:     (input: Omit<ExchangeAccount, 'id' | 'createdAt'>) => Promise<ExchangeAccount>;
  updateAccount:  (id: string, updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>) => Promise<void>;
  removeAccount:  (id: string) => Promise<void>;
  refreshBalances: () => Promise<void>;
}

const AccountsContext = createContext<AccountsContextValue | null>(null);

function sumBalances(bals: (Balance | null)[]): Balance | null {
  const valid = bals.filter((b): b is Balance => b !== null);
  if (!valid.length) return null;
  return valid.reduce<Balance>(
    (acc, b) => ({
      total:          acc.total          + b.total,
      invested:       acc.invested       + b.invested,
      available:      acc.available      + b.available,
      profitTotal:    acc.profitTotal    + b.profitTotal,
      profitRate:     acc.profitRate     + b.profitRate,   // 단순 합산 (평균은 별도 계산)
      profitToday:    acc.profitToday    + b.profitToday,
      profitTodayRate: acc.profitTodayRate + b.profitTodayRate,
    }),
    { total: 0, invested: 0, available: 0, profitTotal: 0, profitRate: 0, profitToday: 0, profitTodayRate: 0 },
  );
}

export function AccountsProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts]           = useState<ExchangeAccount[]>([]);
  const [isLoading, setIsLoading]         = useState(true);
  const [balances, setBalances]           = useState<Record<string, Balance | null>>({});
  const [balancesLoading, setBalLoading]  = useState(false);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  useEffect(() => {
    loadAccounts().then((data) => {
      setAccounts(data);
      setIsLoading(false);
    });
  }, []);

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

  // 계정 목록 로드되면 잔고 자동 fetch
  useEffect(() => {
    if (!isLoading && accounts.length > 0) refreshBalances();
  }, [isLoading, accounts.length]);

  const totalBalance = accounts.length
    ? sumBalances(accounts.map((a) => balances[a.id] ?? null))
    : null;

  const addAccount = useCallback(async (
    input: Omit<ExchangeAccount, 'id' | 'createdAt'>,
  ): Promise<ExchangeAccount> => {
    const account: ExchangeAccount = {
      ...input,
      id:        makeId(),
      createdAt: new Date().toISOString(),
    };
    const next = [...accountsRef.current, account];
    await saveAccounts(next);
    setAccounts(next);
    return account;
  }, []);

  const updateAccount = useCallback(async (
    id: string,
    updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>,
  ): Promise<void> => {
    const next = accountsRef.current.map((a) => a.id === id ? { ...a, ...updates } : a);
    await saveAccounts(next);
    setAccounts(next);
  }, []);

  const removeAccount = useCallback(async (id: string): Promise<void> => {
    const next = accountsRef.current.filter((a) => a.id !== id);
    await saveAccounts(next);
    setAccounts(next);
    setBalances((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  return (
    <AccountsContext.Provider value={{
      accounts, isLoading,
      balances, totalBalance, balancesLoading,
      addAccount, updateAccount, removeAccount, refreshBalances,
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
