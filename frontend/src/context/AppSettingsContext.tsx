import React, {createContext, useEffect, useMemo, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {AppThemeName, applyTheme} from '../theme';

const STORAGE_KEY = '@app/theme_name';

interface AppSettingsContextValue {
  themeName: AppThemeName;
  setThemeName: (themeName: AppThemeName) => Promise<void>;
}

export const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({children}: {children: React.ReactNode}) {
  const [themeName, setThemeNameState] = useState<AppThemeName>('light');

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      // Pre-Waypoint presets: midnight was the only dark one.
      const next: AppThemeName = stored === 'dark' || stored === 'midnight' ? 'dark' : 'light';
      applyTheme(next);
      setThemeNameState(next);
    })();
  }, []);

  const setThemeName = async (nextTheme: AppThemeName) => {
    applyTheme(nextTheme);
    setThemeNameState(nextTheme);
    await AsyncStorage.setItem(STORAGE_KEY, nextTheme);
  };

  const value = useMemo(
    () => ({themeName, setThemeName}),
    [themeName],
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}
