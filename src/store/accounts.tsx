/**
 * Exchange Accounts Store
 * - localStorage / SecureStore 를 즉시 캐시로 사용
 * - /api/user-accounts (Railway PostgreSQL) 와 자동 동기화
 * - DB 없어도 로컬 스토리지만으로 정상 동작
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
const TOKEN_KEY   = 'jwt_access';

// ── 토큰 읽기 ─────────────────────────────────────────────────────────────────
async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(TOKEN_KEY);
  return SecureStore.getItemAsync(TOKEN_KEY);
}

// ── 로컬 저장소 ───────────────────────────────────────────────────────────────
async function localLoad(): Promise<ExchangeAccount[]> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem(STORAGE_KEY)
      : await SecureStore.getItemAsync(STORAGE_KEY);
    const result = raw ? (JSON.parse(raw) as ExchangeAccount[]) : [];
    console.log(`[accounts] local: ${result.length}개 로드`);
    return result;
  } catch (e) {
    console.error('[accounts] localLoad 오류:', e);
    return [];
  }
}

async function localSave(accounts: ExchangeAccount[]): Promise<void> {
  const raw = JSON.stringify(accounts);
  if (Platform.OS === 'web') {
    localStorage.setItem(STORAGE_KEY, raw);
  } else {
    await SecureStore.setItemAsync(STORAGE_KEY, raw);
  }
}

// ── 백엔드 동기화 ─────────────────────────────────────────────────────────────
async function backendLoad(): Promise<ExchangeAccount[] | null> {
  try {
    const token = await getToken();
    if (!token) return null;
    const res = await fetch('/api/user-accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 204) return null;  // DB 미설정
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch (e) {
    console.warn('[accounts] backendLoad 실패:', e);
    return null;
  }
}

async function backendSave(accounts: ExchangeAccount[]): Promise<void> {
  try {
    const token = await getToken();
    if (!token) return;
    const res = await fetch('/api/user-accounts', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(accounts),
    });
    if (!res.ok) console.warn('[accounts] backendSave 실패:', res.status);
    else console.log(`[accounts] backend: ${accounts.length}개 저장`);
  } catch (e) {
    console.warn('[accounts] backendSave 오류:', e);
  }
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
      totalUsd:        (acc.totalUsd ?? 0) + (b.totalUsd ?? 0),
      usdtKrw:         b.usdtKrw ?? acc.usdtKrw,
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

  // ── 시작 시: 로컬 즉시 로드 → 백엔드 동기화 ──────────────────────────────────
  useEffect(() => {
    (async () => {
      // 1) 로컬 즉시 로드 (빠름)
      const local = await localLoad();
      setAccounts(local);
      setIsLoading(false);

      // 2) 백엔드에서 최신 데이터 가져오기
      const remote = await backendLoad();

      if (remote !== null && remote.length > 0) {
        // 백엔드에 데이터 있음 → 백엔드 우선
        await localSave(remote);
        setAccounts(remote);
        console.log(`[accounts] 백엔드 동기화: ${remote.length}개`);
      } else if (remote !== null && remote.length === 0 && local.length > 0) {
        // 백엔드 비어있고 로컬에 데이터 있음 → 로컬 → 백엔드 업로드
        await backendSave(local);
        console.log('[accounts] 로컬 데이터 백엔드 업로드');
      }
    })();
  }, []);

  // ── 잔고 자동 fetch ───────────────────────────────────────────────────────────
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
          return { id: acc.id, bal: null, err: e?.message ?? '잔고 조회 실패' };
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

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  const addAccount = useCallback(async (
    input: Omit<ExchangeAccount, 'id' | 'createdAt'>,
  ): Promise<ExchangeAccount> => {
    const account: ExchangeAccount = {
      ...input,
      id:        makeId(),
      createdAt: new Date().toISOString(),
    };
    const next = [...accountsRef.current, account];
    await localSave(next);
    setAccounts(next);
    backendSave(next);  // fire-and-forget
    return account;
  }, []);

  const updateAccount = useCallback(async (
    id: string,
    updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>,
  ): Promise<void> => {
    const next = accountsRef.current.map((a) => a.id === id ? { ...a, ...updates } : a);
    await localSave(next);
    setAccounts(next);
    backendSave(next);
  }, []);

  const removeAccount = useCallback(async (id: string): Promise<void> => {
    const next = accountsRef.current.filter((a) => a.id !== id);
    await localSave(next);
    setAccounts(next);
    setBalances((prev) => { const n = { ...prev }; delete n[id]; return n; });
    backendSave(next);
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
