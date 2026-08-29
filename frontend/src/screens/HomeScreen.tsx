import React, {useCallback, useState} from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {LocationModal} from '../components/LocationModal';
import {Pin} from '../components/Pin';
import {SpaceCard, SpaceItem} from '../components/home/SpaceCard';
import {PlaceCard, PlaceItem} from '../components/home/PlaceCard';
import {RecommendationCard, RecommendationItem} from '../components/home/RecommendationCard';
import {useAuth} from '../hooks/useAuth';
import {useLocation} from '../hooks/useLocation';
import {homeService, ApiSpace, ApiPlace} from '../services/homeService';
import {recommendationService} from '../services/recommendationService';
import {AppStackParamList} from '../types/navigation';
import {colors, fonts, radius, spacing} from '../theme';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// ── Helpers to map API data → card interfaces ─────────────────────────────────

// Soft Organic tints, cycled per space so a list of cards stays varied.
const SPACE_TINTS = [
  colors.sand,
  colors.sageTint,
  colors.blush,
  colors.primaryLight,
  colors.surfaceDim,
];
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
    accentColor: SPACE_TINTS[h % SPACE_TINTS.length],
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

function getEmoji(tags: string[]): string {
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const {user} = useAuth();
  const navigation = useNavigation<Nav>();

  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const {location, setLocation, permission, hasFix} = useLocation();

  const [spaces, setSpaces] = useState<SpaceItem[]>([]);
  const [places, setPlaces] = useState<PlaceItem[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(true);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
  const [loadingRecs, setLoadingRecs] = useState(true);

  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const initials = (user?.name ?? 'U')[0].toUpperCase();

  const loadSpaces = useCallback(async () => {
    try {
      setLoadingSpaces(true);
      const data = await homeService.fetchSpaces();
      setSpaces(data.map(apiSpaceToItem));
    } catch {
      setSpaces([]);
    } finally {
      setLoadingSpaces(false);
    }
  }, []);

  const loadPlaces = useCallback(async () => {
    try {
      setLoadingPlaces(true);
      const data = await homeService.fetchPlaces();
      setPlaces(data.map(apiPlaceToItem));
    } catch {
      setPlaces([]);
    } finally {
      setLoadingPlaces(false);
    }
  }, []);

  const loadRecommendations = useCallback(async () => {
    try {
      setLoadingRecs(true);
      const data = await recommendationService.getGlobal();
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
      );
    } catch {
      setRecommendations([]);
    } finally {
      setLoadingRecs(false);
    }
  }, []);

  // Reload data every time the screen comes into focus (e.g. after creation)
  useFocusEffect(
    useCallback(() => {
      loadSpaces();
      loadPlaces();
      loadRecommendations();
    }, [loadSpaces, loadPlaces, loadRecommendations]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>

        {/* ── Greeting ───────────────────────────────────────────── */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.eyebrow}>{greeting.toUpperCase()}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {firstName}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.avatar}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.avatarText}>{initials}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.locationRow}
          onPress={() => setLocationModalOpen(true)}
          activeOpacity={0.7}>
          <Pin size={14} color={colors.textSecondary} />
          <Text style={styles.locationLabel} numberOfLines={1}>
            {location.mode === 'current' && permission === 'denied'
              ? 'Location off — tap to set'
              : location.mode === 'current' && !hasFix
                ? 'Locating…'
                : location.label}
          </Text>
          <Text style={styles.locationChevron}>⌄</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        {/* ── Spaces ─────────────────────────────────────────────── */}
        <SectionHeader
          title="Spaces"
          onAdd={() => navigation.navigate('CreateSpace')}
          onSeeAll={spaces.length > 0 ? () => navigation.navigate('SeeAll', {kind: 'spaces'}) : undefined}
        />
        {loadingSpaces ? (
          <CardSkeleton />
        ) : spaces.length === 0 ? (
          <EmptyCard
            icon={<Pin size={26} color={colors.textMuted} />}
            title="No spaces yet"
            body="Create a shared space with friends to plan and save places together."
            actionLabel="+ Create a space"
            onPress={() => navigation.navigate('CreateSpace')}
          />
        ) : (
          <FlatList
            data={spaces}
            keyExtractor={i => String(i.id)}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.spaceList}
            renderItem={({item}) => (
              <SpaceCard
                item={item}
                onPress={id => {
                  const s = spaces.find(sp => sp.id === id);
                  if (!s) return;
                  navigation.navigate('SpaceDetail', {
                    spaceId: id,
                    spaceName: s.name,
                    spaceIcon: s.emoji,
                    bannerUrl: s.bannerUrl ?? null,
                  });
                }}
              />
            )}
          />
        )}

        {/* ── Saved places ───────────────────────────────────────── */}
        <SectionHeader
          title="Saved places"
          onAdd={() => navigation.navigate('CreatePlace')}
          onSeeAll={places.length > 0 ? () => navigation.navigate('SeeAll', {kind: 'places'}) : undefined}
        />
        {loadingPlaces ? (
          <RowSkeleton />
        ) : places.length === 0 ? (
          <EmptyCard
            icon={<Pin size={26} color={colors.textMuted} />}
            title="No saved places yet"
            body="Start building your personal list of places you want to visit."
            actionLabel="+ Add a place"
            onPress={() => navigation.navigate('CreatePlace')}
          />
        ) : (
          <View style={styles.placeList}>
            {places.map((item, idx) => (
              <PlaceCard
                key={item.id}
                item={item}
                last={idx === places.length - 1}
                onPress={() =>
                  navigation.navigate('PlaceDetail', {
                    placeId: item.id,
                    placeName: item.name,
                  })
                }
              />
            ))}
          </View>
        )}

        {/* ── Recommendations ────────────────────────────────────── */}
        <SectionHeader title="Recommended for you" />
        {loadingRecs ? (
          <RowSkeleton />
        ) : recommendations.length === 0 ? (
          <EmptyCard
            icon={<Text style={styles.starIcon}>☆</Text>}
            title="Recommendations on the way"
            body="Save places and join spaces — we'll suggest new spots tailored to your taste."
          />
        ) : (
          <View>
            {recommendations.map((item, idx) => (
              <RecommendationCard
                key={item.googlePlaceId ?? idx}
                item={item}
                onPress={() => {
                  // External Google place → open CreatePlace with pre-filled data
                  if (item.id === 0) {
                    navigation.navigate('CreatePlace', {
                      prefillName: item.name,
                      prefillAddress: item.address,
                      prefillLat: item.lat,
                      prefillLng: item.lng,
                    });
                  } else {
                    navigation.navigate('PlaceDetail', {
                      placeId: item.id,
                      placeName: item.name,
                    });
                  }
                }}
              />
            ))}
          </View>
        )}

        <View style={styles.bottomPad} />
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
    </SafeAreaView>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  onAdd,
  onSeeAll,
}: {
  title: string;
  onAdd?: () => void;
  onSeeAll?: () => void;
}) {
  return (
    <View style={sh.row}>
      <Text style={sh.title}>{title}</Text>
      <View style={sh.actions}>
        {onSeeAll && (
          <TouchableOpacity onPress={onSeeAll} hitSlop={8}>
            <Text style={sh.link}>See all</Text>
          </TouchableOpacity>
        )}
        {onAdd && (
          <TouchableOpacity style={sh.addBtn} onPress={onAdd} hitSlop={8} activeOpacity={0.75}>
            <Text style={sh.addBtnText}>＋</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const sh = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  title: {fontFamily: fonts.display, fontSize: 21, color: colors.text},
  actions: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  link: {fontFamily: fonts.medium, fontSize: 14, color: colors.textSecondary},
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {color: colors.white, fontSize: 15, lineHeight: 19},
});

// ── Loading skeletons ─────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <View style={sk.row}>
      {[1, 2].map(i => (
        <View key={i} style={sk.card} />
      ))}
    </View>
  );
}

function RowSkeleton() {
  return (
    <View>
      {[1, 2].map(i => (
        <View key={i} style={sk.line} />
      ))}
    </View>
  );
}

const sk = StyleSheet.create({
  row: {flexDirection: 'row', gap: spacing.md},
  card: {flex: 1, height: 118, borderRadius: radius.lg, backgroundColor: colors.sand},
  line: {
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.sand,
    marginBottom: spacing.sm,
  },
});

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyCard({
  icon,
  title,
  body,
  actionLabel,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  actionLabel?: string;
  onPress?: () => void;
}) {
  return (
    <View style={es.card}>
      <View style={es.icon}>{icon}</View>
      <Text style={es.title}>{title}</Text>
      <Text style={es.body}>{body}</Text>
      {actionLabel && onPress && (
        <TouchableOpacity style={es.btn} onPress={onPress} activeOpacity={0.8}>
          <Text style={es.btnText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const es = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  icon: {marginBottom: spacing.md},
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  btn: {
    marginTop: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
  },
  btnText: {fontFamily: fonts.semibold, fontSize: 15, color: colors.primary},
});

// ── Main styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  scroll: {flex: 1},
  scrollContent: {paddingHorizontal: spacing.lg, paddingTop: spacing.sm},

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {flex: 1, marginRight: spacing.md},
  eyebrow: {
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: 1.4,
    color: colors.textMuted,
    marginBottom: 2,
  },
  name: {fontFamily: fonts.display, fontSize: 30, color: colors.text},

  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {fontFamily: fonts.display, fontSize: 18, color: colors.text},

  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: spacing.md,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  locationLabel: {fontFamily: fonts.regular, fontSize: 15, color: colors.text},
  locationChevron: {fontSize: 13, color: colors.textMuted, marginTop: -4},

  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.lg,
  },

  spaceList: {marginRight: -spacing.lg},
  placeList: {marginTop: -6},
  starIcon: {fontSize: 30, color: colors.textMuted},
  bottomPad: {height: spacing.xl},
});
