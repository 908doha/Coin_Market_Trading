/**
 * Exchange Accounts Store
 * - localStorage를 주 저장소로 사용 (즉시 작동, 오프라인 지원)
 * - 로그인 상태일 때 /api/user-accounts 와 자동 동기화 (기기 간 유지)
 * - 백엔드 없어도 localStorage로 정상 동작
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

// ── 로컬 저장소 ───────────────────────────────────────────────────────────────

async function localLoad(): Promise<ExchangeAccount[]> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem(STORAGE_KEY)
      : await SecureStore.getItemAsync(STORAGE_KEY);
    const result = raw ? (JSON.parse(raw) as ExchangeAccount[]) : [];
    console.log(`[accounts] loaded ${result.length} accounts from local`);
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
  console.log(`[accounts] saved ${accounts.length} accounts to local`);
}

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── 백엔드 동기화 ─────────────────────────────────────────────────────────────

function getToken(): string | null {
  if (Platform.OS !== 'web') return null;
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

async function backendLoad(): Promise<ExchangeAccount[] | null> {
  const token = getToken();
  if (!token) {
    console.warn('[accounts] backendLoad: 토큰 없음 — 로그인 상태 확인 필요');
    return null;
  }
  try {
    const res = await fetch('/api/user-accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 204) {
      console.warn('[accounts] backendLoad: DATABASE_URL 미설정 — Vercel 환경변수 확인 필요');
      return null;
    }
    console.log('[accounts] backendLoad status:', res.status);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[accounts] backendLoad 실패:', res.status, body);
      return null;
    }
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch (e) {
    console.error('[accounts] backendLoad 네트워크 오류:', e);
    return null;
  }
}

async function backendSave(accounts: ExchangeAccount[]): Promise<void> {
  const token = getToken();
  if (!token) {
    console.warn('[accounts] backendSave: 토큰 없음 — DB 동기화 건너뜀');
    return;
  }
  try {
    const res = await fetch('/api/user-accounts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify(accounts),
    });
    if (res.status === 204) {
      console.warn('[accounts] backendSave: DATABASE_URL 미설정 — Vercel 환경변수 확인 필요');
    } else if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[accounts] backendSave 실패:', res.status, body);
    } else {
      console.log('[accounts] backendSave 성공 ✓', res.status);
    }
  } catch (e) {
    console.error('[accounts] backendSave 네트워크 오류:', e);
  }
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
  // 초기 동기화 중 로컬 변경이 발생했는지 추적 (race condition 방지)
  const hasMutated = useRef(false);

  // 앱 시작: 로컬 → 백엔드 순서로 로드
  useEffect(() => {
    (async () => {
      // ① 로컬 즉시 로드 (빠름)
      const local = await localLoad();
      setAccounts(local);
      setIsLoading(false);

      // ② 백엔드에서 최신 데이터 가져오기 (기기 간 동기화)
      const remote = await backendLoad();

      // 초기 동기화 중 사용자가 계좌를 추가/수정/삭제한 경우 → 백엔드 데이터로 덮어쓰지 않음
      if (hasMutated.current) {
        console.log('[accounts] 초기 동기화 중 로컬 변경 감지 — 백엔드 덮어쓰기 건너뜀');
        // 로컬이 최신이므로 백엔드에 현재 로컬 데이터를 업로드
        await backendSave(accountsRef.current);
        return;
      }

      if (remote && remote.length > 0) {
        // 원격 데이터를 로컬보다 우선시 (서버가 source-of-truth)
        setAccounts(remote);
        await localSave(remote);
        console.log(`[accounts] synced ${remote.length} accounts from backend`);
      } else if (local.length > 0 && remote !== null) {
        // 서버에 없고 로컬에 있을 때 → 서버로 업로드
        await backendSave(local);
        console.log('[accounts] uploaded local accounts to backend');
      }
    })();
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

  // ── CRUD — 로컬 우선, 백엔드 background sync ─────────────────────────────────

  const addAccount = useCallback(async (
    input: Omit<ExchangeAccount, 'id' | 'createdAt'>,
  ): Promise<ExchangeAccount> => {
    hasMutated.current = true;
    const account: ExchangeAccount = {
      ...input,
      id:        makeId(),
      createdAt: new Date().toISOString(),
    };
    const next = [...accountsRef.current, account];
    await localSave(next);
    setAccounts(next);
    backendSave(next).catch((e) => console.error('[accounts] backendSave 실패:', e));
    return account;
  }, []);

  const updateAccount = useCallback(async (
    id: string,
    updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>,
  ): Promise<void> => {
    hasMutated.current = true;
    const next = accountsRef.current.map((a) => a.id === id ? { ...a, ...updates } : a);
    await localSave(next);
    setAccounts(next);
    backendSave(next).catch((e) => console.error('[accounts] backendSave 실패:', e));
  }, []);

  const removeAccount = useCallback(async (id: string): Promise<void> => {
    hasMutated.current = true;
    const next = accountsRef.current.filter((a) => a.id !== id);
    await localSave(next);
    setAccounts(next);
    setBalances((prev) => { const n = { ...prev }; delete n[id]; return n; });
    backendSave(next).catch((e) => console.error('[accounts] backendSave 실패:', e));
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
