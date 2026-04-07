/**
 * Exchange Accounts Store
 * - localStorage를 주 저장소로 사용 (즉시 작동)
 * - 백엔드 /exchange-accounts/ 가 있으면 자동 동기화
 * - 백엔드 없어도 정상 동작
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

// ── 로컬 저장소 ───────────────────────────────────────────────────────────────

async function localLoad(): Promise<ExchangeAccount[]> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem(STORAGE_KEY)
      : await SecureStore.getItemAsync(STORAGE_KEY);
    const result = raw ? (JSON.parse(raw) as ExchangeAccount[]) : [];
    console.log(`[accounts] loaded ${result.length} accounts`);
    return result;
  } catch (e) {
    console.error('[accounts] load error:', e);
    return [];
  }
}

async function localSave(accounts: ExchangeAccount[]): Promise<void> {
  const raw = JSON.stringify(accounts);
  if (Platform.OS === 'web') {
    localStorage.setItem(STORAGE_KEY, raw);
    const check = localStorage.getItem(STORAGE_KEY);
    if (!check) throw new Error('localStorage 저장 실패 — 브라우저가 저장을 차단했을 수 있어요');
  } else {
    await SecureStore.setItemAsync(STORAGE_KEY, raw);
  }
  console.log(`[accounts] saved ${accounts.length} accounts`);
}

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Context ───────────────────────────────────────────────────────────────────

interface AccountsContextValue {
  accounts:        ExchangeAccount[];
  balances:        Record<string, Balance | null>;
  balanceErrors:   Record<string, string | null>;
  totalBalance:    Balance | null;
  balancesLoading: boolean;
  isLoading:       boolean;
  addAccount:      (input: Omit<ExchangeAccount, 'id' | 'createdAt'>) => Promise<ExchangeAccount>;
  updateAccount:   (id: string, updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>) => Promise<void>;
  removeAccount:   (id: string) => Promise<void>;
  refreshBalances: () => Promise<void>;
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
  const [accounts, setAccounts]          = useState<ExchangeAccount[]>([]);
  const [isLoading, setIsLoading]        = useState(true);
  const [balances, setBalances]          = useState<Record<string, Balance | null>>({});
  const [balanceErrors, setBalErrors]    = useState<Record<string, string | null>>({});
  const [balancesLoading, setBalLoading] = useState(false);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  // 앱 시작 시 로컬에서 로드
  useEffect(() => {
    localLoad().then((data) => {
      setAccounts(data);
      setIsLoading(false);
    });
  }, []);

  // 잔고 자동 fetch
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
          return { id: acc.id, bal, err: null };
        } catch (e: any) {
          const msg = e?.message ?? '잔고 조회 실패';
          console.error(`[balance:${acc.id}]`, msg);
          return { id: acc.id, bal: null, err: msg };
        }
      }),
    );
    const map:    Record<string, Balance | null> = {};
    const errMap: Record<string, string | null>  = {};
    results.forEach(({ id, bal, err }) => { map[id] = bal; errMap[id] = err; });
    setBalances(map);
    setBalErrors(errMap);
    setBalLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoading && accounts.length > 0) refreshBalances();
  }, [isLoading, accounts.length]);

  const totalBalance = accounts.length
    ? sumBalances(accounts.map((a) => balances[a.id] ?? null))
    : null;

  // ── CRUD — 로컬 우선 저장 ────────────────────────────────────────────────────

  const addAccount = useCallback(async (
    input: Omit<ExchangeAccount, 'id' | 'createdAt'>,
  ): Promise<ExchangeAccount> => {
    const account: ExchangeAccount = {
      ...input,
      id:        makeId(),
      createdAt: new Date().toISOString(),
    };
    const next = [...accountsRef.current, account];
    await localSave(next);   // 먼저 로컬 저장
    setAccounts(next);
    return account;
  }, []);

  const updateAccount = useCallback(async (
    id: string,
    updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>,
  ): Promise<void> => {
    const next = accountsRef.current.map((a) => a.id === id ? { ...a, ...updates } : a);
    await localSave(next);
    setAccounts(next);
  }, []);

  const removeAccount = useCallback(async (id: string): Promise<void> => {
    const next = accountsRef.current.filter((a) => a.id !== id);
    await localSave(next);
    setAccounts(next);
    setBalances((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  return (
    <AccountsContext.Provider value={{
      accounts, isLoading,
      balances, balanceErrors, totalBalance, balancesLoading,
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
