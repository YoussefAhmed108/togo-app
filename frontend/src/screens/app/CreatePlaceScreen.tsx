import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import MapView, {Marker, PROVIDER_GOOGLE, Region} from 'react-native-maps';
import {GooglePlacesAutocomplete} from 'react-native-google-places-autocomplete';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {AppStackParamList} from '../../types/navigation';
import {placeService, ApiPlace} from '../../services/placeService';
import {spaceDetailService} from '../../services/spaceDetailService';
import {homeService, ApiSpace} from '../../services/homeService';
import {extractService, ExtractResult, PlaceCandidate} from '../../services/extractService';
import {GOOGLE_MAPS_API_KEY} from '../../config/maps';
import {colors, fonts, radius, spacing} from '../../theme';
import {Pin} from '../../components/Pin';
import {displayAddress} from '../../utils/address';

type Props = NativeStackScreenProps<AppStackParamList, 'CreatePlace'>;

const {height: SCREEN_H} = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_H * 0.35);

const DEFAULT_REGION: Region = {
  latitude: 40.7128,
  longitude: -74.006,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

// ── Tag helpers ───────────────────────────────────────────────────────────────

const GLOBAL_TAGS = [
  'restaurant', 'cafe', 'bar', 'pizza', 'sushi', 'brunch',
  'park', 'nature', 'beach', 'museum', 'art', 'shopping',
  'hotel', 'coffee', 'bakery', 'cocktails', 'rooftop', 'gym',
];

const TAG_EMOJI: Record<string, string> = {
  restaurant: '🍽️', japanese: '🍱', sushi: '🍣', pizza: '🍕', italian: '🍝',
  cafe: '☕', coffee: '☕', bakery: '🥐', deli: '🥪', burger: '🍔', brunch: '🥞',
  bar: '🍸', cocktail: '🍹', cocktails: '🍹', wine: '🍷', beer: '🍺', rooftop: '🌆',
  park: '🌳', nature: '🏞️', beach: '🏖️', hiking: '🥾', gym: '💪',
  museum: '🏛️', art: '🎨', music: '🎵', shopping: '🛍️', hotel: '🏨', spa: '💆',
};

function tagEmoji(tag: string): string {
  const lower = tag.toLowerCase();
  for (const [k, e] of Object.entries(TAG_EMOJI)) {
    if (lower.includes(k)) return e;
  }
  return '🏷️';
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function CreatePlaceScreen({route, navigation}: Props) {
  const spaceId: number | undefined = route.params?.spaceId;
  const spaceTags: string[] = route.params?.spaceTags ?? [];
  const tiktokUrl: string | undefined = route.params?.tiktokUrl;

  const mapRef = useRef<MapView>(null);

  // Location
  const [pickedLocation, setPickedLocation] = useState<{lat: number; lng: number; address: string} | null>(null);
  const [isMapMoving, setIsMapMoving] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  // A search pick already carries a real address — don't let the map settling
  // afterwards overwrite it with a (possibly failed) reverse geocode.
  const skipNextGeocode = useRef(false);

  // Form
  const [name, setName] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<ApiPlace | null>(null);

  const canSave = name.trim().length > 0 && pickedLocation !== null && !saving;

  // TikTok share extraction
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);

  // Destination picker — a place can go to saved places and/or several spaces
  const [showDestinations, setShowDestinations] = useState(false);
  const [userSpaces, setUserSpaces] = useState<ApiSpace[]>([]);
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<Set<number>>(
    () => (spaceId !== undefined ? new Set([spaceId]) : new Set()),
  );
  // Opened from a space? That space is the destination, not saved places.
  const [savedPlacesSelected, setSavedPlacesSelected] = useState(spaceId === undefined);
  // Venue identity, when the location came from Google rather than a dragged
  // pin. Lets the backend reuse a place the user already saved.
  const [googlePlaceId, setGooglePlaceId] = useState<string | null>(null);

  const applyCandidate = useCallback((c: PlaceCandidate) => {
    setName(c.name);
    setGooglePlaceId(c.google_place_id);
    setPickedLocation({lat: c.lat, lng: c.lng, address: c.address});
    skipNextGeocode.current = true;
    mapRef.current?.animateToRegion(
      {latitude: c.lat, longitude: c.lng, latitudeDelta: 0.008, longitudeDelta: 0.008},
      600,
    );
    setShowCandidates(false);
  }, []);

  // ── Pre-fill from a recommendation tap ────────────────────────────────────
  useEffect(() => {
    const {prefillName, prefillAddress, prefillLat, prefillLng} = route.params ?? {};
    if (prefillName) setName(prefillName);
    if (prefillLat != null && prefillLng != null) {
      setPickedLocation({lat: prefillLat, lng: prefillLng, address: prefillAddress ?? ''});
      skipNextGeocode.current = true;
      mapRef.current?.animateToRegion(
        {latitude: prefillLat, longitude: prefillLng, latitudeDelta: 0.008, longitudeDelta: 0.008},
        600,
      );
    }
    // Mount only — later param changes are the TikTok flow's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Analyse a shared TikTok ───────────────────────────────────────────────
  useEffect(() => {
    if (!tiktokUrl) return;
    let cancelled = false;

    (async () => {
      setExtracting(true);
      try {
        const result = await extractService.extract(tiktokUrl);
        if (cancelled) return;
        setExtractResult(result);

        if (result.selected) {
          applyCandidate(result.selected);
          // A chain has many branches and the top hit is often the wrong one,
          // so offer the alternatives rather than silently committing.
          if (result.candidates.length > 1) setShowCandidates(true);
        } else {
          // Still seed whatever name was read off the video; the pin stays empty.
          if (result.name) setName(result.name);
          Alert.alert(
            'Place not identified',
            result.note === 'no place confidently identified'
              ? "We couldn't find a place in that video. Search for it below."
              : "We read the name but couldn't match it on the map. Search for it below.",
          );
        }
      } catch (err: any) {
        if (cancelled) return;
        const msg = err?.response?.data?.error ?? 'Could not analyse that TikTok.';
        Alert.alert('Extraction failed', `${msg} You can search for the place manually.`);
      } finally {
        if (!cancelled) setExtracting(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tiktokUrl, applyCandidate]);

  // ── Google Places selection ───────────────────────────────────────────────

  const handlePlaceSelected = useCallback((data: any, details: any) => {
    const loc = details?.geometry?.location;
    if (!loc) return;

    const newRegion: Region = {
      latitude: loc.lat,
      longitude: loc.lng,
      latitudeDelta: 0.008,
      longitudeDelta: 0.008,
    };
    skipNextGeocode.current = true;
    mapRef.current?.animateToRegion(newRegion, 600);

    const placeName =
      details?.name ||
      data.structured_formatting?.main_text ||
      data.description.split(',')[0];

    setName(placeName);
    setGooglePlaceId(data.place_id ?? details?.place_id ?? null);
    setPickedLocation({lat: loc.lat, lng: loc.lng, address: data.description});
  }, []);

  // ── Manual map drag → reverse geocode ────────────────────────────────────

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    setIsGeocoding(true);
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`,
      );
      const data = await res.json();
      const address =
        data.results?.[0]?.formatted_address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      setPickedLocation({lat, lng, address});
    } catch {
      setPickedLocation({lat, lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`});
    } finally {
      setIsGeocoding(false);
    }
  }, []);

  const handleRegionChangeComplete = useCallback(
    (r: Region) => {
      setIsMapMoving(false);
      if (skipNextGeocode.current) {
        skipNextGeocode.current = false;
        return;
      }
      // The pin no longer sits on the venue Google matched, so the identity
      // does not apply any more — saving it would dedupe onto the wrong place.
      setGooglePlaceId(null);
      reverseGeocode(r.latitude, r.longitude);
    },
    [reverseGeocode],
  );

  // ── Tags ─────────────────────────────────────────────────────────────────

  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (!t || tags.includes(t) || tags.length >= 10) return;
    setTags(prev => [...prev, t]);
  };
  const removeTag = (tag: string) => setTags(prev => prev.filter(t => t !== tag));
  const handleTagSubmit = () => {
    if (tagInput.trim()) { addTag(tagInput.trim()); setTagInput(''); }
  };

  const spaceSuggestions = spaceTags.filter(t => !tags.includes(t));
  const globalSuggestions = GLOBAL_TAGS.filter(
    t => !tags.includes(t) && !spaceTags.includes(t),
  ).slice(0, 12);

  // ── Save ─────────────────────────────────────────────────────────────────

  // Step 1 — the Save button opens the destination picker rather than saving.
  const handleSavePress = async () => {
    if (!canSave) return;
    try {
      setUserSpaces(await homeService.fetchSpaces());
    } catch {
      // Saved Places still works without the space list.
    }
    setShowDestinations(true);
  };

  const toggleSpace = (id: number) => {
    setSelectedSpaceIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const destinationCount = (savedPlacesSelected ? 1 : 0) + selectedSpaceIds.size;

  // Step 2 — create the place once, then fan out to every chosen destination.
  const handleSaveWithDestinations = async () => {
    if (!canSave || !pickedLocation || destinationCount === 0) return;
    setShowDestinations(false);
    setSaving(true);
    try {
      const place = await placeService.create(
        name.trim(),
        pickedLocation.lat,
        pickedLocation.lng,
        pickedLocation.address,
        savedPlacesSelected,
        googlePlaceId,
      );

      if (tags.length > 0) {
        try { await placeService.addTags(place.id, tags); place.tags = tags; } catch {}
      }

      // One failing space must not lose the others or the place itself.
      const failed: string[] = [];
      for (const sid of selectedSpaceIds) {
        try {
          await spaceDetailService.addPlace(sid, place.id);
        } catch {
          failed.push(userSpaces.find(sp => sp.id === sid)?.name ?? `Space ${sid}`);
        }
      }
      if (failed.length > 0) {
        Alert.alert('Partly saved', `Place saved, but could not add it to: ${failed.join(', ')}`);
      }

      // Came from a space screen — return to it. Otherwise show the success card.
      if (spaceId !== undefined) {
        navigation.goBack();
        return;
      }
      setSaved(place);
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? 'Failed to save place';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Success ───────────────────────────────────────────────────────────────

  if (saved) {
    const emoji = (() => {
      for (const tag of saved.tags ?? []) {
        const e = tagEmoji(tag);
        if (e !== '🏷️') return e;
      }
      return '📍';
    })();
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.successWrap}>
          <View style={s.successCheck}>
            <Text style={s.successCheckIcon}>✓</Text>
          </View>
          <Text style={s.successHeading}>Place saved!</Text>
          <Text style={s.successSub}>
            It's now in your saved places and can be added to any space.
          </Text>
          <View style={s.successCard}>
            <View style={s.successCardIcon}>
              <Text style={{fontSize: 28}}>{emoji}</Text>
            </View>
            <View style={{flex: 1}}>
              <Text style={s.successCardName} numberOfLines={1}>{saved.name}</Text>
              {!!displayAddress(saved.address) && (
                <Text style={s.successCardAddr} numberOfLines={2}>
                  {displayAddress(saved.address)}
                </Text>
              )}
              {(saved.tags ?? []).length > 0 && (
                <View style={s.successTagRow}>
                  {saved.tags.slice(0, 4).map(t => (
                    <View key={t} style={s.successTag}>
                      <Text style={s.successTagText}>{t}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
          <TouchableOpacity style={s.successBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <Text style={s.successBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Create form ───────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe} edges={['top']}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={s.headerBack}>
          <Text style={s.headerBackIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Add Place</Text>
        <View style={s.headerBack} />
      </View>

      {/*
        KEY FIX: GooglePlacesAutocomplete is OUTSIDE the fixed-height mapWrap.
        This lets the dropdown list extend freely without being clipped.
        The search bar sits between the header and the map.
      */}
      <View style={s.searchSection}>
        <GooglePlacesAutocomplete
          placeholder="Search for a place or address…"
          minLength={2}
          debounce={250}
          fetchDetails
          onPress={handlePlaceSelected}
          onFail={error => {
            const message =
              typeof error === 'string' && error.trim().length > 0
                ? error
                : 'Google Places search could not load suggestions.';
            Alert.alert('Place Search Error', message);
          }}
          keepResultsAfterBlur
          listViewDisplayed="auto"
          query={{key: GOOGLE_MAPS_API_KEY, language: 'en'}}
          enablePoweredByContainer={false}
          keyboardShouldPersistTaps="always"
          styles={autoStyles}
          textInputProps={{
            placeholderTextColor: colors.placeholder,
            autoCorrect: false,
          }}
        />
      </View>

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Map — just the map + pin, no search bar inside */}
        <View style={s.mapWrap}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={s.map}
            initialRegion={DEFAULT_REGION}
            showsUserLocation
            showsMyLocationButton={false}
            onRegionChange={() => setIsMapMoving(true)}
            onRegionChangeComplete={handleRegionChangeComplete}
          />

          {/* Center crosshair pin */}
          <View style={s.pinOverlay} pointerEvents="none">
            <View style={[s.pin, isMapMoving && s.pinLifted]}>
              <Pin size={28} color={colors.primary} filled />
            </View>
            <View style={[s.pinShadow, isMapMoving && s.pinShadowLifted]} />
          </View>

          {/* Confirmed marker */}
          {pickedLocation && !isMapMoving && (
            <Marker
              coordinate={{latitude: pickedLocation.lat, longitude: pickedLocation.lng}}
              pinColor={colors.primary}
            />
          )}

          {/* Geocoding badge */}
          {isGeocoding && (
            <View style={s.geocodingBadge} pointerEvents="none">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={s.geocodingText}>Locating…</Text>
            </View>
          )}
        </View>

        {/* Scrollable form */}
        <ScrollView
          style={s.form}
          contentContainerStyle={s.formContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          {/* Confirmed address pill */}
          {pickedLocation && (
            <View style={s.locationPill}>
              <Pin size={16} color={colors.primary} filled />
              <Text style={s.locationPillText} numberOfLines={1}>
                {pickedLocation.address}
              </Text>
            </View>
          )}

          {/* Place name */}
          <View style={s.card}>
            <Text style={s.cardLabel}>PLACE NAME</Text>
            <TextInput
              style={s.nameInput}
              placeholder="e.g. Frenchie Restaurant"
              placeholderTextColor={colors.placeholder}
              value={name}
              onChangeText={setName}
              maxLength={80}
              returnKeyType="done"
            />
            {name.length > 0 && <Text style={s.charCount}>{name.length}/80</Text>}
          </View>

          {/* Tags */}
          <View style={s.card}>
            <Text style={s.cardLabel}>
              TAGS{'  '}
              <Text style={s.cardLabelHint}>optional · up to 10</Text>
            </Text>

            {tags.length > 0 && (
              <View style={s.tagRow}>
                {tags.map(tag => (
                  <TouchableOpacity key={tag} style={s.tagChip} onPress={() => removeTag(tag)} activeOpacity={0.75}>
                    <Text style={s.tagChipText}>{tag}</Text>
                    <Text style={s.tagChipX}>×</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={s.tagInputRow}>
              <TextInput
                style={s.tagInput}
                placeholder="Type a custom tag…"
                placeholderTextColor={colors.placeholder}
                value={tagInput}
                onChangeText={setTagInput}
                onSubmitEditing={handleTagSubmit}
                returnKeyType="done"
                maxLength={30}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {tagInput.trim().length > 0 && (
                <TouchableOpacity style={s.tagAddBtn} onPress={handleTagSubmit} activeOpacity={0.8}>
                  <Text style={s.tagAddBtnText}>Add</Text>
                </TouchableOpacity>
              )}
            </View>

            {spaceSuggestions.length > 0 && (
              <>
                <Text style={s.suggestionLabel}>USED IN THIS SPACE</Text>
                <View style={s.suggestionRow}>
                  {spaceSuggestions.map(t => (
                    <TouchableOpacity key={t} style={[s.suggestion, s.suggestionSpace]} onPress={() => addTag(t)} activeOpacity={0.75}>
                      <Text style={[s.suggestionText, s.suggestionTextSpace]}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {globalSuggestions.length > 0 && (
              <>
                {spaceSuggestions.length > 0 && (
                  <Text style={[s.suggestionLabel, {marginTop: spacing.sm}]}>POPULAR</Text>
                )}
                <View style={s.suggestionRow}>
                  {globalSuggestions.map(t => (
                    <TouchableOpacity key={t} style={s.suggestion} onPress={() => addTag(t)} activeOpacity={0.75}>
                      <Text style={s.suggestionText}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </View>

          <View style={{height: 100}} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Save button */}
      <SafeAreaView edges={['bottom']} style={s.footer}>
        {!pickedLocation && (
          <Text style={s.footerHint}>Search above or drag the map to pick a location</Text>
        )}
        <TouchableOpacity
          style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
          onPress={handleSavePress}
          disabled={!canSave}
          activeOpacity={0.85}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.saveBtnText}>
                Next — Choose Destination
              </Text>
          }
        </TouchableOpacity>
      </SafeAreaView>

      {/* Analysing a shared TikTok — the backend downloads and reads the video,
          which takes ~15s, so this must be visible for the whole wait. */}
      {extracting && (
        <View style={s.overlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.overlayTitle}>Analysing TikTok…</Text>
          <Text style={s.overlaySub}>Reading the video to find the place</Text>
        </View>
      )}

      {/* Which branch? Chains match several locations and the top hit is
          often the wrong branch, so the user confirms. */}
      <Modal visible={showCandidates} animationType="slide" transparent onRequestClose={() => setShowCandidates(false)}>
        <View style={s.sheetBackdrop}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Which place is it?</Text>
            {!!extractResult?.evidence && (
              <Text style={s.sheetSub} numberOfLines={2}>{extractResult.evidence}</Text>
            )}
            <ScrollView style={s.sheetScroll}>
              {extractResult?.candidates.map(c => (
                <TouchableOpacity
                  key={c.google_place_id}
                  style={s.candidateCard}
                  onPress={() => applyCandidate(c)}
                  activeOpacity={0.75}>
                  <Text style={s.candidateName}>{c.name}</Text>
                  <Text style={s.candidateAddress} numberOfLines={2}>{c.address}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.sheetSecondary} onPress={() => setShowCandidates(false)}>
              <Text style={s.sheetSecondaryText}>None of these — search manually</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Where should this place go? Saved places and/or any number of spaces. */}
      <Modal visible={showDestinations} animationType="slide" transparent onRequestClose={() => setShowDestinations(false)}>
        <View style={s.sheetBackdrop}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Add this place to…</Text>

            <ScrollView style={s.sheetScroll}>
              <TouchableOpacity
                style={s.destRow}
                onPress={() => setSavedPlacesSelected(v => !v)}
                activeOpacity={0.7}>
                <Text style={s.destCheck}>{savedPlacesSelected ? '☑' : '☐'}</Text>
                <Text style={s.destEmoji}>📍</Text>
                <Text style={s.destLabel}>Saved Places</Text>
              </TouchableOpacity>

              {userSpaces.map(space => (
                <TouchableOpacity
                  key={space.id}
                  style={s.destRow}
                  onPress={() => toggleSpace(space.id)}
                  activeOpacity={0.7}>
                  <Text style={s.destCheck}>{selectedSpaceIds.has(space.id) ? '☑' : '☐'}</Text>
                  <Text style={s.destEmoji}>{space.icon}</Text>
                  <Text style={s.destLabel}>{space.name}</Text>
                </TouchableOpacity>
              ))}

              {userSpaces.length === 0 && (
                <Text style={s.destEmpty}>You have no spaces yet.</Text>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[s.saveBtn, destinationCount === 0 && s.saveBtnDisabled]}
              onPress={handleSaveWithDestinations}
              disabled={destinationCount === 0}
              activeOpacity={0.85}>
              <Text style={s.saveBtnText}>
                {destinationCount === 0
                  ? 'Pick at least one'
                  : `Save to ${destinationCount} ${destinationCount === 1 ? 'destination' : 'destinations'}`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.sheetSecondary} onPress={() => setShowDestinations(false)}>
              <Text style={s.sheetSecondaryText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},

  // TikTok extraction overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  overlayTitle: {fontFamily: fonts.display, fontSize: 18, color: colors.text, marginTop: spacing.md},
  overlaySub: {fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, textAlign: 'center'},

  // Bottom sheets (candidate + destination pickers)
  sheetBackdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end'},
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '80%',
  },
  sheetTitle: {fontFamily: fonts.display, fontSize: 20, color: colors.text, marginBottom: spacing.xs},
  sheetSub: {fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, marginBottom: spacing.md},
  sheetScroll: {marginBottom: spacing.md},
  sheetSecondary: {alignItems: 'center', paddingVertical: spacing.md},
  sheetSecondaryText: {fontFamily: fonts.body, fontSize: 14, color: colors.textMuted},

  candidateCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  candidateName: {fontFamily: fonts.display, fontSize: 16, color: colors.text},
  candidateAddress: {fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, marginTop: 2},

  destRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm},
  destCheck: {fontSize: 20, color: colors.primary},
  destEmoji: {fontSize: 20},
  destLabel: {fontFamily: fonts.body, fontSize: 16, color: colors.text},
  destEmpty: {fontFamily: fonts.body, fontSize: 14, color: colors.textMuted, paddingVertical: spacing.md},

  flex: {flex: 1},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBack: {width: 36, alignItems: 'center', justifyContent: 'center'},
  headerBackIcon: {fontSize: 30, color: colors.primary, lineHeight: 34},
  headerTitle: {fontFamily: fonts.display, fontSize: 19, color: colors.text},

  // Search sits between header and map — unrestricted height for dropdown
  searchSection: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    zIndex: 30,
  },

  mapWrap: {height: 300, backgroundColor: colors.sand},
  map: {...StyleSheet.absoluteFillObject},
  pinOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pin: {marginBottom: -16, transform: [{translateY: -16}]},
  pinLifted: {transform: [{translateY: -26}], opacity: 0.9},
  pinShadow: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(45,42,36,0.25)',
    marginTop: 16,
  },
  pinShadowLifted: {
    width: 10,
    height: 4,
    borderRadius: 5,
    backgroundColor: 'rgba(45,42,36,0.15)',
    marginTop: 26,
  },
  geocodingBadge: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  geocodingText: {fontFamily: fonts.regular, fontSize: 14, color: colors.text},

  form: {flex: 1, backgroundColor: colors.background},
  formContent: {paddingHorizontal: spacing.lg, paddingTop: spacing.md},

  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  locationPillText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  cardLabelHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: 0.6,
    color: colors.textMuted,
  },
  nameInput: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.text,
    paddingVertical: 2,
  },
  charCount: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: 6,
  },

  tagRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10},
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  tagChipEmoji: {fontSize: 14},
  tagChipText: {fontFamily: fonts.semibold, fontSize: 14.5, color: colors.white},
  tagChipX: {fontSize: 15, color: 'rgba(255,255,255,0.75)'},

  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.sand,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    height: 46,
    marginBottom: 12,
  },
  tagInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 0,
  },
  tagAddBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  tagAddBtnText: {fontFamily: fonts.semibold, fontSize: 13, color: colors.white},

  suggestionLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 1.1,
    color: colors.textMuted,
    marginBottom: 8,
  },
  suggestionRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  suggestion: {
    backgroundColor: colors.sand,
    borderRadius: radius.full,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  suggestionSpace: {backgroundColor: colors.sageTint},
  suggestionEmoji: {fontSize: 14},
  suggestionText: {fontFamily: fonts.regular, fontSize: 14.5, color: colors.textSecondary},
  suggestionTextSpace: {color: colors.sage},

  footer: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerHint: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 10,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {backgroundColor: colors.sandDeep},
  saveBtnText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},

  // ── Success ─────────────────────────────────────────────────────────────
  successWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    alignItems: 'center',
  },
  successCheck: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  successCheckIcon: {fontSize: 38, color: colors.sage},
  successHeading: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.text,
    marginBottom: 8,
  },
  successSub: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  successCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  successCardIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCardName: {fontFamily: fonts.semibold, fontSize: 17, color: colors.text},
  successCardAddr: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 3,
  },
  successTagRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10},
  successTag: {
    backgroundColor: colors.sand,
    borderRadius: radius.full,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  successTagText: {fontFamily: fonts.regular, fontSize: 13, color: colors.textSecondary},
  successBtn: {
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successBtnText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},
});

const autoStyles = {
  container: {flex: 0, zIndex: 30},
  textInputContainer: {
    borderRadius: radius.full,
    backgroundColor: colors.sand,
    height: 50,
    borderWidth: 1,
    borderColor: colors.sandDeep,
  },
  textInput: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.sand,
    borderRadius: radius.full,
    height: 48,
    paddingLeft: spacing.lg,
    marginBottom: 0,
  },
  listView: {
    position: 'absolute' as const,
    top: 54,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#4A3B28',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
    zIndex: 40,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  description: {fontFamily: fonts.regular, fontSize: 15, color: colors.text},
  separator: {height: 1, backgroundColor: colors.border},
  poweredContainer: {display: 'none' as const},
};
