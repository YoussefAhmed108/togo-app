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
import {
  ActivityIndicator,
  Alert,
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
import memoryService from '../../services/memoryService';
import {colors, fonts, radius, spacing} from '../../theme';
import {Pin} from '../../components/Pin';
import {displayAddress} from '../../utils/address';

type Props = NativeStackScreenProps<AppStackParamList, 'PlaceDetail'>;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SpaceGroup {
  spaceId: number | null; // null = "Personal" (no space)
  spaceName: string;
  memories: ApiMemoryWithSpace[];
}

// ── Image picker helper ───────────────────────────────────────────────────────

interface PickedImage {
  uri: string;
  type: string;
}

async function pickImage(source: 'camera' | 'gallery'): Promise<PickedImage | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {launchCamera, launchImageLibrary} = require('react-native-image-picker');
    const options = {mediaType: 'photo' as const, quality: 0.85 as const, maxWidth: 1920, maxHeight: 1920};
    const res = await (source === 'camera' ? launchCamera(options) : launchImageLibrary(options));
    const asset = res?.assets?.[0];
    if (!asset?.uri) return null;
    return {uri: asset.uri, type: asset.type ?? 'image/jpeg'};
  } catch {
    Alert.alert('Image Picker Unavailable', 'Run: npm install react-native-image-picker && cd ios && pod install — then rebuild the app.');
    return null;
  }
}

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
  const [caption, setCaption] = useState('');
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
      await memoryService.create(placeId, key, caption || undefined, spaceId ?? undefined);
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
                <TouchableOpacity style={mu.pickerBtn} onPress={() => pickImage('camera').then(img => img && setPicked(img))}>
                  <Text style={mu.pickerIcon}>📸</Text>
                  <Text style={mu.pickerLabel}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={mu.pickerBtn} onPress={() => pickImage('gallery').then(img => img && setPicked(img))}>
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
        <ActivityIndicator color={colors.primary} size="large" />
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
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={12}>
          <Text style={s.backArrow}>‹</Text>
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>
          {place.name}
        </Text>
        <View style={s.headerRight} />
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
              {place.visited ? '✓' : '○'}
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
          <Text style={s.sectionTitle}>Memories</Text>

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
                <Text style={s.addMemoryLabel}>Add Memory</Text>
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
  backFallback: {marginTop: spacing.md},
  backFallbackText: {fontFamily: fonts.semibold, fontSize: 15, color: colors.primary},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  backBtn: {flexDirection: 'row', alignItems: 'center', width: 84, gap: 2},
  backArrow: {fontSize: 24, color: colors.primary, lineHeight: 26},
  backText: {fontFamily: fonts.medium, fontSize: 16, color: colors.primary},
  headerTitle: {flex: 1, fontFamily: fonts.display, fontSize: 19, color: colors.text, textAlign: 'center'},
  headerRight: {width: 84},

  scroll: {paddingBottom: spacing.xl},

  mapWrap: {height: 230, backgroundColor: colors.sand},
  map: {...StyleSheet.absoluteFillObject},

  infoSection: {paddingHorizontal: spacing.lg, paddingTop: spacing.lg},
  placeName: {fontFamily: fonts.display, fontSize: 28, color: colors.text, marginBottom: 10},
  addressRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md},
  addressText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
  },
  tagsRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md},
  tagPill: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  tagLabel: {fontFamily: fonts.regular, fontSize: 14.5, color: colors.primaryDeep},

  visitedBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  visitedBtnActive: {borderColor: colors.sage, backgroundColor: colors.sageSoft},
  visitedIcon: {fontSize: 15, color: colors.textMuted},
  visitedIconActive: {color: colors.sage},
  visitedLabel: {fontFamily: fonts.medium, fontSize: 16, color: colors.textSecondary},
  visitedLabelActive: {color: colors.sage},

  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.lg,
  },

  memoriesSection: {paddingHorizontal: spacing.lg},
  sectionTitle: {fontFamily: fonts.display, fontSize: 21, color: colors.text, marginBottom: spacing.md},

  tabScroll: {marginBottom: spacing.md, marginHorizontal: -spacing.lg},
  tabRow: {flexDirection: 'row', gap: 10, paddingHorizontal: spacing.lg},
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  tabActive: {backgroundColor: colors.primary},
  tabHighlighted: {backgroundColor: colors.primaryLight},
  tabLabel: {fontFamily: fonts.medium, fontSize: 15, color: colors.text},
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
  photo: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.lg,
    backgroundColor: colors.sand,
  },
  photoCaption: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 8,
  },

  noMemoriesWrap: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  noMemoriesText: {fontFamily: fonts.display, fontSize: 17, color: colors.text},
  noMemoriesSub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 6,
  },

  addMemoryBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  addMemoryIcon: {fontSize: 15, color: colors.primary},
  addMemoryLabel: {fontFamily: fonts.semibold, fontSize: 15, color: colors.primary},
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
  title: {fontFamily: fonts.display, fontSize: 24, color: colors.text},
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
    borderRadius: radius.xl,
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
    borderRadius: radius.full,
    height: 56,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  uploadBtnOff: {backgroundColor: colors.sandDeep},
  uploadLabel: {fontFamily: fonts.display, fontSize: 17, color: colors.white},
});
