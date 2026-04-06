import { client, tokenStorage } from './client';

export interface LoginRequest {
  email:    string;
  password: string;
}

export interface SignupRequest {
  email:    string;
  password: string;
}

export interface AuthResponse {
  access:  string;
  refresh: string;
  user: {
    id:       string;
    email:    string;
    name:     string;
    joinedAt: string;
  };
}

export interface SendCodeRequest  { email: string }
export interface VerifyCodeRequest { email: string; code: string }

export const authService = {
  async login(body: LoginRequest): Promise<AuthResponse> {
    const res = await client.post<AuthResponse>('/auth/login', body);
    await tokenStorage.setAccess(res.access);
    await tokenStorage.setRefresh(res.refresh);
    return res;
  },

  async signup(body: SignupRequest): Promise<AuthResponse> {
    const res = await client.post<AuthResponse>('/auth/signup', body);
    await tokenStorage.setAccess(res.access);
    await tokenStorage.setRefresh(res.refresh);
    return res;
  },

  async sendVerificationCode(body: SendCodeRequest): Promise<void> {
    await client.post<void>('/auth/send-code', body);
  },

  async verifyCode(body: VerifyCodeRequest): Promise<void> {
    await client.post<void>('/auth/verify-code', body);
  },

  async logout(): Promise<void> {
    try { await client.post<void>('/auth/logout'); } catch {}
    await tokenStorage.clear();
  },
};
