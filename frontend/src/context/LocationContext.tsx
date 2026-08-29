import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {PermissionsAndroid, Platform} from 'react-native';
import Geolocation from '@react-native-community/geolocation';

export type LocationMode = 'current' | 'custom';

export interface LocationState {
  mode: LocationMode;
  label: string;
  lat?: number;
  lng?: number;
}

/**
 * Last-resort origin, used only when the device refuses/fails to give a fix
 * and the user has not picked a custom location.
 */
export const FALLBACK_ORIGIN = {lat: 40.7128, lng: -74.006};

const DEFAULT_LOCATION: LocationState = {mode: 'current', label: 'Current Location'};

export type LocationPermission = 'unknown' | 'granted' | 'denied';

interface LocationContextValue {
  location: LocationState;
  setLocation: (loc: LocationState) => void;
  /** Coordinates every screen measures distances from. */
  origin: {lat: number; lng: number};
  /** Whether `origin` is a real GPS/user-picked position rather than the fallback. */
  hasFix: boolean;
  permission: LocationPermission;
  /** Re-ask for a device fix (also re-prompts if the OS still allows it). */
  refresh: () => void;
}

export const LocationContext = createContext<LocationContextValue | null>(null);

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return res === PermissionsAndroid.RESULTS.GRANTED;
  }
  // iOS: this is what actually raises the system prompt.
  await new Promise<void>(resolve => Geolocation.requestAuthorization(
    () => resolve(),
    () => resolve(),
  ));
  return true; // getCurrentPosition's error callback is the real authority.
}

export function LocationProvider({children}: {children: React.ReactNode}) {
  const [location, setLocation] = useState<LocationState>(DEFAULT_LOCATION);
  const [deviceCoords, setDeviceCoords] = useState<{lat: number; lng: number} | null>(null);
  const [permission, setPermission] = useState<LocationPermission>('unknown');

  const refresh = useCallback(() => {
    ensurePermission().then(ok => {
      if (!ok) {
        setPermission('denied');
        return;
      }
      Geolocation.getCurrentPosition(
        pos => {
          setPermission('granted');
          setDeviceCoords({lat: pos.coords.latitude, lng: pos.coords.longitude});
        },
        () => setPermission('denied'),
        {enableHighAccuracy: false, timeout: 15000, maximumAge: 60000},
      );
    });
  }, []);

  // Ask once at startup; asking again is cheap and only re-prompts if iOS lets it.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Switching back to "Current Location" should re-fetch rather than reuse a
  // possibly hours-old fix.
  const updateLocation = useCallback(
    (loc: LocationState) => {
      setLocation(loc);
      if (loc.mode === 'current') refresh();
    },
    [refresh],
  );

  const value = useMemo<LocationContextValue>(() => {
    const picked =
      location.mode === 'custom' && location.lat != null && location.lng != null
        ? {lat: location.lat, lng: location.lng}
        : null;
    const resolved = picked ?? deviceCoords;
    return {
      location,
      setLocation: updateLocation,
      origin: resolved ?? FALLBACK_ORIGIN,
      hasFix: resolved !== null,
      permission,
      refresh,
    };
  }, [location, deviceCoords, permission, refresh, updateLocation]);

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}
