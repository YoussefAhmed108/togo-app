import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {WaypointLoader} from '../../components/WaypointLoader';
import {
  Animated,
  Image,
  Linking,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import MapView, {Marker, PROVIDER_GOOGLE, Region} from 'react-native-maps';
import {homeService, ApiSpace} from '../../services/homeService';
import {spaceDetailService} from '../../services/spaceDetailService';
import {useLocation} from '../../hooks/useLocation';
import {useAuth} from '../../hooks/useAuth';
import {AppStackParamList} from '../../types/navigation';
import {displayAddress} from '../../utils/address';
import {getEmoji} from '../HomeScreen';
import {colors, fonts, radius} from '../../theme';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// Pin colour per space; places saved only to your list wear the brand teal.
const SPACE_COLORS = ['#E65719', '#7C63D6', '#2E9E52', '#DB5392', '#6A69DB', '#B7791F'];
const SAVED_COLOR = '#009FAA';
const NEARBY_COUNT = 5;

/** Names appear beside pins once zoomed in past this (≈ a neighbourhood). */
const LABEL_DELTA = 0.08;
/** Height of the sheet pulled all the way down: just its handle and summary. */
const PEEK = 78;

interface MapPlace {
  id: number;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  tags: string[];
  spaceId: number | null;
  km: number;
}

function haversineKm(a: {lat: number; lng: number}, b: {lat: number; lng: number}) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function fmtKm(km: number) {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export default function MapScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const {origin, hasFix, refresh} = useLocation();
  const {user} = useAuth();
  const mapRef = useRef<MapView>(null);
  // Custom marker views snapshot once; keep tracking until the photo has drawn.
  const [avatarReady, setAvatarReady] = useState(!user?.avatar_url);

  const [spaces, setSpaces] = useState<ApiSpace[]>([]);
  const [raw, setRaw] = useState<Omit<MapPlace, 'km'>[]>([]);
  const [filters, setFilters] = useState<Set<number>>(new Set());
  const [seg, setSeg] = useState<'nearby' | 'all'>('nearby');
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [zoomedIn, setZoomedIn] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // ── The sheet: dragged between half-open and a peek bar ─────────────────
  const [screenH, setScreenH] = useState(0);
  const sheetH = Math.max(PEEK, Math.round(screenH * 0.48));
  const closedY = sheetH - PEEK; // translateY when pulled down
  const sheetY = useRef(new Animated.Value(0)).current;
  const sheetOpen = useRef(true);
  const [open, setOpen] = useState(true);

  const snap = useCallback(
    (toOpen: boolean) => {
      sheetOpen.current = toOpen;
      setOpen(toOpen);
      Animated.spring(sheetY, {
        toValue: toOpen ? 0 : closedY,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }).start();
    },
    [sheetY, closedY],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderMove: (_, g) => {
          const base = sheetOpen.current ? 0 : closedY;
          sheetY.setValue(Math.min(closedY, Math.max(0, base + g.dy)));
        },
        onPanResponderRelease: (_, g) => {
          const base = sheetOpen.current ? 0 : closedY;
          const y = base + g.dy;
          // A flick decides; otherwise whichever half it was let go in.
          const toOpen = g.vy < -0.4 ? true : g.vy > 0.4 ? false : y < closedY / 2;
          snap(toOpen);
        },
      }),
    [closedY, sheetY, snap],
  );

  // ── Data ─────────────────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const [own, sps] = await Promise.all([homeService.fetchPlaces(), homeService.fetchSpaces()]);
          // ponytail: one request per space; a /places?include=spaces endpoint if spaces grow large.
          const perSpace = await Promise.all(
            sps.map(sp => spaceDetailService.getPlaces(sp.id).catch(() => [])),
          );
          const byId = new Map<number, Omit<MapPlace, 'km'>>();
          perSpace.forEach((list, i) =>
            list.forEach(p => {
              if (!byId.has(p.id)) byId.set(p.id, {...p, spaceId: sps[i].id});
            }),
          );
          own.forEach(p => {
            if (!byId.has(p.id)) byId.set(p.id, {...p, spaceId: null});
          });
          setSpaces(sps);
          setRaw([...byId.values()]);
        } catch {
          setRaw([]);
        } finally {
          setLoaded(true);
        }
      })();
    }, []),
  );

  const spaceColor = useCallback(
    (spaceId: number | null) => {
      if (spaceId == null) return SAVED_COLOR;
      const i = spaces.findIndex(s => s.id === spaceId);
      return SPACE_COLORS[i % SPACE_COLORS.length];
    },
    [spaces],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return raw
      .filter(p => filters.size === 0 || (p.spaceId != null && filters.has(p.spaceId)))
      .filter(p => !q || p.name.toLowerCase().includes(q))
      .map(p => ({...p, km: haversineKm(origin, p)}))
      .sort((a, b) => a.km - b.km);
  }, [raw, filters, query, origin]);

  const list = useMemo(
    () => (seg === 'nearby' ? visible.slice(0, NEARBY_COUNT) : visible),
    [seg, visible],
  );
  const selected = visible.find(p => p.id === selectedId) ?? null;

  // Frame the cluster around the nearest listed place, not every pin: saved
  // places can span continents and a world view shows nothing useful.
  // ponytail: fixed 50 km cluster radius; real clustering if cities get dense.
  useEffect(() => {
    if (!list.length) return;
    const cluster = list.filter(p => haversineKm(list[0], p) <= 50);
    mapRef.current?.fitToCoordinates(
      cluster.map(p => ({latitude: p.lat, longitude: p.lng})),
      {edgePadding: {top: insets.top + 130, right: 50, bottom: 60, left: 50}, animated: true},
    );
  }, [list, insets.top]);

  const toggleFilter = (id: number) =>
    setFilters(f => {
      const next = new Set(f);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const spaceName = (id: number | null) =>
    id == null ? 'Saved places' : spaces.find(s => s.id === id)?.name ?? '';

  const openPlace = (p: MapPlace) =>
    navigation.navigate('PlaceDetail', {placeId: p.id, placeName: p.name});

  const selectPin = (p: MapPlace) => {
    setSelectedId(p.id);
    snap(false); // the card needs the map, not the list
    mapRef.current?.animateCamera({center: {latitude: p.lat, longitude: p.lng}}, {duration: 350});
  };

  const locateMe = () => {
    if (!hasFix) {
      refresh();
      return;
    }
    mapRef.current?.animateToRegion(
      {latitude: origin.lat, longitude: origin.lng, latitudeDelta: 0.03, longitudeDelta: 0.03},
      400,
    );
  };

  return (
    <View style={s.root} onLayout={e => setScreenH(e.nativeEvent.layout.height)}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        // Keeps Google's logo and the map's centre clear of the peek bar.
        mapPadding={{top: 0, right: 0, bottom: PEEK, left: 0}}
        initialRegion={{
          latitude: origin.lat,
          longitude: origin.lng,
          latitudeDelta: 0.12,
          longitudeDelta: 0.12,
        }}
        onRegionChangeComplete={(r: Region) => setZoomedIn(r.latitudeDelta < LABEL_DELTA)}
        onPress={e => {
          // A marker tap also reaches the map; only a bare-map tap closes the card.
          if (e.nativeEvent.action !== 'marker-press') setSelectedId(null);
        }}>
        {hasFix && (
          <Marker
            coordinate={{latitude: origin.lat, longitude: origin.lng}}
            anchor={{x: 0.5, y: 0.5}}
            zIndex={999}
            tracksViewChanges={!avatarReady}
            title="You">
            <View style={s.meHalo}>
              <View style={s.meRing}>
                {user?.avatar_url ? (
                  <Image
                    source={{uri: user.avatar_url}}
                    style={s.meImg}
                    onLoad={() => setAvatarReady(true)}
                    onError={() => setAvatarReady(true)}
                  />
                ) : (
                  <View style={[s.meImg, s.meFallback]}>
                    <Text style={s.meInitial}>{(user?.name?.[0] ?? '?').toUpperCase()}</Text>
                  </View>
                )}
              </View>
            </View>
          </Marker>
        )}
        {visible.map(p => {
          const isSel = p.id === selectedId;
          return (
            <PlacePin
              // Remount on change so the marker's snapshot is retaken.
              key={`${p.id}-${zoomedIn}-${isSel}`}
              place={p}
              color={spaceColor(p.spaceId)}
              label={zoomedIn || isSel}
              selected={isSel}
              onPress={() => selectPin(p)}
            />
          );
        })}
      </MapView>

      <View style={[s.overlay, {top: insets.top + 8}]}>
        <View style={s.search}>
          <Text style={s.searchIcon}>⌕</Text>
          <TextInput
            style={s.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search your places"
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          <Chip label="All pins" dot={SAVED_COLOR} on={filters.size === 0} onPress={() => setFilters(new Set())} />
          {spaces.map(sp => (
            <Chip
              key={sp.id}
              label={sp.name}
              dot={spaceColor(sp.id)}
              on={filters.has(sp.id)}
              onPress={() => toggleFilter(sp.id)}
            />
          ))}
        </ScrollView>
      </View>

      {screenH > 0 && (
        <Animated.View style={[s.sheet, {height: sheetH, transform: [{translateY: sheetY}]}]}>
          {/* Floats above the sheet and rides with it. */}
          {selected ? (
            <View style={s.card}>
              <View style={s.cardTop}>
                <View style={[s.cardIcon, {backgroundColor: spaceColor(selected.spaceId) + '22'}]}>
                  <Text style={s.cardEmoji}>{getEmoji(selected.tags)}</Text>
                </View>
                <View style={s.flex}>
                  <Text style={s.cardName} numberOfLines={1}>
                    {selected.name}
                  </Text>
                  <View style={s.metaRow}>
                    <View style={[s.dot, {backgroundColor: spaceColor(selected.spaceId)}]} />
                    <Text style={s.mut} numberOfLines={1}>
                      {spaceName(selected.spaceId)} · {fmtKm(selected.km)}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity style={s.cardClose} accessibilityLabel="Close" onPress={() => setSelectedId(null)}>
                  <Text style={s.cardCloseX}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={s.cardBtns}>
                <TouchableOpacity
                  style={[s.cardBtn, s.cardBtnP]}
                  activeOpacity={0.85}
                  onPress={() =>
                    Linking.openURL(
                      `https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`,
                    )
                  }>
                  <Text style={s.cardBtnPText}>Directions</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.cardBtn} activeOpacity={0.85} onPress={() => openPlace(selected)}>
                  <Text style={s.cardBtnText}>Open place</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={s.floatRow}>
              <TouchableOpacity style={s.roundBtn} accessibilityLabel="Show my location" onPress={locateMe}>
                <View style={[s.locateDot, !hasFix && s.locateDotOff]} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.roundBtn, s.addBtn]}
                accessibilityLabel="Add a place"
                onPress={() => navigation.navigate('CreatePlace')}>
                <Text style={s.addPlus}>＋</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* The handle: drag it, or tap to open and close. */}
          <View {...pan.panHandlers}>
            <TouchableOpacity activeOpacity={0.9} onPress={() => snap(!open)} style={s.handle}>
              <View style={s.grab} />
              <View style={s.peekRow}>
                <View style={s.flex}>
                  <Text style={s.peekTitle}>
                    {visible.length} {visible.length === 1 ? 'place' : 'places'} on the map
                  </Text>
                  <Text style={s.mut}>{open ? 'Pull down for the full map' : 'Pull up for the list'}</Text>
                </View>
                <Text style={[s.chevron, open && s.chevronDown]}>⌃</Text>
              </View>
            </TouchableOpacity>
          </View>

          <View style={s.segw}>
            {(['nearby', 'all'] as const).map(k => (
              <TouchableOpacity
                key={k}
                style={[s.seg, seg === k && s.segOn]}
                activeOpacity={0.8}
                onPress={() => setSeg(k)}>
                <Text style={[s.segText, seg === k && s.segTextOn]}>
                  {k === 'nearby' ? 'Nearby' : `All saved (${visible.length})`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
            {!loaded ? (
              <WaypointLoader size={64} style={s.loader} />
            ) : list.length === 0 ? (
              <Text style={s.empty}>{raw.length === 0 ? 'No saved places yet.' : 'No places match this filter.'}</Text>
            ) : (
              list.map(p => (
                <TouchableOpacity key={p.id} style={s.row} activeOpacity={0.7} onPress={() => selectPin(p)}>
                  <View style={[s.rowIcon, {backgroundColor: spaceColor(p.spaceId) + '22'}]}>
                    <Text style={s.rowEmoji}>{getEmoji(p.tags)}</Text>
                  </View>
                  <View style={s.flex}>
                    <Text style={s.rowName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <View style={s.metaRow}>
                      <View style={[s.dot, {backgroundColor: spaceColor(p.spaceId)}]} />
                      <Text style={[s.mut, s.flex]} numberOfLines={1}>
                        {[spaceName(p.spaceId), displayAddress(p.address)].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.dist}>{fmtKm(p.km)}</Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

/**
 * A place on the map: its emoji on a disc in its space's colour. Zoomed in
 * (or selected) the name hangs under it with a white halo, like a map label.
 * Fixed width so the anchor can sit exactly on the stem's tip.
 */
function PlacePin({
  place,
  color,
  label,
  selected,
  onPress,
}: {
  place: MapPlace;
  color: string;
  label: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  // Track long enough for the view to draw once, then freeze it (cheap to pan).
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracking(false), 600);
    return () => clearTimeout(t);
  }, []);

  const disc = selected ? 42 : 30;
  const pinH = disc + 7; // disc + stem: the stem's tip is the place
  const totalH = pinH + (label ? 34 : 0);
  return (
    <Marker
      coordinate={{latitude: place.lat, longitude: place.lng}}
      anchor={{x: 0.5, y: pinH / totalH}}
      zIndex={selected ? 998 : 1}
      tracksViewChanges={tracking}
      onPress={onPress}>
      <View style={[s.pin, {height: totalH}]}>
        <View
          style={[
            s.pinDisc,
            {width: disc, height: disc, borderRadius: disc / 2, backgroundColor: color},
            selected && s.pinDiscSel,
          ]}>
          <Text style={{fontSize: selected ? 19 : 14}}>{getEmoji(place.tags)}</Text>
        </View>
        <View style={[s.pinStem, {backgroundColor: color}]} />
        {label && (
          <Text style={[s.pinLabel, selected && s.pinLabelSel]} numberOfLines={2}>
            {place.name}
          </Text>
        )}
      </View>
    </Marker>
  );
}

function Chip({label, dot, on, onPress}: {label: string; dot: string; on: boolean; onPress: () => void}) {
  return (
    <TouchableOpacity style={[s.chip, on && s.chipOn]} activeOpacity={0.8} onPress={onPress}>
      <View style={[s.chipDot, {backgroundColor: on ? colors.white : dot}]} />
      <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const floatShadow = {
  shadowColor: '#000',
  shadowOffset: {width: 0, height: 3},
  shadowOpacity: 0.1,
  shadowRadius: 10,
  elevation: 4,
};

const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1, minWidth: 0},

  overlay: {position: 'absolute', left: 0, right: 0, gap: 10},
  search: {
    ...floatShadow,
    marginHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 46,
  },
  searchIcon: {fontSize: 18, color: colors.text},
  searchInput: {flex: 1, fontFamily: fonts.semibold, fontSize: 13.5, color: colors.text, paddingVertical: 12},
  chips: {paddingHorizontal: 20, gap: 7, paddingBottom: 6},
  chip: {
    ...floatShadow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 200,
    minHeight: 36,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  chipDot: {width: 8, height: 8, borderRadius: 4},
  chipText: {fontFamily: fonts.semibold, fontSize: 12, color: colors.text},
  chipTextOn: {color: colors.white},

  // "You": profile photo in a white ring on a soft blue halo, like Google Maps.
  meHalo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(66,133,244,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meRing: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
    borderColor: colors.white,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  meImg: {width: '100%', height: '100%'},
  meFallback: {backgroundColor: '#4285F4', alignItems: 'center', justifyContent: 'center'},
  meInitial: {fontFamily: fonts.bold, fontSize: 15, color: colors.white},

  pin: {width: 130, alignItems: 'center'},
  pinDisc: {
    borderWidth: 3,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#14141E',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  pinDiscSel: {borderWidth: 4},
  pinStem: {width: 2, height: 7},
  // White halo keeps the name readable on any tile, like Google's own labels.
  pinLabel: {
    marginTop: 2,
    fontFamily: fonts.bold,
    fontSize: 12,
    lineHeight: 15,
    color: '#1C1C25',
    textAlign: 'center',
    textShadowColor: 'rgba(255,255,255,0.95)',
    textShadowOffset: {width: 0, height: 0},
    textShadowRadius: 4,
  },
  pinLabelSel: {fontSize: 13},

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -6},
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  handle: {paddingTop: 10, paddingHorizontal: 20, paddingBottom: 12},
  grab: {width: 36, height: 4, borderRadius: 2, backgroundColor: colors.ringIdle, alignSelf: 'center'},
  peekRow: {flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10},
  peekTitle: {fontFamily: fonts.bold, fontSize: 15, color: colors.text},
  chevron: {fontSize: 20, color: colors.textSecondary},
  chevronDown: {transform: [{rotate: '180deg'}]},

  floatRow: {position: 'absolute', right: 16, top: -60, flexDirection: 'row', gap: 10},
  roundBtn: {
    ...floatShadow,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {backgroundColor: colors.primary},
  addPlus: {fontSize: 22, color: colors.white},
  locateDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#4285F4',
    backgroundColor: 'rgba(66,133,244,0.25)',
  },
  locateDotOff: {borderColor: colors.textSecondary, backgroundColor: 'transparent'},

  card: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: '100%',
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 14,
    gap: 12,
    shadowColor: '#14141E',
    shadowOffset: {width: 0, height: 16},
    shadowOpacity: 0.18,
    shadowRadius: 30,
    elevation: 10,
  },
  cardTop: {flexDirection: 'row', alignItems: 'center', gap: 12},
  cardIcon: {width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  cardEmoji: {fontSize: 22},
  cardName: {fontFamily: fonts.bold, fontSize: 16, color: colors.text},
  cardClose: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  cardCloseX: {fontSize: 14, color: colors.textSecondary},
  cardBtns: {flexDirection: 'row', gap: 8},
  cardBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBtnP: {backgroundColor: colors.primary},
  cardBtnText: {fontFamily: fonts.bold, fontSize: 13.5, color: colors.text},
  cardBtnPText: {fontFamily: fonts.bold, fontSize: 13.5, color: colors.white},

  segw: {
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceDim,
  },
  seg: {flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center'},
  segOn: {backgroundColor: colors.surface, ...floatShadow, shadowOpacity: 0.08, elevation: 1},
  segText: {fontFamily: fonts.bold, fontSize: 13, color: colors.textSecondary},
  segTextOn: {color: colors.text},

  list: {paddingHorizontal: 20, paddingBottom: 24, gap: 10},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rowIcon: {width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center'},
  rowEmoji: {fontSize: 18},
  rowName: {fontFamily: fonts.semibold, fontSize: 13.5, color: colors.text},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3},
  dot: {width: 7, height: 7, borderRadius: 4},
  mut: {fontFamily: fonts.regular, fontSize: 11.5, color: colors.textSecondary},
  dist: {fontFamily: fonts.bold, fontSize: 11.5, color: colors.textSecondary},
  loader: {paddingVertical: 20},
  empty: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 20,
  },
});
