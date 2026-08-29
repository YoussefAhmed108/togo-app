import React, {useState} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {LocationMapPicker, PickedLocation} from './LocationMapPicker';
import {LocationMode, LocationState} from '../context/LocationContext';
import {colors, fonts, radius, spacing, typography} from '../theme';

export type {LocationMode, LocationState} from '../context/LocationContext';

interface Props {
  visible: boolean;
  location: LocationState;
  onConfirm: (loc: LocationState) => void;
  onClose: () => void;
}

export function LocationModal({visible, location, onConfirm, onClose}: Props) {
  const [mode, setMode] = useState<LocationMode>(location.mode);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);

  function handleCurrentConfirm() {
    onConfirm({mode: 'current', label: 'Current Location'});
  }

  function handleMapConfirm(picked: PickedLocation) {
    setMapPickerOpen(false);
    onConfirm({
      mode: 'custom',
      label: picked.label,
      lat: picked.lat,
      lng: picked.lng,
    });
  }

  return (
    <>
      {/*
        iOS presents one modal at a time, so the sheet must be hidden while the
        full-screen map picker is up — otherwise the picker never appears.
      */}
      <Modal
        visible={visible && !mapPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={onClose}>
        {/* Backdrop */}
        <Pressable style={styles.backdrop} onPress={onClose} />

        {/* Bottom sheet */}
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />

          <Text style={styles.title}>Change Location</Text>
          <Text style={styles.sub}>Choose where to discover places from.</Text>

          {/* Option — Current Location */}
          <TouchableOpacity
            style={[styles.option, mode === 'current' && styles.optionActive]}
            onPress={() => setMode('current')}
            activeOpacity={0.7}>
            <View style={[styles.radio, mode === 'current' && styles.radioActive]}>
              {mode === 'current' && <View style={styles.radioDot} />}
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>Use Current Location</Text>
              <Text style={styles.optionHint}>Uses your device GPS</Text>
            </View>
          </TouchableOpacity>

          {/* Option — Custom Location */}
          <TouchableOpacity
            style={[styles.option, mode === 'custom' && styles.optionActive]}
            onPress={() => setMode('custom')}
            activeOpacity={0.7}>
            <View style={[styles.radio, mode === 'custom' && styles.radioActive]}>
              {mode === 'custom' && <View style={styles.radioDot} />}
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>Set a Custom Location</Text>
              <Text style={styles.optionHint}>Search or drop a pin on the map</Text>
            </View>
          </TouchableOpacity>

          {/* Action button */}
          {mode === 'current' ? (
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={handleCurrentConfirm}
              activeOpacity={0.85}>
              <Text style={styles.confirmText}>Use Current Location</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.mapBtn}
              onPress={() => setMapPickerOpen(true)}
              activeOpacity={0.85}>
              <Text style={styles.mapBtnText}>Choose on Map</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>

      {/* Full-screen map picker — rendered outside the bottom sheet modal */}
      <LocationMapPicker
        visible={mapPickerOpen}
        onConfirm={handleMapConfirm}
        onClose={() => setMapPickerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, backgroundColor: colors.overlay},
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingBottom: 40,
    paddingTop: spacing.md,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.sandDeep,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  title: {...typography.h2, fontSize: 24, marginBottom: 4},
  sub: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 18,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  optionActive: {
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primaryLight,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.sandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {borderColor: colors.primary},
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  optionText: {flex: 1},
  optionLabel: {
    fontFamily: fonts.regular,
    fontSize: 16.5,
    color: colors.text,
    marginBottom: 2,
  },
  optionHint: {fontFamily: fonts.regular, fontSize: 14, color: colors.textSecondary},

  confirmBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  confirmText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},

  mapBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  mapBtnText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},
});
