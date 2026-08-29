import React, {useCallback, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, {PROVIDER_GOOGLE, Region} from 'react-native-maps';
import {GooglePlacesAutocomplete} from 'react-native-google-places-autocomplete';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {GOOGLE_MAPS_API_KEY} from '../config/maps';
import {colors, fonts, radius, spacing, typography} from '../theme';
import {Pin} from './Pin';

// Default map region — New York City. Map opens here on first load.
const DEFAULT_REGION: Region = {
  latitude: 40.7128,
  longitude: -74.006,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export interface PickedLocation {
  label: string;
  lat: number;
  lng: number;
}

interface Props {
  visible: boolean;
  onConfirm: (loc: PickedLocation) => void;
  onClose: () => void;
}

export function LocationMapPicker({visible, onConfirm, onClose}: Props) {
  const mapRef = useRef<MapView>(null);
  // SafeAreaView reports zero insets inside an iOS Modal — read them from the
  // provider instead so the header clears the status bar / notch.
  const insets = useSafeAreaInsets();

  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [locationLabel, setLocationLabel] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  // A search pick already carries a real address — don't let the map settling
  // afterwards overwrite it with a (possibly failed) reverse geocode.
  const skipNextGeocode = useRef(false);

  // Reverse geocode center coordinates → human-readable address
  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    setIsGeocoding(true);
    try {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.results?.[0]) {
        setLocationLabel(data.results[0].formatted_address);
      } else {
        setLocationLabel(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    } catch {
      setLocationLabel(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } finally {
      setIsGeocoding(false);
    }
  }, []);

  const handleRegionChangeComplete = useCallback(
    (r: Region) => {
      setRegion(r);
      setIsMoving(false);
      if (skipNextGeocode.current) {
        skipNextGeocode.current = false;
        return;
      }
      reverseGeocode(r.latitude, r.longitude);
    },
    [reverseGeocode],
  );

  const handleSelect = useCallback(() => {
    if (!locationLabel || isGeocoding || isMoving) return;
    onConfirm({label: locationLabel, lat: region.latitude, lng: region.longitude});
  }, [locationLabel, isGeocoding, isMoving, region, onConfirm]);

  const canConfirm = !!locationLabel && !isGeocoding && !isMoving;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={[styles.safe, {paddingTop: insets.top}]}>
        {/* ── Header ─────────────────────────────────────────── */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={12}>
            <Text style={styles.backArrow}>‹</Text>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Pick a Location</Text>
          <View style={styles.headerRight} />
        </View>

        {/* ── Map + overlaid search bar ───────────────────────── */}
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            initialRegion={DEFAULT_REGION}
            showsUserLocation
            showsMyLocationButton={false}
            onRegionChange={() => {
              if (!isMoving) setIsMoving(true);
            }}
            onRegionChangeComplete={handleRegionChangeComplete}
          />

          {/* Center pin — floats above map, never moves */}
          <View style={styles.pinOverlay} pointerEvents="none">
            <View style={[styles.pin, isMoving && styles.pinLifted]}>
              <Pin size={30} color={colors.primary} filled />
            </View>
            <View style={[styles.pinDot, isMoving && styles.pinDotLifted]} />
          </View>

          {/* Search bar floats over the map */}
          <View style={styles.searchOverlay}>
            <GooglePlacesAutocomplete
              placeholder="Search for a place or address…"
              fetchDetails
              onPress={(data, details = null) => {
                const loc = details?.geometry?.location;
                if (!loc) return;
                const newRegion: Region = {
                  latitude: loc.lat,
                  longitude: loc.lng,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                };
                skipNextGeocode.current = true;
                mapRef.current?.animateToRegion(newRegion, 500);
                setRegion(newRegion);
                setLocationLabel(data.description);
              }}
              query={{key: GOOGLE_MAPS_API_KEY, language: 'en'}}
              enablePoweredByContainer={false}
              keyboardShouldPersistTaps="always"
              styles={{
                container: searchStyles.container,
                textInputContainer: searchStyles.inputContainer,
                textInput: searchStyles.input,
                listView: searchStyles.listView,
                row: searchStyles.row,
                description: searchStyles.description,
                separator: searchStyles.separator,
              }}
            />
          </View>
        </View>

        {/* ── Bottom confirm bar ──────────────────────────────── */}
        <View style={styles.bottomBar}>
          <View style={styles.previewRow}>
            {isMoving || isGeocoding ? (
              <View style={styles.geocodingRow}>
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={styles.geocodingText}>Finding location…</Text>
              </View>
            ) : (
              <>
                <Pin size={18} color={colors.primary} filled />
                <Text style={styles.previewLabel} numberOfLines={2}>
                  {locationLabel || 'Move the map to choose a location'}
                </Text>
              </>
            )}
          </View>

          <TouchableOpacity
            style={[styles.confirmBtn, !canConfirm && styles.confirmBtnOff]}
            onPress={handleSelect}
            disabled={!canConfirm}
            activeOpacity={0.85}>
            <Text style={styles.confirmText}>Select This Location</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  backBtn: {flexDirection: 'row', alignItems: 'center', width: 74, gap: 2},
  backArrow: {fontSize: 24, color: colors.primary, lineHeight: 26},
  backText: {fontFamily: fonts.medium, fontSize: 16, color: colors.primary},
  headerTitle: {...typography.h2, fontSize: 19, textAlign: 'center'},
  headerRight: {width: 74},

  // Map
  mapContainer: {flex: 1, overflow: 'hidden', backgroundColor: colors.sand},
  map: {flex: 1},

  // Center pin overlay
  pinOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pin: {marginBottom: -18, transform: [{translateY: -18}]},
  pinLifted: {transform: [{translateY: -28}], opacity: 0.9},
  pinDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(45,42,36,0.25)',
    marginTop: 18,
  },
  pinDotLifted: {
    width: 10,
    height: 4,
    borderRadius: 5,
    backgroundColor: 'rgba(45,42,36,0.15)',
    marginTop: 28,
  },

  // Search bar overlaid on top of map
  searchOverlay: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    zIndex: 10,
  },

  // Bottom bar
  bottomBar: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 36,
  },
  previewLabel: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
  },
  geocodingRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  geocodingText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
  },
  confirmBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnOff: {backgroundColor: colors.sandDeep},
  confirmText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},
});

// Styles for GooglePlacesAutocomplete (passed as prop, plain objects)
const searchStyles = {
  container: {flex: 0, zIndex: 10},
  inputContainer: {
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    shadowColor: '#4A3B28',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    paddingHorizontal: 0,
    height: 52,
  },
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    height: 52,
    paddingLeft: spacing.lg,
  },
  listView: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginTop: 6,
    shadowColor: '#4A3B28',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
    zIndex: 20,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  description: {fontFamily: fonts.regular, fontSize: 15, color: colors.text},
  separator: {height: 1, backgroundColor: colors.border},
};
