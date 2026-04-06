/**
 * Exchange Accounts Store
 * - Stores multiple exchange API accounts locally
 * - SecureStore on mobile, localStorage on web (same pattern as tokenStorage)
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type ExchangeType = 'binance' | 'upbit' | 'bybit' | 'okx' | 'custom';

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
  accounts:      ExchangeAccount[];
  isLoading:     boolean;
  addAccount:    (input: Omit<ExchangeAccount, 'id' | 'createdAt'>) => Promise<ExchangeAccount>;
  updateAccount: (id: string, updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
}

const AccountsContext = createContext<AccountsContextValue | null>(null);

export function AccountsProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts]   = useState<ExchangeAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadAccounts().then((data) => {
      setAccounts(data);
      setIsLoading(false);
    });
  }, []);

  const addAccount = useCallback(async (
    input: Omit<ExchangeAccount, 'id' | 'createdAt'>,
  ): Promise<ExchangeAccount> => {
    const account: ExchangeAccount = {
      ...input,
      id:        makeId(),
      createdAt: new Date().toISOString(),
    };
    const next = [...accounts, account];
    await saveAccounts(next);
    setAccounts(next);
    return account;
  }, [accounts]);

  const updateAccount = useCallback(async (
    id: string,
    updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>,
  ): Promise<void> => {
    const next = accounts.map((a) => a.id === id ? { ...a, ...updates } : a);
    await saveAccounts(next);
    setAccounts(next);
  }, [accounts]);

  const removeAccount = useCallback(async (id: string): Promise<void> => {
    const next = accounts.filter((a) => a.id !== id);
    await saveAccounts(next);
    setAccounts(next);
  }, [accounts]);

  return (
    <AccountsContext.Provider value={{ accounts, isLoading, addAccount, updateAccount, removeAccount }}>
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
  custom:  'Custom',
};

export const EXCHANGE_COLORS: Record<ExchangeType, string> = {
  binance: '#F0B90B',
  upbit:   '#0062FF',
  bybit:   '#F7A600',
  okx:     '#000000',
  custom:  '#888888',
};
