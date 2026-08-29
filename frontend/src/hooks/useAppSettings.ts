import {useContext} from 'react';
import {AppSettingsContext} from '../context/AppSettingsContext';

export function useAppSettings() {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) {
    throw new Error('useAppSettings must be used inside <AppSettingsProvider>');
  }
  return ctx;
}
