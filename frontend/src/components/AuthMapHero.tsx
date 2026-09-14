import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MapView, {PROVIDER_GOOGLE} from 'react-native-maps';
import {AppLogo} from './AppLogo';
import {colors, fonts} from '../theme';

// ponytail: a real, muted Google map stands in for the design's drawn city —
// no SVG dependency. Fixed on central Cairo, the product's home market.
const CAIRO = {latitude: 30.052, longitude: 31.228, latitudeDelta: 0.06, longitudeDelta: 0.06};

const PALE_MAP = [
  {elementType: 'geometry', stylers: [{color: '#E6E7EC'}]},
  {elementType: 'labels', stylers: [{visibility: 'off'}]},
  {featureType: 'poi', elementType: 'geometry', stylers: [{color: '#E6E7EC'}]},
  {featureType: 'poi.park', elementType: 'geometry', stylers: [{color: '#D6ECDD'}]},
  {featureType: 'road', elementType: 'geometry', stylers: [{color: '#FBFBFD'}]},
  {featureType: 'transit', stylers: [{visibility: 'off'}]},
  {featureType: 'water', elementType: 'geometry', stylers: [{color: '#CFE0EF'}]},
];

// Pins in the app's marker style, ringed by space colour. Positions are % of the hero.
const PINS = [
  {left: '24%', top: '26%', color: '#E65719'},
  {left: '63%', top: '43%', color: '#6A69DB'},
  {left: '77%', top: '19%', color: '#2E9E52'},
  {left: '60%', top: '72%', color: '#DB5392'},
] as const;

// No gradient library: stacked bands fade the map into the page.
const FADE_STEPS = 16;
/** The fade takes the lower part of the hero, capped so a short hero keeps its map. */
const fadeHeightFor = (heroHeight: number) => Math.min(200, Math.round(heroHeight * 0.42));

interface Props {
  height: number;
  /** Sign in: the "Saved from a TikTok" card that shows what the app does. */
  showCaptureCard?: boolean;
  onBack?: () => void;
}

export function AuthMapHero({height, showCaptureCard, onBack}: Props) {
  const insets = useSafeAreaInsets();
  const fadeHeight = fadeHeightFor(height);

  return (
    <View style={[s.hero, {height}]} pointerEvents="box-none">
      <MapView
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={CAIRO}
        customMapStyle={PALE_MAP}
        pointerEvents="none"
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        // Google's logo must stay visible: lift it above the fade and the form.
        mapPadding={{top: 0, right: 0, bottom: fadeHeight - 20, left: 0}}
      />

      {PINS.map(p => (
        <View key={p.color} style={[s.pin, {left: p.left, top: p.top}]} pointerEvents="none">
          <View style={[s.pinHead, {borderColor: p.color}]} />
          <View style={[s.pinStem, {backgroundColor: p.color}]} />
        </View>
      ))}

      {showCaptureCard && (
        <View style={s.card} pointerEvents="none">
          <View style={s.cardIcon}>
            <View style={s.playFrame}>
              <View style={s.playTriangle} />
            </View>
          </View>
          <View>
            <Text style={s.cardTitle}>Saved from a TikTok</Text>
            <Text style={s.cardSub}>Matched on the map</Text>
          </View>
        </View>
      )}

      <View style={[s.fade, {height: fadeHeight}]} pointerEvents="none">
        {Array.from({length: FADE_STEPS}, (_, i) => (
          <View
            key={i}
            style={[s.fadeBand, {opacity: ((i + 1) / FADE_STEPS) ** 2.2}]}
          />
        ))}
      </View>

      <View style={[s.topRow, {top: insets.top + 12}]}>
        {onBack ? (
          <TouchableOpacity style={s.backBtn} accessibilityLabel="Back" onPress={onBack}>
            <Text style={s.backIcon}>‹</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.brand}>
            <AppLogo size="sm" />
          </View>
        )}
      </View>
    </View>
  );
}

const floating = {
  shadowColor: '#14141E',
  shadowOffset: {width: 0, height: 4},
  shadowOpacity: 0.1,
  shadowRadius: 14,
  elevation: 4,
};

const s = StyleSheet.create({
  hero: {overflow: 'hidden', backgroundColor: '#E6E7EC'},

  pin: {position: 'absolute', alignItems: 'center'},
  pinHead: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    backgroundColor: colors.white,
    shadowColor: '#14141E',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.18,
    shadowRadius: 10,
  },
  pinStem: {width: 2, height: 7},

  card: {
    ...floating,
    position: 'absolute',
    left: '30%',
    top: '53%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 9,
    paddingLeft: 9,
    paddingRight: 12,
    shadowOffset: {width: 0, height: 10},
    shadowOpacity: 0.14,
    shadowRadius: 26,
  },
  cardIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A phone-shaped frame with a play mark, drawn from views.
  playFrame: {
    width: 13,
    height: 17,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playTriangle: {
    width: 0,
    height: 0,
    marginLeft: 1,
    borderTopWidth: 3,
    borderBottomWidth: 3,
    borderLeftWidth: 4,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.white,
  },
  cardTitle: {fontFamily: fonts.bold, fontSize: 12.5, color: colors.text},
  cardSub: {fontFamily: fonts.regular, fontSize: 11, color: colors.textSecondary, marginTop: 1},

  fade: {position: 'absolute', left: 0, right: 0, bottom: 0},
  fadeBand: {flex: 1, backgroundColor: colors.background},

  topRow: {position: 'absolute', left: 24},
  brand: {
    ...floating,
    backgroundColor: 'rgba(253,253,255,0.92)',
    borderRadius: 999,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 14,
  },
  backBtn: {
    ...floating,
    width: 44,
    height: 44,
    borderRadius: 22,
    marginLeft: -8,
    backgroundColor: 'rgba(253,253,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {fontSize: 28, color: colors.text, lineHeight: 30, marginLeft: -2},
});
