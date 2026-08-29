import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {authService, isProfileComplete} from '../services/authService';
import {recommendationService} from '../services/recommendationService';
import {STORAGE_KEYS} from '../services/api';
import {AuthState, User} from '../types/auth';

interface AuthContextValue extends AuthState {
  signUp: (email: string, password: string, phoneNumber: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  completeProfile: (name: string, username: string) => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Called after onboarding interest picker (pass [] to skip). */
  saveInterests: (interests: string[]) => Promise<void>;
  /** True only during the post-profile-setup interest picker flow for new users. */
  needsInterestSetup: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({children}: {children: React.ReactNode}) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isProfileComplete: false,
    isLoading: true,
  });
  // Only true immediately after a new profile setup — shows interest picker once.
  const [needsInterestSetup, setNeedsInterestSetup] = useState(false);

  // ── Persist tokens ────────────────────────────────────────────────────────
  const saveTokens = useCallback(
    async (accessToken: string, refreshToken: string) => {
      await AsyncStorage.multiSet([
        [STORAGE_KEYS.ACCESS_TOKEN, accessToken],
        [STORAGE_KEYS.REFRESH_TOKEN, refreshToken],
      ]);
    },
    [],
  );

  // ── Bootstrap — restore session on launch ────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [[, accessToken], [, refreshToken]] = await AsyncStorage.multiGet([
          STORAGE_KEYS.ACCESS_TOKEN,
          STORAGE_KEYS.REFRESH_TOKEN,
        ]);

        if (!accessToken || !refreshToken) {
          setState(s => ({...s, isLoading: false}));
          return;
        }

        // Try to fetch the current user (interceptor handles 401 + refresh)
        const user = await authService.getMe();
        setState({
          user,
          accessToken,
          isProfileComplete: isProfileComplete(accessToken),
          isLoading: false,
        });
      } catch {
        // Tokens invalid / network error — clear and force login
        await AsyncStorage.multiRemove([
          STORAGE_KEYS.ACCESS_TOKEN,
          STORAGE_KEYS.REFRESH_TOKEN,
        ]);
        setState({
          user: null,
          accessToken: null,
          isProfileComplete: false,
          isLoading: false,
        });
      }
    })();
  }, []);

  // ── Sign up ───────────────────────────────────────────────────────────────
  const signUp = useCallback(
    async (email: string, password: string, phoneNumber: string) => {
      const tokens = await authService.register(email, password, phoneNumber);
      await saveTokens(tokens.access_token, tokens.refresh_token);
      setState({
        user: null,
        accessToken: tokens.access_token,
        isProfileComplete: isProfileComplete(tokens.access_token),
        isLoading: false,
      });
    },
    [saveTokens],
  );

  // ── Sign in ───────────────────────────────────────────────────────────────
  const signIn = useCallback(
    async (email: string, password: string) => {
      const tokens = await authService.login(email, password);
      await saveTokens(tokens.access_token, tokens.refresh_token);
      const user = await authService.getMe();
      setState({
        user,
        accessToken: tokens.access_token,
        isProfileComplete: isProfileComplete(tokens.access_token),
        isLoading: false,
      });
    },
    [saveTokens],
  );

  // ── Complete profile ──────────────────────────────────────────────────────
  const completeProfile = useCallback(
    async (name: string, username: string) => {
      const tokens = await authService.profileSetup(name, username);
      await saveTokens(tokens.access_token, tokens.refresh_token);
      const user = await authService.getMe();
      setNeedsInterestSetup(true); // trigger interest picker for new users
      setState(s => ({
        ...s,
        user,
        accessToken: tokens.access_token,
        isProfileComplete: true,
      }));
    },
    [saveTokens],
  );

  // ── Save interests (onboarding) ───────────────────────────────────────────
  const saveInterests = useCallback(async (interests: string[]) => {
    await recommendationService.saveInterests(interests);
    setNeedsInterestSetup(false);
  }, []);

  const updateDisplayName = useCallback(async (name: string) => {
    const user = await authService.updateMe(name);
    setState(s => ({
      ...s,
      user,
    }));
  }, []);

  // ── Sign out ──────────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN,
    ]);
    setState({
      user: null,
      accessToken: null,
      isProfileComplete: false,
      isLoading: false,
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({...state, signUp, signIn, completeProfile, updateDisplayName, signOut, saveInterests, needsInterestSetup}),
    [state, signUp, signIn, completeProfile, updateDisplayName, signOut, saveInterests, needsInterestSetup],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
