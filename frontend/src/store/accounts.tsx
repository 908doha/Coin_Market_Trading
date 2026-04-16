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
import { positionsService } from '../services/positions.service';
import type { Balance } from '../services/account.service';
import type { Position } from '../services/positions.service';
import { saveIctSnapshot, saveIctSnapshotWithHistory, loadIctSnapshot, pushIctSnapshotRemote } from '../utils/ictSnapshot';
import { savePositionSnapshotWithHistory } from '../utils/positionSnapshot';
import { appendPricePoint } from '../utils/priceHistory';
import { appendBalanceSnapshot, syncBalanceHistory, pushBalanceHistory } from '../utils/balanceHistory';

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
  positions:       Position[];
  historyVersion:  number;  // 원격 잔고 이력 sync 완료 시 증가 → home.tsx 차트 갱신 트리거
  addAccount:      (input: Omit<ExchangeAccount, 'id' | 'createdAt'>) => Promise<ExchangeAccount>;
  updateAccount:   (id: string, updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>) => Promise<void>;
  removeAccount:   (id: string) => Promise<void>;
  refreshBalances:  () => Promise<void>;
  refreshPositions: () => Promise<void>;
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

// KST 형식 "2025.01.19 (일) 18:07" → UTC Unix 초
function parseKstEntryTs(s: string): number {
  if (!s || s === '-') return 0;
  const ts = Date.parse(s);
  if (!isNaN(ts)) return Math.floor(ts / 1000);
  const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})\s+\([^)]+\)\s+(\d{2}):(\d{2})/);
  if (m) {
    const utcMs = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`).getTime();
    return isNaN(utcMs) ? 0 : Math.floor(utcMs / 1000);
  }
  return 0;
}

export function AccountsProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts]          = useState<ExchangeAccount[]>([]);
  const [isLoading, setIsLoading]        = useState(true);
  const [balances, setBalances]          = useState<Record<string, Balance | null>>({});
  const [balanceErrors, setBalErrors]    = useState<Record<string, string | null>>({});
  const [balancesLoading, setBalLoading] = useState(false);
  const [positions, setPositions]        = useState<Position[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const accountsRef        = useRef(accounts);
  const firstBalLoad       = useRef(true);   // skeleton은 최초 1회만
  const capturedContracts  = useRef<Set<string>>(new Set()); // 이번 세션에 ICT 캡처 시도한 계약
  const lastRemotePushRef  = useRef<number>(0);  // 마지막 Supabase push 시각 (ms)
  accountsRef.current = accounts;

  // 앱 시작 + 토큰 변경 시: 로컬 → 백엔드 순서로 로드
  const syncFromBackend = useCallback(async () => {
    const local = await localLoad();
    setAccounts(local);
    setIsLoading(false);

    const remote = await backendLoad();
    const resolvedAccounts = remote && remote.length > 0 ? remote : local;

    if (remote && remote.length > 0) {
      setAccounts(remote);
      await localSave(remote);
      console.log(`[accounts] synced ${remote.length} accounts from backend`);
    } else if (local.length > 0 && remote !== null) {
      await backendSave(local);
      console.log('[accounts] uploaded local accounts to backend');
    }

    // 잔고 이력 원격 동기화 (백그라운드 — 완료 시 historyVersion 증가 → 홈 차트 갱신)
    if (resolvedAccounts.length > 0) {
      const syncs = [
        syncBalanceHistory(),                            // 전체 합산
        ...resolvedAccounts.map((a) => syncBalanceHistory(a.id)),  // 계좌별
      ];
      Promise.all(syncs).then((results) => {
        if (results.some(Boolean)) {
          setHistoryVersion((v) => v + 1);
          console.log('[balance-history] remote sync 완료 — 홈 차트 갱신');
        }
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    syncFromBackend();
  }, []);

  // 로그인 후 토큰이 생기면 재동기화 (토큰 없이 마운트된 경우 대비)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let lastToken = localStorage.getItem(TOKEN_KEY);

    const interval = setInterval(() => {
      const current = localStorage.getItem(TOKEN_KEY);
      if (current && current !== lastToken) {
        lastToken = current;
        console.log('[accounts] 토큰 감지 → 백엔드 재동기화');
        syncFromBackend();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [syncFromBackend]);

  // 잔고 자동 fetch — 첫 로드만 로딩 표시, 이후 5초 폴링은 silent
  const refreshBalances = useCallback(async () => {
    const list = accountsRef.current;
    if (!list.length) return;
    // 스켈레톤은 최초 로드 한 번만, 이후 갱신은 AnimatedNumber 룰렛만 사용
    if (firstBalLoad.current) setBalLoading(true);
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
    firstBalLoad.current = false;
    // 총 자산 스냅샷 저장 (5분 간격 — 홈 차트 실제 잔고 이력용)
    const snap = sumBalances(Object.values(map));
    if (snap?.total) appendBalanceSnapshot(snap.total);
    // 계좌별 스냅샷도 별도 저장 (계좌 선택 필터용)
    for (const [accId, bal] of Object.entries(map)) {
      if (bal?.total) appendBalanceSnapshot(bal.total, accId);
    }

    // 30분마다 Supabase로 신규 스냅샷 push (백그라운드)
    const now = Date.now();
    if (now - lastRemotePushRef.current > 30 * 60 * 1000) {
      lastRemotePushRef.current = now;
      const accIds = Object.keys(map);
      Promise.all([
        pushBalanceHistory(),
        ...accIds.map((id) => pushBalanceHistory(id)),
      ]).catch(() => {});
    }
  }, []);

  // 포지션 silent refresh (로딩 표시 없이 갱신) + 신규 포지션 ICT 스냅샷 자동 캡처
  const refreshPositions = useCallback(async () => {
    const list = accountsRef.current;
    if (!list.length) return;
    try {
      const pos = await positionsService.getAllByAccounts(list);
      setPositions(pos);

      // 폴링마다 모든 활성 포지션의 현재가 이력 저장
      for (const p of pos) {
        const contract = p.symbol.replace('/', '_');
        const entryAt  = (p as any).entryAt ?? '';
        const markPrice = p.markPrice ?? (p as any).currentPrice ?? p.entryPrice;
        appendPricePoint(contract, entryAt, markPrice);
      }

      // 모든 활성 포지션 스냅샷 저장 (매 폴링 — TP/SL 변경 즉시 반영)
      for (const p of pos) {
        const contract = p.symbol.replace('/', '_');
        const entryAt  = (p as any).entryAt ?? '';
        const usdtKrw  = (p as any).usdtKrw ?? 1350;
        const entryTs  = parseKstEntryTs(entryAt);

        const notionalUsdt = (p.amount / usdtKrw) * p.leverage;
        const qty          = p.entryPrice > 0 ? notionalUsdt / p.entryPrice : 0;
        const coinQtyStr   = qty <= 0 ? '-' : qty < 0.001 ? qty.toFixed(6) : qty < 1 ? qty.toFixed(4) : qty.toFixed(3);
        savePositionSnapshotWithHistory({
          contract,
          entryAt,
          coinQty:     coinQtyStr !== '-' ? `${coinQtyStr} ${p.coin}` : '-',
          coin:        p.coin,
          amount:      p.amount,
          leverage:    p.leverage,
          liqPrice:    (p as any).liqPrice ?? 0,
          usdtKrw,
          stopLoss:    p.stopLoss    ?? undefined,
          targetPrice: p.targetPrice ?? undefined,
        }, entryTs);
      }

      // 신규 포지션(또는 재진입) 감지 → ICT 스냅샷 자동 캡처 (한 번만)
      for (const p of pos) {
        const contract   = p.symbol.replace('/', '_');
        const entryAt    = (p as any).entryAt ?? '';
        const sessionKey = `${contract}_${entryAt}`;

        if (capturedContracts.current.has(sessionKey)) continue;
        capturedContracts.current.add(sessionKey);

        // 저장된 ICT 스냅샷이 같은 진입 시간이면 재사용
        const stored = loadIctSnapshot(contract);
        if (stored && stored.entryAt === entryAt) continue;

        // 새 포지션 진입 → 백그라운드로 ICT 분석 캡처
        const account = list.find((a) => a.id === (p as any).accountId) ?? list[0];
        if (!account?.apiKey || !account?.apiSecret) continue;

        const entryTs = parseKstEntryTs(entryAt);

        fetch('/api/ict-analyze', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ apiKey: account.apiKey, apiSecret: account.apiSecret, contract }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data?.htf !== undefined) {
              saveIctSnapshotWithHistory(contract, entryAt, entryTs, data);
              pushIctSnapshotRemote(contract, entryTs, entryAt, data);
            }
          })
          .catch(() => {});
      }
    } catch (e) {
      console.error('[positions] refresh error:', e);
    }
  }, []);

  useEffect(() => {
    if (!isLoading && accounts.length > 0) {
      refreshBalances();
      refreshPositions();
    }
  }, [isLoading, accounts.length]);

  // 5초마다 잔고 + 포지션 자동 갱신
  useEffect(() => {
    if (isLoading || accounts.length === 0) return;
    const id = setInterval(() => {
      refreshBalances();
      refreshPositions();
    }, 5_000);
    return () => clearInterval(id);
  }, [isLoading, accounts.length, refreshBalances, refreshPositions]);

  const totalBalance = accounts.length
    ? sumBalances(accounts.map((a) => balances[a.id] ?? null))
    : null;

  // ── CRUD — 로컬 우선, 백엔드 background sync ─────────────────────────────────

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
    backendSave(next);   // background
    return account;
  }, []);

  const updateAccount = useCallback(async (
    id: string,
    updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>,
  ): Promise<void> => {
    const next = accountsRef.current.map((a) => a.id === id ? { ...a, ...updates } : a);
    await localSave(next);
    setAccounts(next);
    backendSave(next);   // background
  }, []);

  const removeAccount = useCallback(async (id: string): Promise<void> => {
    const next = accountsRef.current.filter((a) => a.id !== id);
    await localSave(next);
    setAccounts(next);
    setBalances((prev) => { const n = { ...prev }; delete n[id]; return n; });
    backendSave(next);   // background
  }, []);

  return (
    <AccountsContext.Provider value={{
      accounts, isLoading,
      balances, balanceErrors, totalBalance, balancesLoading,
      positions,
      historyVersion,
      addAccount, updateAccount, removeAccount, refreshBalances, refreshPositions,
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
