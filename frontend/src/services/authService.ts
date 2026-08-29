import api from './api';
import {AuthTokens, User} from '../types/auth';

interface TokenResponse {
  data: AuthTokens;
}

interface UserResponse {
  data: User;
}

export const authService = {
  register: async (email: string, password: string, phoneNumber: string): Promise<AuthTokens> => {
    const res = await api.post<TokenResponse>('/auth/register', {
      email,
      password,
      phone_number: phoneNumber,
    });
    return res.data.data;
  },

  login: async (email: string, password: string): Promise<AuthTokens> => {
    const res = await api.post<TokenResponse>('/auth/login', {email, password});
    return res.data.data;
  },

  refresh: async (refreshToken: string): Promise<AuthTokens> => {
    const res = await api.post<TokenResponse>('/auth/refresh', {
      refresh_token: refreshToken,
    });
    return res.data.data;
  },

  profileSetup: async (name: string, username: string): Promise<AuthTokens> => {
    const res = await api.post<TokenResponse>('/auth/profile-setup', {name, username});
    return res.data.data;
  },

  getMe: async (): Promise<User> => {
    const res = await api.get<UserResponse>('/users/me');
    return res.data.data;
  },

  updateMe: async (name: string): Promise<User> => {
    const res = await api.put<UserResponse>('/users/me', {name});
    return res.data.data;
  },
};

/** Decode the `pc` (profileComplete) claim from a JWT without a library. */
export function isProfileComplete(accessToken: string): boolean {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1]));
    return !!payload.pc;
  } catch {
    return false;
  }
}
