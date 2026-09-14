/**
 * PlaceScreen — detail view for a single Place.
 *
 * Can be reached from:
 *   - SpaceScreen → passes fromSpaceId so that space's memories are shown first
 *   - HomeScreen saved-places list → no fromSpaceId; all memory groups shown equally
 *
 * Layout:
 *   Header (back, name)
 *   ─────────────────────
 *   Static map at place coords with a pin
 *   ─────────────────────
 *   Tags row
 *   Address
 *   ─────────────────────
 *   Memories section:
 *     • Space chips (horizontal tabs)
 *     • Photo strip for selected space
 *     • "Personal" tab for memories with no space
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {WaypointLoader} from '../../components/WaypointLoader';
import {
  ActivityIndicator,
  Alert,
  Linking,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MapView, {Marker, PROVIDER_GOOGLE, Region} from 'react-native-maps';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {AppStackParamList} from '../../types/navigation';
import {placeService, ApiPlace, ApiMemoryWithSpace} from '../../services/placeService';
import memoryService, {DishDraft} from '../../services/memoryService';
import {colors, fonts, radius, spacing} from '../../theme';
import {Pin} from '../../components/Pin';
import {displayAddress} from '../../utils/address';
import {pickImage, PickedImage} from '../../utils/pickImage';

type Props = NativeStackScreenProps<AppStackParamList, 'PlaceDetail'>;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SpaceGroup {
  spaceId: number | null; // null = "Personal" (no space)
  spaceName: string;
  memories: ApiMemoryWithSpace[];
}



// ── Stars ─────────────────────────────────────────────────────────────────────

/** 1-5 stars. Read-only when onRate is omitted. */
function Stars({
  rating,
  onRate,
  size = 20,
}: {
  rating: number;
  onRate?: (n: number) => void;
  size?: number;
}) {
  return (
    <View style={st.row}>
      {[1, 2, 3, 4, 5].map(n => (
        <TouchableOpacity
          key={n}
          disabled={!onRate}
          onPress={() => onRate?.(n)}
          hitSlop={6}
          activeOpacity={0.7}>
          <Text style={[st.star, {fontSize: size}, n <= rating && st.starOn]}>
            {n <= rating ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  row: {flexDirection: 'row', gap: 2},
  star: {color: colors.textSecondary},
  starOn: {color: colors.primary},
});

// ── Memory Upload Modal ───────────────────────────────────────────────────────

interface UploadModalProps {
  placeId: number;
  spaceId: number | null; // space to attribute the memory to
  spaceName: string;
  onDismiss: () => void;
  onUploaded: () => void;
}

function MemoryUploadModal({placeId, spaceId, spaceName, onDismiss, onUploaded}: UploadModalProps) {
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const choose = (source: 'camera' | 'gallery') =>
    pickImage(source)
      .then(img => img && setPicked(img))
      .catch((err: any) =>
        Alert.alert('Could not open photos', err?.message ?? 'Check photo and camera access in Settings.'),
      );
  const [caption, setCaption] = useState('');
  const [dishes, setDishes] = useState<DishDraft[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<'idle' | 'presigning' | 'uploading' | 'saving'>('idle');

  const handleUpload = async () => {
    if (!picked) return;
    setUploading(true);
    try {
      setProgress('presigning');
      const {presign_url, key} = await memoryService.presign('memory');
      setProgress('uploading');
      await memoryService.uploadToR2(presign_url, picked.uri, picked.type);
      setProgress('saving');
      // Half-typed rows are dropped rather than rejected by the API.
      const named = dishes.filter(d => d.name.trim().length > 0);
      await memoryService.create(
        placeId,
        key,
        caption || undefined,
        spaceId ?? undefined,
        named,
      );
      onUploaded();
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message ?? 'Something went wrong.');
    } finally {
      setUploading(false);
      setProgress('idle');
    }
  };

  const progressLabel: Record<string, string> = {
    presigning: 'Preparing…',
    uploading: 'Uploading…',
    saving: 'Saving…',
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onDismiss}>
      <Pressable style={mu.backdrop} onPress={onDismiss} />
      <View style={mu.container}>
        <View style={mu.handle} />
        {/* Header */}
        <View style={mu.header}>
          <View>
            <Text style={mu.title}>Add Memory</Text>
            <Text style={mu.subtitle} numberOfLines={1}>
              {spaceId ? spaceName : 'Personal'}
            </Text>
          </View>
          <TouchableOpacity onPress={onDismiss} hitSlop={8} style={mu.closeBtn}>
            <Text style={mu.closeX}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={mu.body} keyboardShouldPersistTaps="handled">
          {/* Photo picker */}
          {picked ? (
            <TouchableOpacity onPress={() => setPicked(null)} activeOpacity={0.85}>
              <Image source={{uri: picked.uri}} style={mu.preview} resizeMode="cover" />
              <Text style={mu.changeTip}>Tap to change photo</Text>
            </TouchableOpacity>
          ) : (
            <View style={mu.pickerZone}>
              <Text style={mu.pickerZoneIcon}>📷</Text>
              <Text style={mu.pickerZoneHint}>Choose a photo for this memory</Text>
              <View style={mu.pickerRow}>
                <TouchableOpacity style={mu.pickerBtn} onPress={() => choose('camera')}>
                  <Text style={mu.pickerIcon}>📸</Text>
                  <Text style={mu.pickerLabel}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={mu.pickerBtn} onPress={() => choose('gallery')}>
                  <Text style={mu.pickerIcon}>🖼️</Text>
                  <Text style={mu.pickerLabel}>Gallery</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Caption */}
          <TextInput
            style={mu.captionInput}
            placeholder="Add a caption (optional)"
            placeholderTextColor={colors.textSecondary}
            value={caption}
            onChangeText={setCaption}
            multiline
            maxLength={200}
          />
          <Text style={mu.captionCount}>{caption.length}/200</Text>

          {/* Dishes — what you ate, rated out of 5 */}
          <Text style={mu.dishHeading}>Dishes</Text>
          {dishes.map((d, i) => (
            <View key={i} style={mu.dishRow}>
              <TextInput
                style={mu.dishInput}
                placeholder="Dish name"
                placeholderTextColor={colors.textSecondary}
                value={d.name}
                onChangeText={name =>
                  setDishes(prev => prev.map((x, j) => (j === i ? {...x, name} : x)))
                }
                maxLength={120}
              />
              <Stars
                rating={d.rating}
                onRate={rating =>
                  setDishes(prev => prev.map((x, j) => (j === i ? {...x, rating} : x)))
                }
              />
              <TouchableOpacity
                onPress={() => setDishes(prev => prev.filter((_, j) => j !== i))}
                hitSlop={8}>
                <Text style={mu.dishRemove}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity
            style={mu.addDishBtn}
            activeOpacity={0.8}
            onPress={() => setDishes(prev => [...prev, {name: '', rating: 5}])}>
            <Text style={mu.addDishLabel}>＋ Add a dish</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Upload button */}
        <View style={mu.footer}>
          <TouchableOpacity
            style={[mu.uploadBtn, (!picked || uploading) && mu.uploadBtnOff]}
            onPress={handleUpload}
            disabled={!picked || uploading}
            activeOpacity={0.85}>
            {uploading ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : null}
            <Text style={mu.uploadLabel}>
              {uploading ? progressLabel[progress] ?? 'Uploading…' : 'Save Memory'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function PlaceScreen({route, navigation}: Props) {
  const {placeId, placeName, fromSpaceId} = route.params;
  const insets = useSafeAreaInsets();

  const [place, setPlace] = useState<ApiPlace | null>(null);
  const [memories, setMemories] = useState<ApiMemoryWithSpace[]>([]);
  const [loading, setLoading] = useState(true);

  // Selected tab = spaceId (null = personal/no space)
  const [activeGroupId, setActiveGroupId] = useState<number | null | undefined>(undefined);

  // Memory upload state
  const [uploadGroup, setUploadGroup] = useState<SpaceGroup | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [placeData, memoriesData] = await Promise.all([
        placeService.getPlace(placeId),
        placeService.getMemories(placeId),
      ]);
      setPlace(placeData);
      setMemories(memoriesData);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not load place.');
    } finally {
      setLoading(false);
    }
  }, [placeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Build space groups from memories
  const groups: SpaceGroup[] = React.useMemo(() => {
    const map = new Map<number | null, SpaceGroup>();

    for (const mem of memories) {
      const key = mem.space_id ?? null;
      if (!map.has(key)) {
        map.set(key, {
          spaceId: key,
          spaceName: mem.space_name ?? 'Personal',
          memories: [],
        });
      }
      map.get(key)!.memories.push(mem);
    }

    // Ensure a "Personal" group always exists for memories without a space
    if (!map.has(null)) {
      map.set(null, {spaceId: null, spaceName: 'Personal', memories: []});
    }

    const result = Array.from(map.values());

    // Sort: fromSpaceId group first, then other spaces alphabetically, personal last
    result.sort((a, b) => {
      if (a.spaceId === fromSpaceId) return -1;
      if (b.spaceId === fromSpaceId) return 1;
      if (a.spaceId === null) return 1;
      if (b.spaceId === null) return -1;
      return a.spaceName.localeCompare(b.spaceName);
    });

    return result;
  }, [memories, fromSpaceId]);

  // Default active tab to the first group once data loads
  useEffect(() => {
    if (activeGroupId === undefined && groups.length > 0) {
      setActiveGroupId(groups[0].spaceId);
    }
  }, [groups, activeGroupId]);

  const activeGroup = groups.find(g => g.spaceId === activeGroupId) ?? groups[0];

  const mapRegion: Region | undefined = place
    ? {
        latitude: place.lat,
        longitude: place.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }
    : undefined;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[s.loadWrap, {paddingTop: insets.top}]}>
        <WaypointLoader />
      </View>
    );
  }

  if (!place) {
    return (
      <View style={[s.loadWrap, {paddingTop: insets.top}]}>
        <Text style={s.errorText}>Place not found.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backFallback}>
          <Text style={s.backFallbackText}>← Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.root, {paddingTop: insets.top}]}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={s.backBtn}
          accessibilityLabel="Back">
          <Text style={s.backArrow}>‹</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Map ─────────────────────────────────────────────────────── */}
        {mapRegion && (
          <View style={s.mapWrap}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={s.map}
              region={mapRegion}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}>
              <Marker coordinate={{latitude: place.lat, longitude: place.lng}} />
            </MapView>
          </View>
        )}

        {/* ── Info ─────────────────────────────────────────────────────── */}
        <View style={s.infoSection}>
          <Text style={s.placeName}>{place.name}</Text>
          {!!displayAddress(place.address) && (
            <View style={s.addressRow}>
              <Pin size={16} color={colors.textSecondary} />
              <Text style={s.addressText} numberOfLines={2}>
                {displayAddress(place.address)}
              </Text>
            </View>
          )}

          {place.tags.length > 0 && (
            <View style={s.tagsRow}>
              {place.tags.map(tag => (
                <View key={tag} style={s.tagPill}>
                  <Text style={s.tagLabel}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {!!place.source_url && (
            <TouchableOpacity
              style={s.sourceCard}
              onPress={() => Linking.openURL(place.source_url!).catch(() => Alert.alert('Could not open TikTok'))}
              activeOpacity={0.8}
              accessibilityRole="link"
              accessibilityLabel="Open the TikTok this place was found in">
              <View style={s.sourceIcon}>
                <View style={s.sourcePlay} />
              </View>
              <View style={s.sourceBody}>
                <Text style={s.sourceTitle}>Found on TikTok</Text>
                <Text style={s.sourceUrl} numberOfLines={1}>
                  {place.source_url.replace(/^https?:\/\/(www\.)?/, '')}
                </Text>
              </View>
              <Text style={s.sourceArrow}>↗</Text>
            </TouchableOpacity>
          )}

          {/* Visited toggle */}
          <TouchableOpacity
            style={[s.visitedBtn, place.visited && s.visitedBtnActive]}
            onPress={async () => {
              try {
                const updated = await placeService.setVisited(placeId, !place.visited);
                setPlace(prev => prev ? {...prev, visited: updated.visited} : prev);
              } catch {
                Alert.alert('Error', 'Could not update visited status.');
              }
            }}
            activeOpacity={0.75}>
            <Text style={[s.visitedIcon, place.visited && s.visitedIconActive]}>
              {place.visited ? '✓' : '⌖'}
            </Text>
            <Text style={[s.visitedLabel, place.visited && s.visitedLabelActive]}>
              {place.visited ? 'Visited' : 'Mark as visited'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Divider ──────────────────────────────────────────────────── */}
        <View style={s.divider} />

        {/* ── Memories section ─────────────────────────────────────────── */}
        <View style={s.memoriesSection}>
          <Text style={s.sectionTitle}>Memories here</Text>

          {/* Space group tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.tabRow}
            style={s.tabScroll}>
            {groups.map(g => {
              const active = g.spaceId === activeGroupId;
              const isHighlighted = g.spaceId === fromSpaceId;
              return (
                <TouchableOpacity
                  key={String(g.spaceId)}
                  style={[
                    s.tab,
                    active && s.tabActive,
                    isHighlighted && !active && s.tabHighlighted,
                  ]}
                  onPress={() => setActiveGroupId(g.spaceId)}
                  activeOpacity={0.75}>
                  <Text style={[s.tabLabel, active && s.tabLabelActive]}>
                    {g.spaceName}
                  </Text>
                  <View style={[s.tabBadge, active && s.tabBadgeActive]}>
                    <Text style={[s.tabBadgeText, active && s.tabBadgeTextActive]}>
                      {g.memories.length}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Photo strip for active group */}
          {activeGroup && (
            <>
              {activeGroup.memories.length === 0 ? (
                <View style={s.noMemoriesWrap}>
                  <Text style={s.noMemoriesText}>No memories yet.</Text>
                  <Text style={s.noMemoriesSub}>Tap ＋ to add the first one!</Text>
                </View>
              ) : (
                <View style={s.photoGrid}>
                  {activeGroup.memories.map(mem => (
                    <View key={mem.id} style={s.photoCard}>
                      <Image
                        source={{uri: mem.image_url}}
                        style={s.photo}
                        resizeMode="cover"
                      />
                      {mem.caption && (
                        <Text style={s.photoCaption} numberOfLines={2}>
                          {mem.caption}
                        </Text>
                      )}
                      {mem.dishes?.map(dish => (
                        <View key={dish.id} style={s.dishLine}>
                          <Text style={s.dishName} numberOfLines={1}>
                            {dish.name}
                          </Text>
                          <Stars rating={dish.rating} size={12} />
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              )}

              {/* Add memory button */}
              <TouchableOpacity
                style={s.addMemoryBtn}
                onPress={() => setUploadGroup(activeGroup)}
                activeOpacity={0.8}>
                <Text style={s.addMemoryIcon}>＋</Text>
                <Text style={s.addMemoryLabel}>Add memory</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Bottom padding */}
        <View style={{height: insets.bottom + 24}} />
      </ScrollView>

      {/* ── Memory upload modal ────────────────────────────────────────── */}
      {uploadGroup && (
        <MemoryUploadModal
          placeId={placeId}
          spaceId={uploadGroup.spaceId}
          spaceName={uploadGroup.spaceName}
          onDismiss={() => setUploadGroup(null)}
          onUploaded={() => {
            setUploadGroup(null);
            loadData();
          }}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
  loadWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  errorText: {fontFamily: fonts.regular, fontSize: 16, color: colors.textSecondary},
  sourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sourceIcon: {
    width: 34,
    height: 42,
    borderRadius: 9,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A play triangle from borders, like the TikTok wait's video.
  sourcePlay: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.white,
  },
  sourceBody: {flex: 1, gap: 2},
  sourceTitle: {fontFamily: fonts.bold, fontSize: 15, color: colors.text},
  sourceUrl: {fontFamily: fonts.regular, fontSize: 12, color: colors.textSecondary},
  sourceArrow: {fontFamily: fonts.bold, fontSize: 18, color: colors.primary},
  backFallback: {marginTop: spacing.md},
  backFallbackText: {fontFamily: fonts.semibold, fontSize: 15, color: colors.primary},

  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingTop: 4, paddingBottom: 8},
  backBtn: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'},
  backArrow: {fontSize: 30, color: colors.text, lineHeight: 32},
  backText: {fontFamily: fonts.medium, fontSize: 16, color: colors.primary},
  headerTitle: {flex: 1, fontFamily: fonts.bold, fontSize: 16, color: colors.text, textAlign: 'center'},
  headerRight: {width: 84},

  scroll: {paddingBottom: spacing.xl},

  mapWrap: {height: 200, marginHorizontal: 20, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surfaceDim},
  map: {...StyleSheet.absoluteFillObject},

  infoSection: {paddingHorizontal: 20, paddingTop: spacing.md},
  placeName: {fontFamily: fonts.bold, fontSize: 24, letterSpacing: -0.5, color: colors.text, marginBottom: 8},
  addressRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md},
  addressText: {flex: 1, fontFamily: fonts.regular, fontSize: 12.5, color: colors.textSecondary},
  tagsRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md},
  tagPill: {backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, minHeight: 36, justifyContent: 'center', paddingHorizontal: 13},
  tagLabel: {fontFamily: fonts.semibold, fontSize: 12, color: colors.text},

  visitedBtn: {flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.ringIdle, padding: 14, marginTop: 4},
  visitedBtnActive: {borderColor: colors.success, backgroundColor: colors.sageTint},
  visitedIcon: {width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.ringIdle, textAlign: 'center', lineHeight: 24, fontSize: 14, color: colors.textSecondary, overflow: 'hidden'},
  visitedIconActive: {backgroundColor: colors.success, borderColor: colors.success, color: colors.white},
  visitedLabel: {fontFamily: fonts.bold, fontSize: 14, color: colors.text},
  visitedLabelActive: {color: colors.text},

  divider: {height: 0, marginVertical: 13},

  memoriesSection: {paddingHorizontal: 20},
  sectionTitle: {fontFamily: fonts.bold, fontSize: 14, color: colors.text, marginBottom: 10},

  tabScroll: {marginBottom: spacing.md, marginHorizontal: -spacing.lg},
  tabRow: {flexDirection: 'row', gap: 10, paddingHorizontal: spacing.lg},
  tab: {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, minHeight: 36, paddingHorizontal: 13},
  tabActive: {backgroundColor: colors.primary, borderColor: colors.primary},
  tabHighlighted: {backgroundColor: colors.primaryLight},
  tabLabel: {fontFamily: fonts.semibold, fontSize: 12, color: colors.text},
  tabLabelActive: {color: colors.white},
  tabBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeActive: {backgroundColor: 'rgba(255,255,255,0.25)'},
  tabBadgeText: {fontFamily: fonts.semibold, fontSize: 12, color: colors.textSecondary},
  tabBadgeTextActive: {color: colors.white},

  photoGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md},
  photoCard: {width: '47.5%'},
  photo: {width: '100%', aspectRatio: 1, borderRadius: radius.lg, backgroundColor: colors.surfaceDim},
  photoCaption: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 8,
  },

  noMemoriesWrap: {borderRadius: radius.md, backgroundColor: colors.surface, paddingVertical: spacing.lg, alignItems: 'center'},
  noMemoriesText: {fontFamily: fonts.bold, fontSize: 14, color: colors.text},
  noMemoriesSub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 6,
  },

  dishLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  dishName: {flex: 1, fontFamily: fonts.regular, fontSize: 12, color: colors.text},

  addMemoryBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.md, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, minHeight: 64},
  addMemoryIcon: {fontSize: 18, color: colors.textSecondary},
  addMemoryLabel: {fontFamily: fonts.semibold, fontSize: 12, color: colors.textSecondary},
});

// ── Add Memory modal styles ───────────────────────────────────────────────────

const mu = StyleSheet.create({
  backdrop: {flex: 1, backgroundColor: colors.overlay},
  container: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: spacing.md,
    paddingBottom: 34,
    maxHeight: '86%',
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.sandDeep,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  title: {fontFamily: fonts.bold, fontSize: 16, color: colors.text},
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeX: {fontSize: 14, color: colors.textSecondary},

  body: {paddingHorizontal: spacing.lg, paddingTop: spacing.md},
  preview: {width: '100%', height: 240, borderRadius: radius.lg},
  changeTip: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  pickerZone: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.sandDeep,
    backgroundColor: colors.surface,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  pickerZoneIcon: {fontSize: 28, marginBottom: 10, opacity: 0.6},
  pickerZoneHint: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  pickerRow: {flexDirection: 'row', gap: spacing.md, alignSelf: 'stretch'},
  pickerBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.sand,
  },
  pickerIcon: {fontSize: 22},
  pickerLabel: {fontFamily: fonts.semibold, fontSize: 15, color: colors.text, marginTop: 6},

  captionInput: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.sandDeep,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    minHeight: 60,
    textAlignVertical: 'top',
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
  },
  dishHeading: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.text,
    marginTop: 18,
    marginBottom: 8,
  },
  dishRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8},
  dishInput: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.sand,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  dishRemove: {fontSize: 14, color: colors.textSecondary},
  addDishBtn: {alignSelf: 'flex-start', paddingVertical: 6},
  addDishLabel: {fontFamily: fonts.semibold, fontSize: 14, color: colors.primary},

  captionCount: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: 6,
  },

  footer: {paddingHorizontal: spacing.lg, paddingTop: spacing.md},
  uploadBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    minHeight: 48,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  uploadBtnOff: {backgroundColor: colors.sandDeep},
  uploadLabel: {fontFamily: fonts.bold, fontSize: 15, color: colors.white},
});
