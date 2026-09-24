import React, {useCallback, useState} from 'react';
import {ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import type {CompositeNavigationProp} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {AppLogo} from '../components/AppLogo';
import {LocationModal} from '../components/LocationModal';
import {SpaceCard, NewSpaceCard, SpaceItem} from '../components/home/SpaceCard';
import {PlaceItem} from '../components/home/PlaceCard';
import {RecommendationItem} from '../components/home/RecommendationCard';
import {useAuth} from '../hooks/useAuth';
import {useLocation} from '../hooks/useLocation';
import {homeService, ApiSpace, ApiPlace} from '../services/homeService';
import {placeService} from '../services/placeService';
import {recommendationService} from '../services/recommendationService';
import {AppStackParamList, TabParamList} from '../types/navigation';
import {colors, fonts, radius, themedStyles} from '../theme';

// Home sits in the tab bar but pushes onto the stack around it.
type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList>,
  NativeStackNavigationProp<AppStackParamList>
>;

// ── Helpers to map API data → card interfaces ─────────────────────────────────

const SPACE_EMOJIS = ['🌍', '🎯', '✨', '🔥', '💫', '🎪', '🌟', '🎭', '🍕', '🏕️'];

function nameHash(str: string): number {
  return str.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
}

export function apiSpaceToItem(s: ApiSpace): SpaceItem {
  const h = nameHash(s.name);
  return {
    id: s.id,
    name: s.name,
    memberCount: s.member_count ?? 0,
    placeCount: s.place_count ?? 0,
    memberPreviews: (s.member_previews ?? []).map(mp => ({
      userId: mp.user_id,
      name: mp.name,
      avatarUrl: mp.avatar_url,
    })),
    accentColor: colors.accentSoft,
    emoji: s.icon || SPACE_EMOJIS[h % SPACE_EMOJIS.length],
    bannerUrl: s.banner_url ?? null,
  };
}

const TAG_EMOJI: Record<string, string> = {
  restaurant: '🍽️', japanese: '🍱', sushi: '🍣', pizza: '🍕', italian: '🍝',
  cafe: '☕', coffee: '☕', bakery: '🥐', deli: '🥪', burger: '🍔',
  bar: '🍸', cocktail: '🍹', wine: '🍷', beer: '🍺',
  park: '🌳', garden: '🌿', nature: '🏞️', beach: '🏖️', mountain: '⛰️',
  museum: '🏛️', art: '🎨', music: '🎵', cinema: '🎬', theatre: '🎭',
  hotel: '🏨', shopping: '🛍️', spa: '💆', gym: '💪',
};

export function getEmoji(tags: string[]): string {
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    for (const [key, emoji] of Object.entries(TAG_EMOJI)) {
      if (lower.includes(key)) return emoji;
    }
  }
  return '📍';
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function apiPlaceToItem(p: ApiPlace): PlaceItem {
  return {
    id: p.id,
    name: p.name,
    category: capitalise(p.tags[0] ?? 'Place'),
    address: p.address ?? '',
    emoji: getEmoji(p.tags),
    tags: p.tags,
  };
}

/** Category pin colour: food, nature, culture, shop. */
function pinColor(category: string): string {
  const c = category.toLowerCase();
  if (/park|garden|nature|beach|mountain|outdoor/.test(c)) return colors.catPark;
  if (/museum|art|music|cinema|theatre|culture/.test(c)) return colors.catDeli;
  if (/shop|market|vintage/.test(c)) return colors.catShop;
  if (/restaurant|cafe|coffee|bakery|bar|food|pizza|sushi|burger|brunch/.test(c)) return colors.catRestaurant;
  return colors.catDefault;
}

// ── Component ─────────────────────────────────────────────────────────────────

type RecentPlace = PlaceItem & {visited: boolean};

export default function HomeScreen() {
  const {user} = useAuth();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();

  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const {location, setLocation, permission, hasFix} = useLocation();

  const [spaces, setSpaces] = useState<SpaceItem[]>([]);
  const [places, setPlaces] = useState<RecentPlace[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);

  const initial = (user?.name ?? 'U')[0].toUpperCase();

  // Reload every time the screen comes into focus (e.g. after creation).
  useFocusEffect(
    useCallback(() => {
      homeService
        .fetchSpaces()
        .then(data => setSpaces(data.map(apiSpaceToItem)))
        .catch(() => setSpaces([]));
      homeService
        .fetchPlaces()
        .then(data =>
          setPlaces(
            data
              .slice()
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map(p => ({...apiPlaceToItem(p), visited: !!p.visited})),
          ),
        )
        .catch(() => setPlaces([]));
      recommendationService
        .getGlobal()
        .then(data =>
          setRecommendations(
            data.map(r => ({
              id: 0, // external Google place — not yet in DB
              name: r.name,
              category: r.category,
              address: r.address,
              emoji: r.emoji,
              googlePlaceId: r.google_place_id,
              lat: r.lat,
              lng: r.lng,
              reason:
                r.reason_type === 'interests'
                  ? {type: 'interests' as const, label: r.reason_label}
                  : {type: 'space_area' as const, label: r.reason_label},
            })),
          ),
        )
        .catch(() => setRecommendations([]));
    }, []),
  );

  const openSpace = (id: number) => {
    const s = spaces.find(sp => sp.id === id);
    if (!s) return;
    navigation.navigate('SpaceDetail', {
      spaceId: id,
      spaceName: s.name,
      spaceIcon: s.emoji,
      bannerUrl: s.bannerUrl ?? null,
    });
  };

  const openRec = (item: RecommendationItem) =>
    navigation.navigate('CreatePlace', {
      prefillName: item.name,
      prefillAddress: item.address,
      prefillLat: item.lat,
      prefillLng: item.lng,
    });

  const toggleVisited = (id: number) => {
    const next = !places.find(p => p.id === id)?.visited;
    const apply = (v: boolean) =>
      setPlaces(ps => ps.map(p => (p.id === id ? {...p, visited: v} : p)));
    apply(next);
    placeService.setVisited(id, next).catch(() => apply(!next));
  };

  const locationLabel =
    location.mode === 'current' && permission === 'denied'
      ? 'Location off — tap to set'
      : location.mode === 'current' && !hasFix
        ? 'Locating…'
        : location.label;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, {paddingTop: insets.top + 12}]}
        showsVerticalScrollIndicator={false}>
        {/* Teal header block; the page ground rises over it on rounded corners
            so the capture card straddles the seam. */}
        <View style={[styles.band, {height: insets.top + 170}]} />
        <View style={[styles.bandSheet, {top: insets.top + 128}]} />

        <View style={styles.headerRow}>
          <AppLogo size="sm" inkColor={colors.white} ringed />
          <TouchableOpacity
            style={styles.avatar}
            accessibilityLabel="Profile"
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Account')}>
            <Text style={styles.avatarText}>{initial}</Text>
          </TouchableOpacity>
        </View>

        {/* Capture and context are one group: what you add, and where you are. */}
        <View style={styles.capture}>
          <TouchableOpacity
            style={styles.captureRow}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('CreatePlace')}>
            <View style={styles.addIcon}>
              <Text style={styles.addPlus}>＋</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.captureTitle}>Add a place</Text>
              <Text style={styles.mut}>Paste a TikTok or Instagram link, or search</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.captureRow, styles.captureScope]}
            activeOpacity={0.7}
            onPress={() => setLocationModalOpen(true)}>
            <View style={styles.pinGlyph} />
            <View style={[styles.flex, styles.scopeText]}>
              <Text style={styles.scopeLabel} numberOfLines={1}>
                {locationLabel}
              </Text>
              <Text style={styles.mut}>scopes what you see below</Text>
            </View>
            <Text style={styles.caret}>⌄</Text>
          </TouchableOpacity>
        </View>

        {/* ── Trending ─────────────────────────────────────────── */}
        <View style={[styles.section, styles.firstSection]}>
          <View style={styles.secHead}>
            <Text style={styles.sec}>Trending right now</Text>
          </View>
          {recommendations.length === 0 ? (
            <Text style={styles.emptyNote}>Nothing is trending near you yet. Check back soon.</Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.bleed}
              contentContainerStyle={styles.recRow}>
              {recommendations.map((item, idx) => (
                <TouchableOpacity
                  key={item.googlePlaceId ?? idx}
                  style={styles.recCard}
                  activeOpacity={0.85}
                  onPress={() => openRec(item)}>
                  <View style={styles.recTile}>
                    <Text style={styles.recEmoji}>{item.emoji}</Text>
                    <View style={styles.recBadge}>
                      <Text style={styles.recBadgeText} numberOfLines={1}>
                        {item.reason.type === 'interests' || item.reason.type === 'space_area'
                          ? item.reason.label
                          : 'For you'}
                      </Text>
                    </View>
                    <View style={styles.recSave}>
                      <Text style={styles.recSaveGlyph}>＋</Text>
                    </View>
                  </View>
                  <Text style={styles.recName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.mut} numberOfLines={1}>
                    {item.category}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* ── Recently saved ───────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.secHead}>
            <Text style={styles.sec}>Recently saved</Text>
            {places.length > 0 && (
              <TouchableOpacity onPress={() => navigation.navigate('Map')}>
                <Text style={styles.link}>All ({places.length})</Text>
              </TouchableOpacity>
            )}
          </View>
          {places.length === 0 ? (
            <Text style={styles.emptyNote}>
              Nothing saved yet. Add a place from a TikTok or search to start your list.
            </Text>
          ) : (
            <View style={styles.rows}>
              {places.slice(0, 3).map(p => (
                <View key={p.id} style={styles.row}>
                  <View style={styles.thumb}>
                    <Text style={styles.thumbEmoji}>{p.emoji}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.flex}
                    activeOpacity={0.7}
                    onPress={() =>
                      navigation.navigate('PlaceDetail', {placeId: p.id, placeName: p.name})
                    }>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <View style={styles.metaRow}>
                      <View style={[styles.dot, {backgroundColor: pinColor(p.category)}]} />
                      <Text style={[styles.mut, styles.flex]} numberOfLines={1}>
                        {[p.category, p.address].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.beenHere}
                    accessibilityRole="checkbox"
                    accessibilityLabel="Been here"
                    accessibilityState={{checked: p.visited}}
                    onPress={() => toggleVisited(p.id)}>
                    <View style={[styles.beenRing, p.visited && styles.beenOn]}>
                      <Text style={[styles.beenGlyph, p.visited && styles.beenGlyphOn]}>
                        {p.visited ? '✓' : '⌖'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ── Spaces ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.secHead}>
            <Text style={styles.sec}>Your spaces</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Spaces')}>
              <Text style={styles.link}>
                {spaces.length > 3 ? `All (${spaces.length})` : 'See all'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.grid}>
            {spaces.slice(0, 3).map(item => (
              <SpaceCard key={item.id} item={item} style={styles.gridCell} onPress={openSpace} />
            ))}
            <NewSpaceCard
              style={styles.gridCell}
              onPress={() => navigation.navigate('CreateSpace')}
            />
          </View>
        </View>
      </ScrollView>

      <LocationModal
        visible={locationModalOpen}
        location={location}
        onConfirm={loc => {
          setLocation(loc);
          setLocationModalOpen(false);
        }}
        onClose={() => setLocationModalOpen(false)}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  root: {flex: 1, backgroundColor: colors.background},
  content: {paddingHorizontal: 20, paddingBottom: 40},
  flex: {flex: 1, minWidth: 0},

  band: {position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.headerBg},
  bandSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {fontFamily: fonts.bold, fontSize: 15, color: colors.white},

  capture: {backgroundColor: colors.surface, borderRadius: radius.xl, overflow: 'hidden'},
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    minHeight: 56,
  },
  captureScope: {minHeight: 48, borderTopWidth: 1, borderTopColor: colors.border},
  addIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlus: {fontSize: 19, color: colors.white},
  captureTitle: {fontFamily: fonts.bold, fontSize: 14.5, color: colors.text},
  chevron: {fontSize: 22, color: colors.textSecondary},
  pinGlyph: {
    width: 16,
    height: 16,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: '#009FAA',
    transform: [{rotate: '-45deg'}],
    marginHorizontal: 11,
  },
  scopeText: {flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap'},
  scopeLabel: {fontFamily: fonts.bold, fontSize: 13.5, color: colors.text},
  caret: {fontSize: 14, color: colors.textSecondary, marginTop: -6},

  section: {marginTop: 32},
  firstSection: {marginTop: 32},
  secHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sec: {fontFamily: fonts.bold, fontSize: 14, color: colors.text},
  link: {fontFamily: fonts.bold, fontSize: 12, color: colors.primaryDeep, paddingVertical: 6},
  mut: {fontFamily: fonts.regular, fontSize: 11.5, color: colors.textSecondary},
  emptyNote: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
  },

  bleed: {marginHorizontal: -20},
  recRow: {paddingHorizontal: 20, gap: 12},
  recCard: {width: 196},
  recTile: {
    height: 132,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceDim,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  recEmoji: {fontSize: 40},
  recBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    maxWidth: 140,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  recBadgeText: {fontFamily: fonts.bold, fontSize: 11, color: colors.white},
  recSave: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recSaveGlyph: {fontSize: 16, color: colors.primaryDeep},
  recName: {fontFamily: fonts.bold, fontSize: 15, color: colors.text, marginTop: 8},

  rows: {gap: 8},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbEmoji: {fontSize: 20},
  rowName: {fontFamily: fonts.semibold, fontSize: 13.5, color: colors.text},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3},
  dot: {width: 7, height: 7, borderRadius: 4},

  // A 30px mark inside a 44px target: quiet ring when not visited, green disc when you have been.
  beenHere: {width: 44, height: 44, marginRight: -8, alignItems: 'center', justifyContent: 'center'},
  beenRing: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beenOn: {backgroundColor: colors.success, borderColor: colors.success},
  beenGlyph: {fontSize: 14, color: colors.textSecondary},
  beenGlyphOn: {fontFamily: fonts.bold, color: colors.white},

  grid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12},
  gridCell: {width: '48%'},
}));
