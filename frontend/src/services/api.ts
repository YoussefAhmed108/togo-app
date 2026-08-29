import axios, {AxiosError, InternalAxiosRequestConfig} from 'axios';
import {Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Host the app talks to in development.
// Simulator / emulator: leave as null — the per-platform defaults below apply.
// PHYSICAL DEVICE: set your Mac's LAN IP (`ipconfig getifaddr en0`), e.g. '192.168.1.33'.
// On a real phone "localhost" means the phone itself, so the app cannot reach your Mac.
const DEV_HOST: string | null = '192.168.1.33';

// Android emulator → 10.0.2.2, iOS simulator → localhost
const BASE_URL = __DEV__
  ? DEV_HOST
    ? `http://${DEV_HOST}:8080/api/v1`
    : Platform.OS === 'android'
      ? 'http://10.0.2.2:8080/api/v1'
      : 'http://localhost:8080/api/v1'
  : 'https://your-production-api.com/api/v1';

export const STORAGE_KEYS = {
  REFRESH_TOKEN: '@app/refresh_token',
  ACCESS_TOKEN: '@app/access_token',
};

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {'Content-Type': 'application/json'},
});

// ── Request interceptor — attach stored access token ────────────────────────
api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor — refresh on 401 ───────────────────────────────────
let isRefreshing = false;
let failedQueue: {
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}[] = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach(p => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
}

api.interceptors.response.use(
  res => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({resolve, reject});
      })
        .then(token => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        })
        .catch(err => Promise.reject(err));
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = await AsyncStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      if (!refreshToken) throw new Error('no refresh token');

      const res = await axios.post(`${BASE_URL}/auth/refresh`, {
        refresh_token: refreshToken,
      });

      const {access_token, refresh_token} = res.data.data;
      await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, access_token);
      await AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refresh_token);

      api.defaults.headers.common.Authorization = `Bearer ${access_token}`;
      processQueue(null, access_token);

      original.headers.Authorization = `Bearer ${access_token}`;
      return api(original);
    } catch (err) {
      processQueue(err, null);
      // Clear tokens — force re-login
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.ACCESS_TOKEN,
        STORAGE_KEYS.REFRESH_TOKEN,
      ]);
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);

export default api;
