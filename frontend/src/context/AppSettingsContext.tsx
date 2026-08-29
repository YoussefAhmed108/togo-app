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
  const [themeName, setThemeNameState] = useState<AppThemeName>('sunrise');

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored === 'sunrise' || stored === 'midnight' || stored === 'grove') {
        applyTheme(stored);
        setThemeNameState(stored);
        return;
      }

      applyTheme('sunrise');
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
