/**
 * SpaceScreen — full detail view for a Space.
 *
 * Memory upload requires react-native-image-picker:
 *   npm install react-native-image-picker
 *   cd ios && pod install
 *   Add to ios/frontend/Info.plist:
 *     NSCameraUsageDescription   → "Take a photo for this memory"
 *     NSPhotoLibraryUsageDescription → "Choose a photo for this memory"
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {AppStackParamList} from '../../types/navigation';
import {
  spaceDetailService,
  ApiSpacePlace,
  ApiSpaceMember,
  ApiSpaceMemory,
} from '../../services/spaceDetailService';
import {homeService} from '../../services/homeService';
import {spaceService} from '../../services/spaceService';
import memoryService from '../../services/memoryService';
import {placeService} from '../../services/placeService';
import {recommendationService, ApiRecommendation} from '../../services/recommendationService';
import {colors, fonts, radius, shadows, spacing} from '../../theme';
import {categoryTint} from '../../components/home/PlaceCard';
import {useLocation} from '../../hooks/useLocation';
import {useAuth} from '../../hooks/useAuth';
import {displayAddress} from '../../utils/address';

type Props = NativeStackScreenProps<AppStackParamList, 'SpaceDetail'>;

// ── Distance helpers ──────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

// ── Place filtering ───────────────────────────────────────────────────────────

export type StatusFilter = 'all' | 'unvisited' | 'visited';
export type SortKey = 'distance' | 'recent' | 'name';

export interface PlaceFilters {
  status: StatusFilter;
  tags: string[];
  sort: SortKey;
}

const DEFAULT_FILTERS: PlaceFilters = {status: 'all', tags: [], sort: 'distance'};

const STATUS_OPTIONS: Array<{key: StatusFilter; label: string}> = [
  {key: 'all', label: 'All'},
  {key: 'unvisited', label: 'Unvisited'},
  {key: 'visited', label: 'Visited'},
];

const SORT_OPTIONS: Array<{key: SortKey; label: string}> = [
  {key: 'distance', label: 'Distance — nearest first'},
  {key: 'recent', label: 'Recently added'},
  {key: 'name', label: 'Name — A to Z'},
];

/** How many filter groups are away from their default — drives the chip badge. */
function activeFilterCount(f: PlaceFilters): number {
  return (
    (f.status !== 'all' ? 1 : 0) +
    (f.tags.length > 0 ? 1 : 0) +
    (f.sort !== 'distance' ? 1 : 0)
  );
}

// ── Emoji / colour helpers ────────────────────────────────────────────────────

const TAG_EMOJI: Record<string, string> = {
  restaurant: '🍽️', japanese: '🍱', sushi: '🍣', pizza: '🍕', cafe: '☕',
  coffee: '☕', bakery: '🥐', bar: '🍸', cocktail: '🍹', park: '🌳',
  nature: '🏞️', beach: '🏖️', museum: '🏛️', art: '🎨', hotel: '🏨',
  shopping: '🛍️', gym: '💪', burger: '🍔', italian: '🍝', deli: '🥪',
};
function tagEmoji(tag: string): string {
  const lower = tag.toLowerCase();
  for (const [k, e] of Object.entries(TAG_EMOJI)) {
    if (lower.includes(k)) return e;
  }
  return '🏷️';
}
function placeEmoji(tags: string[]): string {
  for (const t of tags) {
    for (const [k, e] of Object.entries(TAG_EMOJI)) {
      if (t.toLowerCase().includes(k)) return e;
    }
  }
  return '📍';
}

const AVATAR_PALETTE = [colors.primary, colors.sage, colors.primaryDeep, colors.catDeli];
function avatarColor(name: string): string {
  const code = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[code % AVATAR_PALETTE.length];
}
function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return p.length === 1
    ? p[0][0]?.toUpperCase() ?? '?'
    : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function buildQuickMemoryPlaces(
  places: ApiSpacePlace[],
  activePlaceId: number | null,
  maxItems = 4,
): ApiSpacePlace[] {
  const picked: ApiSpacePlace[] = [];

  if (activePlaceId !== null) {
    const activePlace = places.find(place => place.id === activePlaceId);
    if (activePlace) {
      picked.push(activePlace);
    }
  }

  for (const place of places) {
    if (picked.some(item => item.id === place.id)) continue;
    picked.push(place);
    if (picked.length >= maxItems) break;
  }

  return picked;
}

// ── Image picker helper ───────────────────────────────────────────────────────
// Requires: npm install react-native-image-picker && pod install

interface PickedImage {
  uri: string;
  type: string;
  fileName: string;
}

async function pickImage(source: 'camera' | 'gallery'): Promise<PickedImage | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {launchCamera, launchImageLibrary} = require('react-native-image-picker');
    const options = {
      mediaType: 'photo' as const,
      quality: 0.85 as const,
      maxWidth: 1920,
      maxHeight: 1920,
      includeBase64: false,
    };

    const result = await new Promise<any>(resolve => {
      if (source === 'camera') {
        launchCamera(options, resolve);
      } else {
        launchImageLibrary(options, resolve);
      }
    });

    if (result.didCancel || result.errorCode) return null;

    const asset = result.assets?.[0];
    if (!asset?.uri) return null;

    return {
      uri: asset.uri,
      type: asset.type ?? 'image/jpeg',
      fileName: asset.fileName ?? 'memory.jpg',
    };
  } catch {
    // react-native-image-picker not installed — show friendly error
    Alert.alert(
      'Image Picker Unavailable',
      'Run: npm install react-native-image-picker && cd ios && pod install — then rebuild the app.',
    );
    return null;
  }
}

// ── Memory Upload Modal ───────────────────────────────────────────────────────

interface MemoryUploadModalProps {
  place: ApiSpacePlace;
  spaceId: number;
  onDismiss: () => void;
  onUploaded: () => void;
}

function MemoryUploadModal({place, spaceId, onDismiss, onUploaded}: MemoryUploadModalProps) {
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<'idle' | 'presigning' | 'uploading' | 'saving'>('idle');

  const handlePick = async (source: 'camera' | 'gallery') => {
    const img = await pickImage(source);
    if (img) setPicked(img);
  };

  const handleUpload = async () => {
    if (!picked) return;
    setUploading(true);
    try {
      // 1. Get presigned URL
      setProgress('presigning');
      const {presign_url, key} = await memoryService.presign('memory');

      // 2. Upload binary to R2
      setProgress('uploading');
      await memoryService.uploadToR2(presign_url, picked.uri, picked.type);

      // 3. Register with backend
      setProgress('saving');
      await memoryService.create(place.id, key, caption || undefined, spaceId);

      onUploaded();
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setUploading(false);
      setProgress('idle');
    }
  };

  const progressLabel: Record<typeof progress, string> = {
    idle: 'Save Memory',
    presigning: 'Preparing…',
    uploading: 'Uploading…',
    saving: 'Saving…',
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onDismiss}>
      <TouchableOpacity style={mu.backdrop} activeOpacity={1} onPress={onDismiss} />
      <View style={mu.container}>
        <View style={mu.handle} />

        {/* Header */}
        <View style={mu.header}>
          <View>
            <Text style={mu.title}>Add Memory</Text>
            <Text style={mu.subtitle} numberOfLines={1}>{place.name}</Text>
          </View>
          <TouchableOpacity onPress={onDismiss} style={mu.closeBtn} hitSlop={8}>
            <Text style={mu.closeX}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Image preview / picker */}
        {picked ? (
          <View style={mu.previewWrap}>
            <Image source={{uri: picked.uri}} style={mu.preview} resizeMode="cover" />
            <TouchableOpacity
              style={mu.changeBtn}
              onPress={() => setPicked(null)}
              activeOpacity={0.8}>
              <Text style={mu.changeBtnText}>Change photo</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={mu.pickArea}>
            <Text style={mu.pickIcon}>📷</Text>
            <Text style={mu.pickHint}>Choose a photo for this memory</Text>
            <View style={mu.pickBtnRow}>
              <TouchableOpacity
                style={mu.pickBtn}
                onPress={() => handlePick('camera')}
                activeOpacity={0.8}>
                <Text style={mu.pickBtnIcon}>📸</Text>
                <Text style={mu.pickBtnText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={mu.pickBtn}
                onPress={() => handlePick('gallery')}
                activeOpacity={0.8}>
                <Text style={mu.pickBtnIcon}>🖼️</Text>
                <Text style={mu.pickBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Caption */}
        <TextInput
          style={mu.captionInput}
          placeholder="Add a caption… (optional)"
          placeholderTextColor={colors.placeholder}
          value={caption}
          onChangeText={setCaption}
          maxLength={200}
          multiline
          numberOfLines={2}
          returnKeyType="done"
          blurOnSubmit
        />
        <Text style={mu.captionCount}>{caption.length}/200</Text>

        {/* Upload button */}
        <TouchableOpacity
          style={[mu.uploadBtn, (!picked || uploading) && mu.uploadBtnDisabled]}
          onPress={handleUpload}
          disabled={!picked || uploading}
          activeOpacity={0.85}>
          {uploading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : null}
          <Text style={mu.uploadBtnText}>
            {uploading ? progressLabel[progress] : 'Save Memory'}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const mu = StyleSheet.create({
  backdrop: {flex: 1, backgroundColor: colors.overlay},
  container: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: spacing.md,
    paddingBottom: 34,
    paddingHorizontal: spacing.lg,
    maxHeight: '88%',
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
    marginBottom: spacing.md,
  },
  title: {fontFamily: fonts.display, fontSize: 24, color: colors.text},
  subtitle: {fontFamily: fonts.regular, fontSize: 15, color: colors.textSecondary, marginTop: 2},
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeX: {fontSize: 14, color: colors.textSecondary},

  pickArea: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.sandDeep,
    backgroundColor: colors.surface,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  pickIcon: {fontSize: 28, marginBottom: 10, opacity: 0.6},
  pickHint: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  pickBtnRow: {flexDirection: 'row', gap: spacing.md, alignSelf: 'stretch'},
  pickBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.sand,
  },
  pickBtnIcon: {fontSize: 22},
  pickBtnText: {fontFamily: fonts.semibold, fontSize: 15, color: colors.text, marginTop: 6},

  previewWrap: {alignItems: 'center'},
  preview: {width: '100%', height: 230, borderRadius: radius.lg},
  changeBtn: {
    marginTop: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.sand,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  changeBtnText: {fontFamily: fonts.semibold, fontSize: 14, color: colors.textSecondary},

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
    marginBottom: spacing.md,
  },

  uploadBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadBtnDisabled: {backgroundColor: colors.sandDeep},
  uploadBtnText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},
});

// ── "Add Place to Space" bottom sheet ────────────────────────────────────────

// ── Filter Places Modal ───────────────────────────────────────────────────────

interface FilterSheetProps {
  filters: PlaceFilters;
  /** Tags actually present on this space's places. */
  availableTags: string[];
  /** How many places the pending selection would show. */
  resultCount: (f: PlaceFilters) => number;
  onApply: (f: PlaceFilters) => void;
  onClose: () => void;
}

function FilterPlacesSheet({
  filters,
  availableTags,
  resultCount,
  onApply,
  onClose,
}: FilterSheetProps) {
  const [draft, setDraft] = useState<PlaceFilters>(filters);

  const toggleTag = (tag: string) =>
    setDraft(d => ({
      ...d,
      tags: d.tags.includes(tag) ? d.tags.filter(t => t !== tag) : [...d.tags, tag],
    }));

  const count = resultCount(draft);
  const dirty = activeFilterCount(draft) > 0;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={filter.backdrop} onPress={onClose} />
      <View style={filter.container}>
        <View style={filter.handle} />

        <View style={filter.titleRow}>
          <Text style={filter.title}>Filter Places</Text>
          {dirty && (
            <TouchableOpacity onPress={() => setDraft(DEFAULT_FILTERS)} hitSlop={8}>
              <Text style={filter.reset}>Reset</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* ── Status ─────────────────────────────────────────────────── */}
          <Text style={filter.label}>STATUS</Text>
          <View style={filter.segment}>
            {STATUS_OPTIONS.map(opt => {
              const active = draft.status === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[filter.segmentItem, active && filter.segmentItemActive]}
                  activeOpacity={0.8}
                  onPress={() => setDraft(d => ({...d, status: opt.key}))}>
                  <Text
                    style={[filter.segmentText, active && filter.segmentTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Tags ───────────────────────────────────────────────────── */}
          {availableTags.length > 0 && (
            <>
              <View style={filter.labelRow}>
                <Text style={filter.label}>TAGS</Text>
                {draft.tags.length > 0 && (
                  <Text style={filter.labelCount}>{draft.tags.length} selected</Text>
                )}
              </View>
              <View style={filter.tagGrid}>
                {availableTags.map(tag => {
                  const active = draft.tags.includes(tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      style={[filter.tagChip, active && filter.tagChipActive]}
                      activeOpacity={0.8}
                      onPress={() => toggleTag(tag)}>
                      <Text style={filter.tagChipEmoji}>{tagEmoji(tag)}</Text>
                      <Text
                        style={[filter.tagChipText, active && filter.tagChipTextActive]}>
                        {tag}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* ── Sort ───────────────────────────────────────────────────── */}
          <Text style={filter.label}>SORT BY</Text>
          {SORT_OPTIONS.map(opt => {
            const active = draft.sort === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[filter.sortRow, active && filter.sortRowActive]}
                activeOpacity={0.8}
                onPress={() => setDraft(d => ({...d, sort: opt.key}))}>
                <Text style={filter.sortLabel}>{opt.label}</Text>
                <View style={[filter.radio, active && filter.radioActive]}>
                  {active && <Text style={filter.radioCheck}>✓</Text>}
                </View>
              </TouchableOpacity>
            );
          })}

          <View style={filter.scrollPad} />
        </ScrollView>

        <TouchableOpacity
          style={filter.applyBtn}
          activeOpacity={0.85}
          onPress={() => onApply(draft)}>
          <Text style={filter.applyText}>
            Show {count} {count === 1 ? 'place' : 'places'}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const filter = StyleSheet.create({
  backdrop: {flex: 1, backgroundColor: colors.overlay},
  container: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: spacing.md,
    paddingBottom: 34,
    paddingHorizontal: spacing.lg,
    maxHeight: '88%',
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.sandDeep,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  title: {fontFamily: fonts.display, fontSize: 24, color: colors.text},
  reset: {fontFamily: fonts.semibold, fontSize: 15, color: colors.primary},

  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  labelCount: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary,
    marginBottom: 10,
  },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.sand,
    borderRadius: radius.full,
    padding: 5,
    marginBottom: spacing.lg,
  },
  segmentItem: {
    flex: 1,
    borderRadius: radius.full,
    paddingVertical: 11,
    alignItems: 'center',
  },
  segmentItemActive: {backgroundColor: colors.primary},
  segmentText: {fontFamily: fonts.medium, fontSize: 15, color: colors.textSecondary},
  segmentTextActive: {fontFamily: fonts.semibold, color: colors.white},

  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.lg,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.sand,
    borderRadius: radius.full,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  tagChipActive: {backgroundColor: colors.primary},
  tagChipEmoji: {fontSize: 14},
  tagChipText: {fontFamily: fonts.regular, fontSize: 14.5, color: colors.text},
  tagChipTextActive: {fontFamily: fonts.semibold, color: colors.white},

  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 16,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  sortRowActive: {
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primaryLight,
  },
  sortLabel: {fontFamily: fonts.regular, fontSize: 16, color: colors.text},
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.sandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {backgroundColor: colors.primary, borderColor: colors.primary},
  radioCheck: {fontSize: 12, color: colors.white},

  scrollPad: {height: spacing.sm},

  applyBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  applyText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},
});

interface AddPlaceSheetProps {
  spaceId: number;
  existingIds: Set<number>;
  onDismiss: () => void;
  onAdded: (places?: ApiSpacePlace[]) => void;
}

function AddPlaceSheet({spaceId, existingIds, onDismiss, onAdded}: AddPlaceSheetProps) {
  const [myPlaces, setMyPlaces] = useState<ApiSpacePlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<number | null>(null);

  useEffect(() => {
    homeService
      .fetchPlaces()
      .then(data => {
        setMyPlaces(data as unknown as ApiSpacePlace[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const available = myPlaces.filter(p => !existingIds.has(p.id));

  const handleAdd = async (placeId: number) => {
    setAdding(placeId);
    try {
      const updatedPlaces = await spaceDetailService.addPlace(spaceId, placeId);
      onAdded(updatedPlaces);
    } catch {
      // let user retry
    } finally {
      setAdding(null);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onDismiss}>
      <TouchableOpacity style={sheet.backdrop} activeOpacity={1} onPress={onDismiss} />
      <View style={sheet.container}>
        <View style={sheet.handle} />
        <Text style={sheet.title}>Add a Place</Text>
        <Text style={sheet.sub}>Select one of your saved places to add to this space.</Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{marginTop: spacing.lg}} />
        ) : available.length === 0 ? (
          <View style={sheet.empty}>
            <Text style={sheet.emptyEmoji}>📍</Text>
            <Text style={sheet.emptyText}>
              {myPlaces.length === 0
                ? 'You have no saved places yet.'
                : 'All your saved places are already in this space!'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={available}
            keyExtractor={p => String(p.id)}
            showsVerticalScrollIndicator={false}
            renderItem={({item}) => (
              <TouchableOpacity
                style={sheet.row}
                onPress={() => handleAdd(item.id)}
                disabled={adding !== null}
                activeOpacity={0.75}>
                <View style={[sheet.rowIcon, {backgroundColor: categoryTint(item.tags[0] ?? '')}]}>
                  <Text style={sheet.rowEmoji}>{placeEmoji(item.tags)}</Text>
                </View>
                <View style={sheet.rowInfo}>
                  <Text style={sheet.rowName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {!!displayAddress(item.address) && (
                    <Text style={sheet.rowAddr} numberOfLines={1}>
                      {displayAddress(item.address)}
                    </Text>
                  )}
                </View>
                {adding === item.id ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Text style={sheet.rowAdd}>＋</Text>
                )}
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const sheet = StyleSheet.create({
  backdrop: {flex: 1, backgroundColor: colors.overlay},
  container: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: spacing.md,
    paddingBottom: 34,
    paddingHorizontal: spacing.lg,
    maxHeight: '80%',
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.sandDeep,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: {fontFamily: fonts.display, fontSize: 24, color: colors.text},
  sub: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  empty: {alignItems: 'center', paddingVertical: spacing.xl},
  emptyEmoji: {fontSize: 30, marginBottom: 10},
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  rowEmoji: {fontSize: 24},
  rowInfo: {flex: 1},
  rowName: {fontFamily: fonts.semibold, fontSize: 16, color: colors.text},
  rowAddr: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 3,
  },
  rowAdd: {fontSize: 24, color: colors.primary, paddingHorizontal: spacing.sm},
});


// ── Memory place picker ──────────────────────────────────────────────────────

function MemoryPlacePickerModal({
  places,
  activePlaceId,
  memoriesByPlace,
  onClose,
  onSelect,
  onAddMemory,
}: {
  places: ApiSpacePlace[];
  activePlaceId: number | null;
  memoriesByPlace: Record<number, ApiSpaceMemory[]>;
  onClose: () => void;
  onSelect: (place: ApiSpacePlace) => void;
  onAddMemory: (place: ApiSpacePlace) => void;
}) {
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();
  const filteredPlaces = places.filter(place => {
    if (!normalizedQuery) return true;

    const haystack = [place.name, place.address ?? '', place.tags.join(' ')]
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={sheet.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[sheet.container, {maxHeight: '78%'}]}>
        <View style={sheet.handle} />
        <Text style={sheet.title}>Choose a Place</Text>
        <Text style={sheet.sub}>Search once, then open it or add a memory directly.</Text>

        <View style={picker.searchWrap}>
          <Text style={picker.searchIcon}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by place, address, or tag"
            placeholderTextColor={colors.placeholder}
            style={picker.searchInput}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {filteredPlaces.length === 0 ? (
          <View style={picker.empty}>
            <Text style={picker.emptyEmoji}>🔎</Text>
            <Text style={picker.emptyTitle}>No matching place</Text>
            <Text style={picker.emptyText}>Try a different keyword.</Text>
          </View>
        ) : (
          <FlatList
            data={filteredPlaces}
            keyExtractor={place => String(place.id)}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            renderItem={({item}) => {
              const isActive = item.id === activePlaceId;
              const count = (memoriesByPlace[item.id] ?? []).length;

              return (
                <View style={[picker.row, isActive && picker.rowActive]}>
                  <TouchableOpacity
                    style={picker.rowMain}
                    activeOpacity={0.8}
                    onPress={() => onSelect(item)}>
                    <View style={[picker.rowIcon, {backgroundColor: categoryTint(item.tags[0] ?? '')}]}>
                      <Text style={picker.rowEmoji}>{placeEmoji(item.tags)}</Text>
                    </View>

                    <View style={picker.rowInfo}>
                      <View style={picker.rowTitleLine}>
                        <Text style={picker.rowName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        {isActive && <Text style={picker.activeBadge}>Viewing</Text>}
                      </View>

                      {!!displayAddress(item.address) && (
                        <Text style={picker.rowAddr} numberOfLines={1}>
                          {displayAddress(item.address)}
                        </Text>
                      )}

                      <Text style={picker.rowMeta}>
                        {count} {count === 1 ? 'memory' : 'memories'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={picker.addBtn}
                    activeOpacity={0.85}
                    onPress={() => onAddMemory(item)}>
                    <Text style={picker.addBtnText}>＋ Add</Text>
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const picker = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 52,
    marginBottom: spacing.md,
  },
  searchIcon: {fontSize: 17, color: colors.textMuted},
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 0,
  },
  empty: {alignItems: 'center', paddingVertical: spacing.xl},
  emptyEmoji: {fontSize: 30, marginBottom: 10},
  emptyTitle: {fontFamily: fonts.display, fontSize: 18, color: colors.text, marginBottom: 4},
  emptyText: {fontFamily: fonts.regular, fontSize: 14, color: colors.textSecondary},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowActive: {backgroundColor: colors.primaryLight, borderBottomColor: 'transparent'},
  rowIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  rowEmoji: {fontSize: 24},
  rowMain: {flex: 1, flexDirection: 'row', alignItems: 'center'},
  rowInfo: {flex: 1},
  rowTitleLine: {flexDirection: 'row', alignItems: 'center', gap: 8},
  rowName: {fontFamily: fonts.semibold, fontSize: 16, color: colors.text},
  activeBadge: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primaryDeep,
    backgroundColor: colors.blush,
    borderRadius: radius.full,
    paddingVertical: 3,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  rowAddr: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 3,
  },
  rowMeta: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 3,
  },
  addBtn: {
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: 9,
    paddingHorizontal: 18,
    marginLeft: spacing.sm,
  },
  addBtnText: {fontFamily: fonts.semibold, fontSize: 14, color: colors.primary},
});

// ── Members modal ─────────────────────────────────────────────────────────────

function MembersModal({
  members,
  canManage,
  onRemove,
  onClose,
}: {
  members: ApiSpaceMember[];
  /** Only the space owner may remove people, and never themselves. */
  canManage: boolean;
  onRemove: (member: ApiSpaceMember) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={sheet.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[sheet.container, {maxHeight: '60%'}]}>
        <View style={sheet.handle} />
        <Text style={sheet.title}>Members ({members.length})</Text>
        <FlatList
          data={members}
          keyExtractor={m => String(m.user_id)}
          showsVerticalScrollIndicator={false}
          renderItem={({item}) => (
            <View style={mem.row}>
              <View style={[mem.avatar, {backgroundColor: avatarColor(item.name)}]}>
                <Text style={mem.avatarText}>{initials(item.name)}</Text>
              </View>
              <View style={mem.info}>
                <Text style={mem.name}>{item.name}</Text>
              </View>
              <View style={[mem.badge, item.role === 'owner' && mem.badgeOwner]}>
                <Text
                  style={[mem.badgeText, item.role === 'owner' && mem.badgeTextOwner]}>
                  {item.role === 'owner' ? 'Owner' : 'Member'}
                </Text>
              </View>
              {canManage && item.role !== 'owner' && (
                <TouchableOpacity
                  style={mem.removeBtn}
                  hitSlop={10}
                  activeOpacity={0.7}
                  onPress={() => onRemove(item)}>
                  <Text style={mem.removeIcon}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

const mem = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: {fontFamily: fonts.semibold, fontSize: 16, color: colors.white},
  info: {flex: 1},
  name: {fontFamily: fonts.regular, fontSize: 16.5, color: colors.text},
  badge: {
    borderRadius: radius.full,
    backgroundColor: colors.sand,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  badgeOwner: {backgroundColor: colors.blush},
  badgeText: {fontFamily: fonts.semibold, fontSize: 13, color: colors.textSecondary},
  badgeTextOwner: {color: colors.primaryDeep},
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    backgroundColor: colors.sand,
  },
  removeIcon: {fontSize: 15, color: colors.error},
});


// ── Edit space sheet ──────────────────────────────────────────────────────────

const EDIT_EMOJIS = [
  '🌍', '🎯', '✨', '🔥', '💫', '🌟', '🎉', '💎', '🚀', '⚡',
  '🍕', '🍣', '🍜', '🥗', '🥩', '🍔', '🌮', '🍱', '🥐', '☕',
  '🏔️', '🌊', '🌸', '🌿', '🏝️', '🌅', '🌴', '🌳', '🌵', '🏕️',
  '🎨', '🎭', '🎬', '🎵', '🎮', '🏋️', '⚽', '🎸', '🎪', '🗺️',
];

interface EditSpaceSheetProps {
  spaceId: number;
  name: string;
  icon: string;
  bannerUrl: string | null;
  onDismiss: () => void;
  onSaved: (next: {name: string; icon: string; bannerUrl: string | null}) => void;
}

function EditSpaceSheet({
  spaceId,
  name: initialName,
  icon: initialIcon,
  bannerUrl,
  onDismiss,
  onSaved,
}: EditSpaceSheetProps) {
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState(initialIcon);
  // Only set when the user picks a NEW banner — leaving it null keeps the old one.
  const [newBanner, setNewBanner] = useState<{uri: string; mime: string} | null>(null);
  const [saving, setSaving] = useState(false);

  const pickBanner = async () => {
    const picked = await pickImage('gallery');
    if (picked) setNewBanner({uri: picked.uri, mime: picked.type});
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Give the space a name.');
      return;
    }
    setSaving(true);
    try {
      let bannerKey: string | undefined;
      if (newBanner) {
        const presigned = await memoryService.presign('space_banner');
        await memoryService.uploadToR2(presigned.presign_url, newBanner.uri, newBanner.mime);
        bannerKey = presigned.key;
      }
      const updated = await spaceService.update(spaceId, trimmed, icon, bannerKey);
      onSaved({name: updated.name, icon: updated.icon, bannerUrl: updated.banner_url});
    } catch (err: any) {
      Alert.alert(
        'Error',
        err?.response?.data?.error ?? err?.message ?? 'Could not save the space.',
      );
    } finally {
      setSaving(false);
    }
  };

  const previewUri = newBanner?.uri ?? bannerUrl;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onDismiss}>
      <TouchableOpacity style={sheet.backdrop} activeOpacity={1} onPress={onDismiss} />
      <View style={sheet.container}>
        <View style={sheet.handle} />
        <Text style={sheet.title}>Edit Space</Text>
        <Text style={sheet.sub}>Change the name, icon or banner photo.</Text>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={ed.banner} activeOpacity={0.85} onPress={pickBanner}>
            {previewUri ? (
              <>
                <Image source={{uri: previewUri}} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                <View style={ed.bannerOverlay} />
              </>
            ) : null}
            <Text style={ed.bannerHint}>
              {previewUri ? '📷  Tap to change photo' : '🖼️  Add a banner photo'}
            </Text>
          </TouchableOpacity>

          <Text style={ed.label}>SPACE NAME</Text>
          <TextInput
            style={ed.input}
            value={name}
            onChangeText={setName}
            maxLength={60}
            placeholder="Space name"
            placeholderTextColor={colors.placeholder}
            returnKeyType="done"
          />

          <Text style={ed.label}>ICON</Text>
          <View style={ed.emojiWrap}>
            {EDIT_EMOJIS.map(e => (
              <TouchableOpacity
                key={e}
                style={[ed.emojiItem, e === icon && ed.emojiItemActive]}
                activeOpacity={0.7}
                onPress={() => setIcon(e)}>
                <Text style={ed.emojiText}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <TouchableOpacity
          style={[ed.saveBtn, saving && {opacity: 0.6}]}
          activeOpacity={0.85}
          disabled={saving}
          onPress={save}>
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={ed.saveText}>Save Changes</Text>
          )}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const ed = StyleSheet.create({
  banner: {
    height: 150,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.sandDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(45,42,36,0.35)',
  },
  bannerHint: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.text,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: radius.full,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    overflow: 'hidden',
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  input: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.md,
  },
  emojiWrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md},
  emojiItem: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  emojiItemActive: {backgroundColor: colors.primary + '22', borderColor: colors.primary},
  emojiText: {fontSize: 21},
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  saveText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},
});

// ── Main screen ───────────────────────────────────────────────────────────────



export default function SpaceScreen({route, navigation}: Props) {
  const {spaceId} = route.params;
  const insets = useSafeAreaInsets();
  const {user} = useAuth();

  // Header content is editable, so it lives in state seeded from the route params.
  const [spaceName, setSpaceName] = useState(route.params.spaceName);
  const [spaceIcon, setSpaceIcon] = useState(route.params.spaceIcon);
  const [bannerUrl, setBannerUrl] = useState(route.params.bannerUrl);
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [showEdit, setShowEdit] = useState(false);

  const [places, setPlaces] = useState<ApiSpacePlace[]>([]);
  const [members, setMembers] = useState<ApiSpaceMember[]>([]);
  const [memories, setMemories] = useState<ApiSpaceMemory[]>([]);
  const [spaceRecs, setSpaceRecs] = useState<ApiRecommendation[]>([]);
  const [loading, setLoading] = useState(true);

  const [showMembers, setShowMembers] = useState(false);
  const {origin} = useLocation();
  const [showAllPlaces, setShowAllPlaces] = useState(false);
  const [filters, setFilters] = useState<PlaceFilters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [showMemoryPlacePicker, setShowMemoryPlacePicker] = useState(false);

  // Memory upload — which place is currently being added to
  const [memoryTargetPlace, setMemoryTargetPlace] = useState<ApiSpacePlace | null>(null);

  // Memories view — which place is currently selected
  const [memTabPlaceId, setMemTabPlaceId] = useState<number | null>(null);

  const fabScale = useRef(new Animated.Value(1)).current;

  const load = useCallback(async () => {
    setLoading(true);
    const [spaceResult, placesResult, membersResult, memoriesResult, recsResult] = await Promise.allSettled([
      spaceDetailService.getSpace(spaceId),
      spaceDetailService.getPlaces(spaceId),
      spaceDetailService.getMembers(spaceId),
      spaceDetailService.getMemories(spaceId),
      recommendationService.getForSpace(spaceId),
    ]);

    if (spaceResult.status === 'fulfilled') {
      setSpaceName(spaceResult.value.name);
      setSpaceIcon(spaceResult.value.icon);
      setBannerUrl(spaceResult.value.banner_url);
      setOwnerId(spaceResult.value.owner_id);
    }
    if (placesResult.status === 'fulfilled') {
      setPlaces(placesResult.value);
    }
    if (membersResult.status === 'fulfilled') {
      setMembers(membersResult.value);
    }
    if (memoriesResult.status === 'fulfilled') {
      setMemories(memoriesResult.value);
    }
    if (recsResult.status === 'fulfilled') {
      setSpaceRecs(recsResult.value);
    }

    setLoading(false);
  }, [spaceId]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  // Toggle visited — optimistic update so the UI reacts instantly
  const toggleVisited = useCallback(async (placeId: number) => {
    const target = places.find(p => p.id === placeId);
    if (!target) return;
    const newVisited = !target.visited;

    // Optimistic: update local state immediately
    setPlaces(prev =>
      prev.map(p => (p.id === placeId ? {...p, visited: newVisited} : p)),
    );

    try {
      await placeService.setVisited(placeId, newVisited);
    } catch {
      // Revert on failure
      setPlaces(prev =>
        prev.map(p => (p.id === placeId ? {...p, visited: !newVisited} : p)),
      );
      Alert.alert('Error', 'Could not update visited status.');
    }
  }, [places]);

  const isOwner = ownerId != null && user?.id === ownerId;

  const removePlace = useCallback(
    (place: ApiSpacePlace) => {
      Alert.alert(
        'Remove place',
        `Remove "${place.name}" from this space? The place itself is kept.`,
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              const snapshot = places;
              setPlaces(prev => prev.filter(p => p.id !== place.id));
              try {
                await spaceDetailService.removePlace(spaceId, place.id);
              } catch {
                setPlaces(snapshot);
                Alert.alert('Error', 'Could not remove that place.');
              }
            },
          },
        ],
      );
    },
    [places, spaceId],
  );

  // Long-press is the only spare gesture on a place row, so it opens a menu
  // rather than firing one action.
  const openPlaceActions = useCallback(
    (place: ApiSpacePlace) => {
      Alert.alert(place.name, undefined, [
        {
          text: place.visited ? 'Mark as unvisited' : 'Mark as visited',
          onPress: () => toggleVisited(place.id),
        },
        {text: 'Remove from space', style: 'destructive', onPress: () => removePlace(place)},
        {text: 'Cancel', style: 'cancel'},
      ]);
    },
    [toggleVisited, removePlace],
  );

  const removeMember = useCallback(
    (member: ApiSpaceMember) => {
      Alert.alert('Remove member', `Remove ${member.name} from this space?`, [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const snapshot = members;
            setMembers(prev => prev.filter(m => m.user_id !== member.user_id));
            try {
              await spaceDetailService.removeMember(spaceId, member.user_id);
            } catch {
              setMembers(snapshot);
              Alert.alert('Error', 'Could not remove that member.');
            }
          },
        },
      ]);
    },
    [members, spaceId],
  );

  // Sort places by distance — the memories section always sees the full list.
  const sortedPlaces = [...places].sort((a, b) => {
    const da = haversineKm(origin.lat, origin.lng, a.lat, a.lng);
    const db = haversineKm(origin.lat, origin.lng, b.lat, b.lng);
    return da - db;
  });

  const applyFilters = useCallback(
    (f: PlaceFilters): ApiSpacePlace[] => {
      const matched = places.filter(p => {
        if (f.status === 'unvisited' && p.visited) return false;
        if (f.status === 'visited' && !p.visited) return false;
        if (f.tags.length > 0 && !f.tags.some(t => p.tags.includes(t))) return false;
        return true;
      });

      return matched.sort((a, b) => {
        if (f.sort === 'name') return a.name.localeCompare(b.name);
        // Higher ids were added later — no created_at on the payload.
        if (f.sort === 'recent') return b.id - a.id;
        return (
          haversineKm(origin.lat, origin.lng, a.lat, a.lng) -
          haversineKm(origin.lat, origin.lng, b.lat, b.lng)
        );
      });
    },
    [places, origin],
  );

  const filteredPlaces = applyFilters(filters);
  const topPlaces = showAllPlaces ? filteredPlaces : filteredPlaces.slice(0, 3);
  const filterCount = activeFilterCount(filters);

  // Tags present on this space's places — filtering by an absent tag is useless.
  const availableTags = Array.from(new Set(places.flatMap(p => p.tags))).sort();

  // Build memory map keyed by place_id
  const memoriesByPlace: Record<number, ApiSpaceMemory[]> = {};
  for (const m of memories) {
    if (!memoriesByPlace[m.place_id]) memoriesByPlace[m.place_id] = [];
    memoriesByPlace[m.place_id].push(m);
  }

  // Keep the selected memory place valid as the space changes.
  useEffect(() => {
    if (sortedPlaces.length === 0) {
      if (memTabPlaceId !== null) setMemTabPlaceId(null);
      return;
    }

    if (!sortedPlaces.some(place => place.id === memTabPlaceId)) {
      setMemTabPlaceId(sortedPlaces[0].id);
    }
  }, [sortedPlaces, memTabPlaceId]);

  const activeMemPlace = sortedPlaces.find(p => p.id === memTabPlaceId) ?? sortedPlaces[0] ?? null;
  const activeMemories = activeMemPlace ? (memoriesByPlace[activeMemPlace.id] ?? []) : [];
  const activeMemDistance = activeMemPlace
    ? haversineKm(origin.lat, origin.lng, activeMemPlace.lat, activeMemPlace.lng)
    : null;
  const quickMemoryPlaces = buildQuickMemoryPlaces(sortedPlaces, activeMemPlace?.id ?? null);

  const pressFab = () => {
    Animated.sequence([
      Animated.timing(fabScale, {toValue: 0.88, duration: 80, useNativeDriver: true}),
      Animated.spring(fabScale, {toValue: 1, friction: 4, useNativeDriver: true}),
    ]).start();
    // Collect unique tags already used in this space to offer as suggestions
    const spaceTags = Array.from(new Set(places.flatMap(p => p.tags)));
    navigation.navigate('CreatePlace', {spaceId, spaceTags});
  };

  const ACCENT_COLORS = [colors.sage, colors.primary, colors.primaryDeep, colors.catDeli];
  const accentColor = ACCENT_COLORS[spaceId % ACCENT_COLORS.length];

  return (
    <View style={s.root}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[s.headerWrap, {paddingTop: insets.top}]}>
        {bannerUrl ? (
          /* Banner photo: fill behind + single readable overlay */
          <>
            <Image source={{uri: bannerUrl}} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
            <View style={s.bannerOverlay} />
          </>
        ) : (
          /* Solid accent: NO overlay — just a clean single colour */
          <View style={[StyleSheet.absoluteFillObject, {backgroundColor: accentColor}]} />
        )}

        {/* Top bar: back button */}
        <View style={s.headerBar}>
          <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} hitSlop={12}>
            <Text style={s.backIcon}>‹</Text>
          </TouchableOpacity>
          {isOwner && (
            <TouchableOpacity style={s.editBtn} onPress={() => setShowEdit(true)} hitSlop={12}>
              <Text style={s.editBtnText}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Icon + title row */}
        <View style={s.headerMeta}>
          <View style={[s.iconCircle, {backgroundColor: bannerUrl ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.2)'}]}>
            <Text style={s.iconEmoji}>{spaceIcon}</Text>
          </View>
          <View style={s.headerTitleBlock}>
            <Text style={s.headerName} numberOfLines={1}>{spaceName}</Text>
            {!loading && (
              <TouchableOpacity
                style={s.metaRow}
                onPress={() => setShowMembers(true)}
                activeOpacity={0.75}>
                {members.slice(0, 3).map((m, i) => (
                  <View
                    key={m.user_id}
                    style={[s.metaAvatar, {backgroundColor: avatarColor(m.name), marginLeft: i === 0 ? 0 : -6}]}>
                    <Text style={s.metaAvatarText}>{initials(m.name)}</Text>
                  </View>
                ))}
                <Text style={s.metaText}>
                  {members.length} member{members.length !== 1 ? 's' : ''}
                </Text>
                <Text style={s.metaChevron}>›</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <ScrollView
        style={s.body}
        contentContainerStyle={s.bodyContent}
        showsVerticalScrollIndicator={false}>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{marginTop: spacing.xl}} />
        ) : (
          <>
            {/* ── Nearest Places ──────────────────────────────────────── */}
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>NEAREST PLACES</Text>
              {filteredPlaces.length > 3 && (
                <TouchableOpacity
                  onPress={() => setShowAllPlaces(v => !v)}
                  hitSlop={8}>
                  <Text style={s.sectionLink}>
                    {showAllPlaces ? 'Show less' : `See all ${filteredPlaces.length}`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {places.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={s.filterRow}
                contentContainerStyle={s.filterRowContent}>
                <TouchableOpacity
                  style={s.filterBtn}
                  activeOpacity={0.85}
                  onPress={() => setShowFilters(true)}>
                  <Text style={s.filterBtnIcon}>≡</Text>
                  <Text style={s.filterBtnText}>Filters</Text>
                  {filterCount > 0 && (
                    <View style={s.filterBadge}>
                      <Text style={s.filterBadgeText}>{filterCount}</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {STATUS_OPTIONS.map(opt => {
                  const active = filters.status === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[s.filterChip, active && s.filterChipActive]}
                      activeOpacity={0.8}
                      onPress={() => setFilters(f => ({...f, status: opt.key}))}>
                      <Text style={[s.filterChipText, active && s.filterChipTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {availableTags.map(tag => {
                  const active = filters.tags.includes(tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      style={[s.filterChip, active && s.filterChipActive]}
                      activeOpacity={0.8}
                      onPress={() =>
                        setFilters(f => ({
                          ...f,
                          tags: active
                            ? f.tags.filter(t => t !== tag)
                            : [...f.tags, tag],
                        }))
                      }>
                      <Text style={s.filterChipEmoji}>{tagEmoji(tag)}</Text>
                      <Text style={[s.filterChipText, active && s.filterChipTextActive]}>
                        {tag}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {places.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyEmoji}>📍</Text>
                <Text style={s.emptyTitle}>No places yet</Text>
                <Text style={s.emptySub}>
                  Tap ＋ to add your first saved place to this space.
                </Text>
              </View>
            ) : filteredPlaces.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyEmoji}>🔎</Text>
                <Text style={s.emptyTitle}>No places match</Text>
                <Text style={s.emptySub}>
                  Try clearing a filter to see more of this space.
                </Text>
                <TouchableOpacity
                  style={s.emptyResetBtn}
                  activeOpacity={0.8}
                  onPress={() => setFilters(DEFAULT_FILTERS)}>
                  <Text style={s.emptyResetText}>Reset filters</Text>
                </TouchableOpacity>
              </View>
            ) : (
              topPlaces.map(place => {
                const distKm = haversineKm(origin.lat, origin.lng, place.lat, place.lng);
                const emoji = placeEmoji(place.tags);
                return (
                  <TouchableOpacity
                    key={place.id}
                    style={[s.placeRow, place.visited && s.placeRowVisited]}
                    activeOpacity={0.75}
                    onPress={() =>
                      navigation.navigate('PlaceDetail', {
                        placeId: place.id,
                        placeName: place.name,
                        fromSpaceId: spaceId,
                      })
                    }
                    onLongPress={() => openPlaceActions(place)}
                    delayLongPress={400}>
                    <View style={[s.placeIconWrap, {backgroundColor: categoryTint(place.tags[0] ?? '')}]}>
                      <Text style={s.placeEmoji}>{emoji}</Text>
                      {place.visited && (
                        <View style={s.visitedBadge}>
                          <Text style={s.visitedCheck}>✓</Text>
                        </View>
                      )}
                    </View>
                    <View style={s.placeInfo}>
                      <Text
                        style={[s.placeName, place.visited && s.placeNameVisited]}
                        numberOfLines={1}>
                        {place.name}
                      </Text>
                      {!!displayAddress(place.address) && (
                        <Text style={s.placeAddr} numberOfLines={1}>
                          {displayAddress(place.address)}
                        </Text>
                      )}
                      {place.tags.length > 0 && (
                        <View style={s.tagRow}>
                          {place.tags.slice(0, 2).map(t => (
                            <View key={t} style={s.tag}>
                              <Text style={s.tagText}>{t}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                    {place.visited ? (
                      <View style={s.visitedPill}>
                        <Text style={s.visitedPillText}>Visited</Text>
                      </View>
                    ) : (
                      <View style={s.distPill}>
                        <Text style={s.distText}>{fmtDistance(distKm)}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}

            {/* ── Memories ────────────────────────────────────────────── */}
            <View style={[s.sectionHeader, {marginTop: spacing.lg}]}>
              <Text style={s.sectionTitle}>MEMORIES</Text>
              {places.length > 0 && (
                <View style={s.memHeaderActions}>
                  <TouchableOpacity
                    style={s.memPickerBtn}
                    activeOpacity={0.8}
                    onPress={() => setShowMemoryPlacePicker(true)}>
                    <Text style={s.memPickerBtnText}>Choose place</Text>
                  </TouchableOpacity>
                  {activeMemPlace && (
                    <TouchableOpacity
                      style={s.memAddBtn}
                      activeOpacity={0.8}
                      onPress={() => setMemoryTargetPlace(activeMemPlace)}>
                      <Text style={s.memAddBtnText}>＋ Memory</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {places.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyEmoji}>📷</Text>
                <Text style={s.emptyTitle}>No places yet</Text>
                <Text style={s.emptySub}>
                  Add places to this space first, then capture memories for each one.
                </Text>
              </View>
            ) : (
              <View style={s.memBlock}>
                {activeMemPlace && (
                  <>
                    <View style={s.memFocusCard}>
                      <View
                        style={[
                          s.memFocusIconWrap,
                          {backgroundColor: categoryTint(activeMemPlace.tags[0] ?? '')},
                        ]}>
                        <Text style={s.memFocusEmoji}>{placeEmoji(activeMemPlace.tags)}</Text>
                      </View>

                      <View style={s.memFocusInfo}>
                        <Text style={s.memFocusLabel}>Selected place</Text>
                        <Text style={s.memFocusName}>{activeMemPlace.name}</Text>
                        {!!displayAddress(activeMemPlace.address) && (
                          <Text style={s.memFocusAddr} numberOfLines={1}>
                            {displayAddress(activeMemPlace.address)}
                          </Text>
                        )}
                        <View style={s.memFocusMetaRow}>
                          <View style={s.memFocusMetaPill}>
                            <Text style={s.memFocusMetaText}>
                              {activeMemories.length}{' '}
                              {activeMemories.length === 1 ? 'memory' : 'memories'}
                            </Text>
                          </View>
                          {activeMemDistance !== null && (
                            <View style={s.memFocusMetaPill}>
                              <Text style={s.memFocusMetaText}>{fmtDistance(activeMemDistance)}</Text>
                            </View>
                          )}
                        </View>
                      </View>

                      <TouchableOpacity
                        style={s.memSwapBtn}
                        activeOpacity={0.8}
                        onPress={() => setShowMemoryPlacePicker(true)}>
                        <Text style={s.memSwapBtnText}>Change</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={s.memQuickList}>
                      {quickMemoryPlaces.map(place => {
                        const active = place.id === activeMemPlace.id;
                        const count = (memoriesByPlace[place.id] ?? []).length;

                        return (
                          <TouchableOpacity
                            key={place.id}
                            style={[s.memQuickCard, active && s.memQuickCardActive]}
                            activeOpacity={0.85}
                            onPress={() => setMemTabPlaceId(place.id)}>
                            <View style={s.memQuickTopRow}>
                              <Text style={s.memQuickEmoji}>{placeEmoji(place.tags)}</Text>
                              <Text style={[s.memQuickCount, active && s.memQuickCountActive]}>
                                {count}
                              </Text>
                            </View>
                            <Text
                              style={[s.memQuickName, active && s.memQuickNameActive]}
                              numberOfLines={1}>
                              {place.name}
                            </Text>
                            <Text
                              style={[s.memQuickHint, active && s.memQuickHintActive]}
                              numberOfLines={1}>
                              {active ? 'Currently open' : 'Tap to switch'}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}

                      {sortedPlaces.length > quickMemoryPlaces.length && (
                        <TouchableOpacity
                          style={s.memBrowseCard}
                          activeOpacity={0.85}
                          onPress={() => setShowMemoryPlacePicker(true)}>
                          <Text style={s.memBrowseIcon}>⌕</Text>
                          <Text style={s.memBrowseTitle}>Browse all places</Text>
                          <Text style={s.memBrowseHint}>{sortedPlaces.length} places in this space</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </>
                )}

                {/* Photo strip for the active place */}
                {activeMemories.length === 0 ? (
                  <TouchableOpacity
                    style={s.memEmptyPrompt}
                    activeOpacity={0.7}
                    onPress={() => activeMemPlace && setMemoryTargetPlace(activeMemPlace)}>
                    <Text style={s.memEmptyIcon}>＋</Text>
                    <Text style={s.memEmptyText}>
                      Add the first memory for {activeMemPlace?.name}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={s.memStrip}>
                    {/* Add card at start */}
                    <TouchableOpacity
                      style={s.memAddCard}
                      activeOpacity={0.75}
                      onPress={() => activeMemPlace && setMemoryTargetPlace(activeMemPlace)}>
                      <Text style={s.memAddCardIcon}>＋</Text>
                      <Text style={s.memAddCardText}>Add</Text>
                    </TouchableOpacity>

                    {activeMemories.map(memory => (
                      <View key={memory.id} style={s.memCard}>
                        <Image
                          source={{uri: memory.image_url}}
                          style={s.memImage}
                          resizeMode="cover"
                        />
                        {memory.caption && (
                          <View style={s.memCaptionWrap}>
                            <Text style={s.memCaption} numberOfLines={2}>
                              {memory.caption}
                            </Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>
            )}

            {/* ── Members strip ───────────────────────────────────────── */}
            {members.length > 0 && (
              <>
                <View style={[s.sectionHeader, {marginTop: spacing.lg}]}>
                  <Text style={s.sectionTitle}>MEMBERS</Text>
                  <TouchableOpacity onPress={() => setShowMembers(true)} hitSlop={8}>
                    <Text style={s.sectionLink}>See all</Text>
                  </TouchableOpacity>
                </View>

                <View style={s.membersStrip}>
                  {members.slice(0, 6).map((m, idx) => (
                    <TouchableOpacity
                      key={m.user_id}
                      style={[s.memberChip, {marginLeft: idx === 0 ? 0 : -10}]}
                      onPress={() => setShowMembers(true)}
                      activeOpacity={0.8}>
                      <View
                        style={[
                          s.memberAvatar,
                          {backgroundColor: avatarColor(m.name)},
                        ]}>
                        <Text style={s.memberAvatarText}>{initials(m.name)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                  {members.length > 6 && (
                    <View style={[s.memberChip, s.memberOverflow, {marginLeft: -10}]}>
                      <Text style={s.memberOverflowText}>+{members.length - 6}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={s.membersLabel}
                    onPress={() => setShowMembers(true)}
                    activeOpacity={0.7}>
                    <Text style={s.membersLabelText}>
                      {members.length} {members.length === 1 ? 'member' : 'members'}  ›
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        )}

        {/* ── Suggestions for this Space ────────────────────────── */}
        {spaceRecs.length > 0 && (
          <View style={s.suggestionsSection}>
            <View style={s.suggestionHeader}>
              <Text style={s.suggestionTitle}>SUGGESTED NEARBY</Text>
              <Text style={s.suggestionSub}>Places near this space you haven't added yet</Text>
            </View>
            {spaceRecs.map((rec, idx) => (
              <View key={rec.google_place_id || idx} style={s.suggestionRow}>
                <View style={s.suggestionLeft}>
                  <View style={s.suggestionEmoji}>
                    <Text style={s.suggestionEmojiText}>{rec.emoji}</Text>
                  </View>
                  <View style={s.suggestionInfo}>
                    <Text style={s.suggestionName} numberOfLines={1}>{rec.name}</Text>
                    <Text style={s.suggestionAddress} numberOfLines={1}>{rec.address}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={s.suggestionSaveBtn}
                  activeOpacity={0.8}
                  onPress={() =>
                    navigation.navigate('CreatePlace', {
                      spaceId,
                      prefillName: rec.name,
                      prefillAddress: rec.address,
                      prefillLat: rec.lat,
                      prefillLng: rec.lng,
                    })
                  }>
                  <Text style={s.suggestionSaveBtnText}>+ Save</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={{height: 100}} />
      </ScrollView>

      {/* ── FAB — Add Place ─────────────────────────────────────────────── */}
      <Animated.View
        style={[
          s.fab,
          {bottom: insets.bottom + 24, transform: [{scale: fabScale}]},
        ]}>
        <TouchableOpacity style={s.fabInner} onPress={pressFab} activeOpacity={1}>
          <Text style={s.fabIcon}>＋</Text>
          <Text style={s.fabLabel}>Add Place</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ── Sheets / Modals ─────────────────────────────────────────────── */}
      {showFilters && (
        <FilterPlacesSheet
          filters={filters}
          availableTags={availableTags}
          resultCount={f => applyFilters(f).length}
          onApply={next => {
            setFilters(next);
            setShowAllPlaces(false);
            setShowFilters(false);
          }}
          onClose={() => setShowFilters(false)}
        />
      )}

      {showEdit && (
        <EditSpaceSheet
          spaceId={spaceId}
          name={spaceName}
          icon={spaceIcon}
          bannerUrl={bannerUrl}
          onDismiss={() => setShowEdit(false)}
          onSaved={next => {
            setSpaceName(next.name);
            setSpaceIcon(next.icon);
            setBannerUrl(next.bannerUrl);
            setShowEdit(false);
          }}
        />
      )}

      {showMembers && (
        <MembersModal
          members={members}
          canManage={isOwner}
          onRemove={removeMember}
          onClose={() => setShowMembers(false)}
        />
      )}

      {showMemoryPlacePicker && (
        <MemoryPlacePickerModal
          places={sortedPlaces}
          activePlaceId={activeMemPlace?.id ?? null}
          memoriesByPlace={memoriesByPlace}
          onClose={() => setShowMemoryPlacePicker(false)}
          onSelect={place => {
            setMemTabPlaceId(place.id);
            setShowMemoryPlacePicker(false);
          }}
          onAddMemory={place => {
            setMemTabPlaceId(place.id);
            setShowMemoryPlacePicker(false);
            setMemoryTargetPlace(place);
          }}
        />
      )}

      {memoryTargetPlace && (
        <MemoryUploadModal
          place={memoryTargetPlace}
          spaceId={spaceId}
          onDismiss={() => setMemoryTargetPlace(null)}
          onUploaded={() => {
            setMemoryTargetPlace(null);
            load(); // refresh memories
          }}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},

  // ── Header ──────────────────────────────────────────────────────────────
  headerWrap: {paddingBottom: spacing.lg, overflow: 'hidden'},
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(45,42,36,0.42)',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(45,42,36,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {fontSize: 26, color: colors.white, lineHeight: 28},

  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  iconCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmoji: {fontSize: 28},
  headerTitleBlock: {flex: 1},
  headerName: {fontFamily: fonts.display, fontSize: 25, color: colors.white},
  metaRow: {flexDirection: 'row', alignItems: 'center', marginTop: 8},
  metaAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  metaAvatarText: {fontFamily: fonts.semibold, fontSize: 9, color: colors.white},
  metaText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.white,
    marginLeft: spacing.sm,
  },
  metaChevron: {fontSize: 18, color: 'rgba(255,255,255,0.75)', marginLeft: 6},

  editBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  editBtnText: {fontFamily: fonts.semibold, fontSize: 14, color: colors.white},

  // ── Body ────────────────────────────────────────────────────────────────
  body: {flex: 1, backgroundColor: colors.background},
  bodyContent: {paddingHorizontal: spacing.lg, paddingTop: spacing.lg},

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 12.5,
    letterSpacing: 1.3,
    color: colors.textSecondary,
  },
  sectionLink: {fontFamily: fonts.semibold, fontSize: 14, color: colors.primary},

  emptyCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  emptyEmoji: {fontSize: 30, marginBottom: 10},
  emptyResetBtn: {
    marginTop: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  emptyResetText: {fontFamily: fonts.semibold, fontSize: 15, color: colors.primary},

  // ── Filter chip row ─────────────────────────────────────────────────────
  filterRow: {marginBottom: spacing.md, marginHorizontal: -spacing.lg},
  filterRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.lg,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.headerBg,
    borderRadius: radius.full,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  filterBtnIcon: {fontSize: 15, color: colors.white},
  filterBtnText: {fontFamily: fonts.semibold, fontSize: 14.5, color: colors.white},
  filterBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {fontFamily: fonts.semibold, fontSize: 12, color: colors.white},
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.sand,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  filterChipActive: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
  },
  filterChipEmoji: {fontSize: 14},
  filterChipText: {fontFamily: fonts.medium, fontSize: 14.5, color: colors.textSecondary},
  filterChipTextActive: {fontFamily: fonts.semibold, color: colors.primary},
  emptyTitle: {fontFamily: fonts.display, fontSize: 18, color: colors.text, marginBottom: 6},
  emptySub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // ── Place rows ──────────────────────────────────────────────────────────
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  placeRowVisited: {opacity: 0.72},
  placeIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  placeEmoji: {fontSize: 24},
  visitedBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.sage,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitedCheck: {fontSize: 9, color: colors.white},
  placeInfo: {flex: 1},
  placeName: {fontFamily: fonts.semibold, fontSize: 16, color: colors.text},
  placeNameVisited: {
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  placeAddr: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 3,
  },
  tagRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8},
  tag: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  tagText: {fontFamily: fonts.regular, fontSize: 13, color: colors.primaryDeep},

  visitedPill: {
    backgroundColor: colors.sageSoft,
    borderRadius: radius.full,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginLeft: spacing.sm,
  },
  visitedPillText: {fontFamily: fonts.medium, fontSize: 13, color: colors.sage},
  distPill: {
    backgroundColor: colors.sand,
    borderRadius: radius.full,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginLeft: spacing.sm,
  },
  distText: {fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary},

  // ── Memories ────────────────────────────────────────────────────────────
  memHeaderActions: {flexDirection: 'row', alignItems: 'center', gap: 10},
  memPickerBtn: {
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  memPickerBtnText: {fontFamily: fonts.medium, fontSize: 14, color: colors.text},
  memAddBtn: {
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  memAddBtnText: {fontFamily: fonts.semibold, fontSize: 14, color: colors.white},

  memBlock: {},
  memFocusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  memFocusIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memFocusEmoji: {fontSize: 22},
  memFocusInfo: {flex: 1},
  memFocusLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11.5,
    letterSpacing: 1.2,
    color: colors.textMuted,
    marginBottom: 3,
  },
  memFocusName: {fontFamily: fonts.display, fontSize: 18, color: colors.text},
  memFocusAddr: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    color: colors.textSecondary,
    marginTop: 3,
  },
  memFocusMetaRow: {flexDirection: 'row', gap: 6, marginTop: 8},
  memFocusMetaPill: {
    backgroundColor: colors.sand,
    borderRadius: radius.full,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  memFocusMetaText: {fontFamily: fonts.regular, fontSize: 12.5, color: colors.textSecondary},
  memSwapBtn: {
    borderRadius: radius.full,
    backgroundColor: colors.sand,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  memSwapBtnText: {fontFamily: fonts.medium, fontSize: 14, color: colors.text},

  memQuickList: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md},
  memQuickCard: {
    width: '47.5%',
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 12,
  },
  memQuickCardActive: {
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primaryLight,
  },
  memQuickTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  memQuickEmoji: {fontSize: 20},
  memQuickCount: {fontFamily: fonts.semibold, fontSize: 14, color: colors.textSecondary},
  memQuickCountActive: {color: colors.primaryDeep},
  memQuickName: {fontFamily: fonts.semibold, fontSize: 14.5, color: colors.text},
  memQuickNameActive: {color: colors.primaryDeep},
  memQuickHint: {fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, marginTop: 3},
  memQuickHintActive: {color: colors.primary},

  memBrowseCard: {
    width: '47.5%',
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.sandDeep,
    padding: 12,
    justifyContent: 'center',
  },
  memBrowseIcon: {fontSize: 18, color: colors.textMuted, marginBottom: 6},
  memBrowseTitle: {fontFamily: fonts.semibold, fontSize: 14.5, color: colors.text},
  memBrowseHint: {fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, marginTop: 3},

  memEmptyPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  memEmptyIcon: {fontSize: 18, color: colors.primary},
  memEmptyText: {fontFamily: fonts.semibold, fontSize: 15, color: colors.primary},

  memStrip: {gap: spacing.md, paddingRight: spacing.lg},
  memAddCard: {
    width: 150,
    height: 150,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memAddCardIcon: {fontSize: 24, color: colors.primary},
  memAddCardText: {fontFamily: fonts.semibold, fontSize: 14, color: colors.primary, marginTop: 4},
  memCard: {width: 150},
  memImage: {
    width: 150,
    height: 150,
    borderRadius: radius.lg,
    backgroundColor: colors.sand,
  },
  memCaptionWrap: {marginTop: 8},
  memCaption: {fontFamily: fonts.regular, fontSize: 13, color: colors.textSecondary},

  // ── Members ─────────────────────────────────────────────────────────────
  membersStrip: {flexDirection: 'row', alignItems: 'center'},
  memberChip: {},
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  memberAvatarText: {fontFamily: fonts.semibold, fontSize: 13, color: colors.white},
  memberOverflow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  memberOverflowText: {fontFamily: fonts.semibold, fontSize: 12, color: colors.textSecondary},
  membersLabel: {marginLeft: spacing.md},
  membersLabelText: {fontFamily: fonts.regular, fontSize: 15, color: colors.text},

  // ── FAB ─────────────────────────────────────────────────────────────────
  fab: {position: 'absolute', right: spacing.lg},
  fabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 16,
    paddingHorizontal: 24,
    ...shadows.primaryGlow,
  },
  fabIcon: {fontSize: 17, color: colors.white},
  fabLabel: {fontFamily: fonts.display, fontSize: 16, color: colors.white},

  // ── Suggestions ─────────────────────────────────────────────────────────
  suggestionsSection: {marginTop: spacing.xl},
  suggestionHeader: {marginBottom: spacing.md},
  suggestionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 12.5,
    letterSpacing: 1.3,
    color: colors.textSecondary,
  },
  suggestionSub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  suggestionLeft: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  suggestionEmoji: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionEmojiText: {fontSize: 22},
  suggestionInfo: {flex: 1},
  suggestionName: {fontFamily: fonts.semibold, fontSize: 16, color: colors.text},
  suggestionAddress: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 3,
  },
  suggestionSaveBtn: {
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: 9,
    paddingHorizontal: 16,
    marginLeft: spacing.sm,
  },
  suggestionSaveBtnText: {fontFamily: fonts.semibold, fontSize: 14, color: colors.primary},
});
