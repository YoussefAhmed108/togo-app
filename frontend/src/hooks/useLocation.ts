import {useContext} from 'react';
import {LocationContext} from '../context/LocationContext';

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used within a LocationProvider');
  return ctx;
}
