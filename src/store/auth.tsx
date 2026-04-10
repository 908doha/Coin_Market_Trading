import React, { createContext, useContext, useEffect, useReducer } from 'react';
import { Platform } from 'react-native';
import { tokenStorage, authService } from '@/services';
import type { AuthResponse } from '@/services';

const USER_KEY = 'auth_user_v1';

function saveUser(user: User) {
  try {
    if (Platform.OS === 'web') localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {}
}

function loadUser(): User | null {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    }
  } catch {}
  return null;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface User {
  id:       string;
  email:    string;
  name:     string;
  joinedAt: string;
}

interface AuthState {
  user:        User | null;
  isLoading:   boolean;   // 초기 토큰 체크 중
  isLoggedIn:  boolean;
}

type AuthAction =
  | { type: 'INIT_START' }
  | { type: 'INIT_DONE'; payload: User | null }
  | { type: 'LOGIN';  payload: User }
  | { type: 'LOGOUT' };

interface AuthContextValue extends AuthState {
  login:  (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

function reducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'INIT_START':
      return { ...state, isLoading: true };
    case 'INIT_DONE':
      return {
        isLoading:  false,
        user:       action.payload,
        isLoggedIn: !!action.payload,
      };
    case 'LOGIN':
      return { isLoading: false, user: action.payload, isLoggedIn: true };
    case 'LOGOUT':
      return { isLoading: false, user: null, isLoggedIn: false };
    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    user:       null,
    isLoading:  true,
    isLoggedIn: false,
  });

  // 앱 시작 시 저장된 토큰 + 유저 정보로 자동 로그인
  useEffect(() => {
    (async () => {
      dispatch({ type: 'INIT_START' });
      try {
        const token = await tokenStorage.getAccess();
        if (token) {
          // 저장된 유저 정보 복원 → 재로그인 불필요
          const saved = loadUser();
          dispatch({ type: 'INIT_DONE', payload: saved });
        } else {
          dispatch({ type: 'INIT_DONE', payload: null });
        }
      } catch {
        await tokenStorage.clear();
        dispatch({ type: 'INIT_DONE', payload: null });
      }
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await authService.login({ email, password });
    saveUser(res.user);
    dispatch({ type: 'LOGIN', payload: res.user });
  };

  const signup = async (email: string, password: string) => {
    const res = await authService.signup({ email, password });
    saveUser(res.user);
    dispatch({ type: 'LOGIN', payload: res.user });
  };

  const logout = async () => {
    await authService.logout();
    try { if (Platform.OS === 'web') localStorage.removeItem(USER_KEY); } catch {}
    dispatch({ type: 'LOGOUT' });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
