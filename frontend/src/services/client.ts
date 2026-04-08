/**
 * HTTP Client
 * - Base URL from EXPO_PUBLIC_API_URL
 * - JWT Bearer token auto-attach
 * - 401 → token refresh → retry
 * - Typed response / error handling
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

const TOKEN_KEY   = 'jwt_access';
const REFRESH_KEY = 'jwt_refresh';

// ─── Token storage (SecureStore on mobile, localStorage on web) ───────────────

export const tokenStorage = {
  async getAccess(): Promise<string | null> {
    if (Platform.OS === 'web') return localStorage.getItem(TOKEN_KEY);
    return SecureStore.getItemAsync(TOKEN_KEY);
  },
  async setAccess(token: string): Promise<void> {
    if (Platform.OS === 'web') { localStorage.setItem(TOKEN_KEY, token); return; }
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  },
  async getRefresh(): Promise<string | null> {
    if (Platform.OS === 'web') return localStorage.getItem(REFRESH_KEY);
    return SecureStore.getItemAsync(REFRESH_KEY);
  },
  async setRefresh(token: string): Promise<void> {
    if (Platform.OS === 'web') { localStorage.setItem(REFRESH_KEY, token); return; }
    await SecureStore.setItemAsync(REFRESH_KEY, token);
  },
  async clear(): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      return;
    }
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ]);
  },
};

// ─── Error class ─────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Internal fetch with retry ───────────────────────────────────────────────

let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

async function refreshAccessToken(): Promise<string> {
  const refreshToken = await tokenStorage.getRefresh();
  if (!refreshToken) throw new ApiError(401, 'NO_REFRESH_TOKEN', '로그인이 필요합니다.');

  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ refresh: refreshToken }),
  });
  if (!res.ok) {
    await tokenStorage.clear();
    throw new ApiError(401, 'REFRESH_FAILED', '세션이 만료됐어요. 다시 로그인해주세요.');
  }
  const data = await res.json();
  await tokenStorage.setAccess(data.access);
  return data.access;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const accessToken = await tokenStorage.getAccess();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // 401 → refresh → retry once
  if (res.status === 401 && retry) {
    if (isRefreshing) {
      const newToken = await new Promise<string>((resolve) => refreshQueue.push(resolve));
      return request<T>(path, options, false);
    }
    isRefreshing = true;
    try {
      const newToken = await refreshAccessToken();
      refreshQueue.forEach((cb) => cb(newToken));
      refreshQueue = [];
      return request<T>(path, options, false);
    } finally {
      isRefreshing = false;
    }
  }

  if (!res.ok) {
    let code    = 'UNKNOWN_ERROR';
    let message = '오류가 발생했어요. 잠시 후 다시 시도해주세요.';
    try {
      const err = await res.json();
      code    = err.code    ?? code;
      message = err.message ?? message;
    } catch {}
    throw new ApiError(res.status, code, message);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const client = {
  get:    <T>(path: string)                        => request<T>(path, { method: 'GET'    }),
  post:   <T>(path: string, body?: unknown)        => request<T>(path, { method: 'POST',  body: JSON.stringify(body) }),
  patch:  <T>(path: string, body?: unknown)        => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string)                        => request<T>(path, { method: 'DELETE' }),
};
