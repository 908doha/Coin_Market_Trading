import React, { createContext, useContext, useEffect, useReducer } from 'react';
import { tokenStorage, authService } from '@/services';
import type { AuthResponse } from '@/services';

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

  // 앱 시작 시 저장된 토큰으로 자동 로그인 체크
  useEffect(() => {
    (async () => {
      dispatch({ type: 'INIT_START' });
      try {
        const token = await tokenStorage.getAccess();
        if (token) {
          // TODO: GET /auth/me 로 유저 정보 가져오기
          // const user = await client.get<User>('/auth/me');
          // dispatch({ type: 'INIT_DONE', payload: user });
          dispatch({ type: 'INIT_DONE', payload: null }); // 임시: 토큰 있어도 재로그인
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
    dispatch({ type: 'LOGIN', payload: res.user });
  };

  const signup = async (email: string, password: string) => {
    const res = await authService.signup({ email, password });
    dispatch({ type: 'LOGIN', payload: res.user });
  };

  const logout = async () => {
    await authService.logout();
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
