/**
 * SpaceScreen — full detail view for a Space.
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {WaypointLoader} from '../../components/WaypointLoader';
import {useFocusEffect} from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
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
import MapView, {Marker, PROVIDER_GOOGLE} from 'react-native-maps';
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
import {colors, fonts, radius, shadows, spacing, themedStyles} from '../../theme';
import {categoryTint} from '../../components/home/PlaceCard';
import {useLocation} from '../../hooks/useLocation';
import {fetchEtas, fmtEta} from '../../services/etaService';
import {regionOf, regionsOf} from '../../utils/region';
import {useAuth} from '../../hooks/useAuth';
import {getBlocked, showMemoryActions} from '../../services/moderation';
import {displayAddress} from '../../utils/address';
import {pickImage, PickedImage} from '../../utils/pickImage';

type Props = NativeStackScreenProps<AppStackParamList, 'SpaceDetail'>;

/** Places whose live ETA is fetched on open; the rest wait for "See all". */
const NEAREST_WITH_ETA = 3;

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

function avatarColor(name: string): string {
  // Built per call so it follows the current theme.
  const palette = [colors.primary, colors.sage, colors.primaryDeep, colors.catDeli];
  const code = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return palette[code % palette.length];
}
function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return p.length === 1
    ? p[0][0]?.toUpperCase() ?? '?'
    : (p[0][0] + p[p.length - 1][0]).toUpperCase();
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
    try {
      const img = await pickImage(source);
      if (img) setPicked(img);
    } catch (err: any) {
      Alert.alert('Could not open photos', err?.message ?? 'Check photo and camera access in Settings.');
    }
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

const mu = themedStyles(() => ({
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
    borderRadius: radius.lg,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadBtnDisabled: {backgroundColor: colors.sandDeep},
  uploadBtnText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},
}));

// ── "Add Place to Space" bottom sheet ────────────────────────────────────────

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
          <WaypointLoader size={64} style={{marginTop: spacing.lg}} />
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

const sheet = themedStyles(() => ({
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
}));


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

const picker = themedStyles(() => ({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
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
  emptyTitle: {fontFamily: fonts.bold, fontSize: 15, color: colors.text, marginBottom: 4},
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
}));

// ── Members modal ─────────────────────────────────────────────────────────────

function MembersModal({
  members,
  myRole,
  myId,
  onRemove,
  onToggleLeader,
  onClose,
}: {
  members: ApiSpaceMember[];
  /** Leaders remove members; only the owner removes leaders or changes roles. */
  myRole: ApiSpaceMember['role'] | undefined;
  myId: number | undefined;
  onRemove: (member: ApiSpaceMember) => void;
  onToggleLeader: (member: ApiSpaceMember) => void;
  onClose: () => void;
}) {
  const canRemove = (m: ApiSpaceMember) =>
    m.role !== 'owner' &&
    m.user_id !== myId &&
    (myRole === 'owner' || (myRole === 'leader' && m.role === 'member'));
  const roleLabel = {owner: 'Owner', leader: 'Leader', member: 'Member'};
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
              {myRole === 'owner' && item.role !== 'owner' ? (
                // The owner taps the badge to promote or demote.
                <TouchableOpacity
                  style={[mem.badge, item.role === 'leader' && mem.badgeOwner]}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={
                    item.role === 'leader' ? `Make ${item.name} a member` : `Make ${item.name} a leader`
                  }
                  onPress={() => onToggleLeader(item)}>
                  <Text style={[mem.badgeText, item.role === 'leader' && mem.badgeTextOwner]}>
                    {roleLabel[item.role]} ⇅
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={[mem.badge, item.role !== 'member' && mem.badgeOwner]}>
                  <Text style={[mem.badgeText, item.role !== 'member' && mem.badgeTextOwner]}>
                    {roleLabel[item.role]}
                  </Text>
                </View>
              )}
              {canRemove(item) && (
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

const mem = themedStyles(() => ({
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
}));


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
    const picked = await pickImage('gallery', 'banner');
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

const ed = themedStyles(() => ({
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
    backgroundColor: 'rgba(20,20,30,0.35)',
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
    borderRadius: radius.lg,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  saveText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},
}));

// ── Main screen ───────────────────────────────────────────────────────────────

/** One chip row, single select: all, a neighbourhood, a tag, or visited. */
type PlaceChip = 'all' | 'visited' | `tag:${string}` | `region:${string}`;
type MemStatus = 'all' | 'visited' | 'unvisited';

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
function capitalise(t: string) {
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

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
  const [showMemFilters, setShowMemFilters] = useState(false);
  const [showMemoryPlacePicker, setShowMemoryPlacePicker] = useState(false);
  const [memoryTargetPlace, setMemoryTargetPlace] = useState<ApiSpacePlace | null>(null);

  const [chip, setChip] = useState<PlaceChip>('all');
  const [memPlace, setMemPlace] = useState<number | null>(null);
  const [memStatus, setMemStatus] = useState<MemStatus>('all');

  const {origin, hasFix} = useLocation();
  /** Live driving time per place id — absent until Google answers. */
  const [etas, setEtas] = useState<Record<number, number>>({});
  const [showAllPlaces, setShowAllPlaces] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [spaceResult, placesResult, membersResult, memoriesResult, recsResult] =
      await Promise.allSettled([
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
    if (placesResult.status === 'fulfilled') setPlaces(placesResult.value);
    if (membersResult.status === 'fulfilled') setMembers(membersResult.value);
    if (memoriesResult.status === 'fulfilled') {
      const blocked = user ? await getBlocked(user.id) : new Set<number>();
      setMemories(memoriesResult.value.filter(m => !blocked.has(m.uploader_id)));
    }
    if (recsResult.status === 'fulfilled') setSpaceRecs(recsResult.value);
    setLoading(false);
  }, [spaceId, user]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  // Optimistic: the ring fills at once and reverts if the server says no.
  const toggleVisited = useCallback(async (placeId: number) => {
    const target = places.find(p => p.id === placeId);
    if (!target) return;
    const next = !target.visited;
    setPlaces(prev => prev.map(p => (p.id === placeId ? {...p, visited: next} : p)));
    try {
      await placeService.setVisited(placeId, next);
    } catch {
      setPlaces(prev => prev.map(p => (p.id === placeId ? {...p, visited: !next} : p)));
      Alert.alert('Error', 'Could not update visited status.');
    }
  }, [places]);

  const isOwner = ownerId != null && user?.id === ownerId;

  const removePlace = useCallback((place: ApiSpacePlace) => {
    Alert.alert('Remove place', `Remove "${place.name}" from this space? The place itself is kept.`, [
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
    ]);
  }, [places, spaceId]);

  const removeMember = useCallback((member: ApiSpaceMember) => {
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
  }, [members, spaceId]);

  const toggleLeader = useCallback(async (member: ApiSpaceMember) => {
    const role = member.role === 'leader' ? 'member' : 'leader';
    const snapshot = members;
    setMembers(prev => prev.map(m => (m.user_id === member.user_id ? {...m, role} : m)));
    try {
      await spaceDetailService.setMemberRole(spaceId, member.user_id, role);
    } catch {
      setMembers(snapshot);
      Alert.alert('Error', 'Could not change that role.');
    }
  }, [members, spaceId]);

  const distKm = (p: ApiSpacePlace) => haversineKm(origin.lat, origin.lng, p.lat, p.lng);
  const sortedPlaces = [...places].sort((a, b) => distKm(a) - distKm(b));
  const hero = sortedPlaces[0] ?? null;

  const availableTags = Array.from(new Set(places.flatMap(p => p.tags))).sort();
  const availableRegions = regionsOf(places.map(p => p.address));
  const chips: Array<{key: PlaceChip; label: string}> = [
    {key: 'all', label: 'All'},
    ...availableRegions.map(r => ({key: `region:${r}` as PlaceChip, label: r})),
    ...availableTags.map(t => ({key: `tag:${t}` as PlaceChip, label: capitalise(t)})),
    {key: 'visited', label: 'Visited'},
  ];
  const visiblePlaces = sortedPlaces.filter(p => {
    if (chip === 'all') return true;
    if (chip === 'visited') return p.visited;
    if (chip.startsWith('tag:')) return p.tags.includes(chip.slice(4));
    return regionOf(p.address) === chip.slice(7);
  });
  const listedPlaces = showAllPlaces ? visiblePlaces : visiblePlaces.slice(0, NEAREST_WITH_ETA);

  // Live travel times, for what is on screen: the nearest few on open, the
  // rest only once the full list is opened — each traffic reading is paid for.
  // Without a real fix the origin is a fallback guess, and an ETA from the
  // wrong city is worse than none.
  const etaIds = Array.from(new Set([...(hero ? [hero.id] : []), ...listedPlaces.map(p => p.id)])).join(',');
  useEffect(() => {
    if (!hasFix || !etaIds) return;
    let alive = true;
    fetchEtas(spaceId, origin, etaIds.split(',').map(Number)).then(result => {
      if (alive) setEtas(prev => ({...prev, ...result}));
    });
    return () => {
      alive = false;
    };
  }, [spaceId, etaIds, origin, hasFix]);

  const travelLine = (p: ApiSpacePlace) =>
    [
      p.tags[0] ? capitalise(p.tags[0]) : null,
      etas[p.id] !== undefined ? fmtEta(etas[p.id]) : null,
      fmtDistance(distKm(p)),
    ]
      .filter(Boolean)
      .join(' · ');

  // Memories grouped per place, nearest place first.
  const memGroups = sortedPlaces
    .map(place => ({place, items: memories.filter(m => m.place_id === place.id)}))
    .filter(g => g.items.length > 0);
  const memGroupsVisible = memGroups.filter(g => {
    if (memPlace !== null && g.place.id !== memPlace) return false;
    if (memStatus === 'visited' && !g.place.visited) return false;
    if (memStatus === 'unvisited' && g.place.visited) return false;
    return true;
  });
  const memFilterCount = (memPlace !== null ? 1 : 0) + (memStatus !== 'all' ? 1 : 0);

  const openPlace = (p: ApiSpacePlace) =>
    navigation.navigate('PlaceDetail', {placeId: p.id, placeName: p.name, fromSpaceId: spaceId});

  const openDirections = (p: ApiSpacePlace) =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`);

  const addPlace = () => {
    // Tags already used in this space are offered as suggestions.
    const spaceTags = Array.from(new Set(places.flatMap(p => p.tags)));
    navigation.navigate('CreatePlace', {spaceId, spaceTags});
  };

  return (
    <View style={[s.root, {paddingTop: insets.top}]}>
      <View style={s.header}>
        <TouchableOpacity style={s.back} accessibilityLabel="Back" onPress={() => navigation.goBack()}>
          <Text style={s.backIcon}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.flex} activeOpacity={0.7} onPress={() => setShowMembers(true)}>
          <Text style={s.title} numberOfLines={1}>
            {spaceName}
          </Text>
          <Text style={s.mut}>
            {plural(members.length, 'member')} · {plural(places.length, 'place')}
          </Text>
        </TouchableOpacity>
        {isOwner && (
          <TouchableOpacity hitSlop={10} onPress={() => setShowEdit(true)}>
            <Text style={s.link}>Edit</Text>
          </TouchableOpacity>
        )}
        <View style={s.spaceAvatar}>
          {bannerUrl ? (
            <Image source={{uri: bannerUrl}} style={StyleSheet.absoluteFill} />
          ) : (
            <Text style={s.spaceAvatarEmoji}>{spaceIcon}</Text>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <WaypointLoader size={72} style={s.loader} />
        ) : places.length === 0 ? (
          <Text style={s.emptyNote}>No places yet. Tap Add place to put the first one in this space.</Text>
        ) : (
          <>
            <Text style={s.eyebrow}>Closest to you</Text>
            {hero && (
              <TouchableOpacity style={s.hero} activeOpacity={0.9} onPress={() => openPlace(hero)}>
                <MapView
                  provider={PROVIDER_GOOGLE}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                  liteMode
                  scrollEnabled={false}
                  zoomEnabled={false}
                  rotateEnabled={false}
                  pitchEnabled={false}
                  initialRegion={{
                    latitude: hero.lat,
                    longitude: hero.lng,
                    latitudeDelta: 0.012,
                    longitudeDelta: 0.012,
                  }}>
                  <Marker coordinate={{latitude: hero.lat, longitude: hero.lng}} />
                </MapView>
                <View style={s.heroShade} pointerEvents="none" />
                <View style={s.heroFoot}>
                  <View style={s.flex}>
                    <Text style={s.heroName} numberOfLines={1}>
                      {hero.name}
                    </Text>
                    <Text style={s.heroMeta} numberOfLines={1}>
                      {travelLine(hero)}
                    </Text>
                  </View>
                  <TouchableOpacity style={s.directions} activeOpacity={0.85} onPress={() => openDirections(hero)}>
                    <Text style={s.directionsText}>Directions</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.chipScroll}
              contentContainerStyle={s.chipRow}>
              {chips.map(c => (
                <Chip key={c.key} label={c.label} on={chip === c.key} onPress={() => setChip(c.key)} />
              ))}
            </ScrollView>

            <View style={s.rows}>
              {visiblePlaces.length === 0 ? (
                <Text style={s.noMatch}>No places match this filter.</Text>
              ) : (
                listedPlaces.map(place => (
                  <View key={place.id} style={s.row}>
                    <View style={s.thumb}>
                      <Text style={s.thumbEmoji}>{placeEmoji(place.tags)}</Text>
                    </View>
                    <TouchableOpacity
                      style={s.flex}
                      activeOpacity={0.7}
                      onPress={() => openPlace(place)}
                      onLongPress={() => removePlace(place)}
                      delayLongPress={400}>
                      <Text style={s.rowName} numberOfLines={1}>
                        {place.name}
                      </Text>
                      <Text style={[s.mut, s.mt3]} numberOfLines={1}>
                        {travelLine(place)}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.beenHere}
                      accessibilityRole="checkbox"
                      accessibilityLabel="Been here"
                      accessibilityState={{checked: place.visited}}
                      onPress={() => toggleVisited(place.id)}>
                      <View style={[s.beenRing, place.visited && s.beenOn]}>
                        <Text style={[s.beenGlyph, place.visited && s.beenGlyphOn]}>
                          {place.visited ? '✓' : '⌖'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                ))
              )}
              {listedPlaces.length < visiblePlaces.length && (
                <TouchableOpacity style={s.seeAll} hitSlop={8} onPress={() => setShowAllPlaces(true)}>
                  <Text style={s.link}>See all {visiblePlaces.length} places</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={s.secHead}>
              <Text style={s.sec}>Memories</Text>
              <View style={s.secLinks}>
                <TouchableOpacity hitSlop={8} onPress={() => setShowMemoryPlacePicker(true)}>
                  <Text style={s.link}>＋ Add</Text>
                </TouchableOpacity>
                {memGroups.length > 0 && (
                  <TouchableOpacity hitSlop={8} onPress={() => setShowMemFilters(true)}>
                    <Text style={s.link}>
                      {memFilterCount > 0 ? `Filters (${memFilterCount})` : 'Filters'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {memGroups.length === 0 ? (
              <Text style={s.emptyNote}>No memories yet. Add photos from a visit and they collect here.</Text>
            ) : memGroupsVisible.length === 0 ? (
              <Text style={s.noMatch}>No memories match this filter.</Text>
            ) : (
              <View style={s.memList}>
                {memGroupsVisible.map(g => (
                  <View key={g.place.id} style={s.memCard}>
                    <View style={s.memHead}>
                      <Text style={s.memPlace} numberOfLines={1}>
                        {g.place.name}
                      </Text>
                      <View style={s.mtags}>
                        {g.place.tags.slice(0, 2).map(t => (
                          <Text key={t} style={s.mtag}>
                            {t}
                          </Text>
                        ))}
                      </View>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={s.photoRow}>
                      {g.items.map(m =>
                        user && m.uploader_id !== user.id ? (
                          // Long-press to report or block (guideline 1.2).
                          <Pressable
                            key={m.id}
                            accessibilityHint="Long-press to report or block"
                            onLongPress={() =>
                              showMemoryActions(m, user.id, id =>
                                setMemories(prev => prev.filter(x => x.uploader_id !== id)),
                              )
                            }>
                            <Image source={{uri: m.image_url}} style={s.photo} />
                          </Pressable>
                        ) : (
                          <Image key={m.id} source={{uri: m.image_url}} style={s.photo} />
                        ),
                      )}
                      <TouchableOpacity
                        style={s.photoAdd}
                        accessibilityLabel={`Add a memory at ${g.place.name}`}
                        onPress={() => setMemoryTargetPlace(g.place)}>
                        <Text style={s.photoAddPlus}>＋</Text>
                      </TouchableOpacity>
                    </ScrollView>
                    {g.items
                      .filter(m => m.caption)
                      .slice(0, 2)
                      .map(m => (
                        <Text key={m.id} style={s.caption} numberOfLines={2}>
                          “{m.caption}”
                        </Text>
                      ))}
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {spaceRecs.length > 0 && (
          <>
            <View style={s.secHead}>
              <Text style={s.sec}>Suggested near this space</Text>
            </View>
            <View style={s.rows}>
              {spaceRecs.map((rec, idx) => (
                <View key={rec.google_place_id || idx} style={s.row}>
                  <View style={s.thumb}>
                    <Text style={s.thumbEmoji}>{rec.emoji}</Text>
                  </View>
                  <View style={s.flex}>
                    <Text style={s.rowName} numberOfLines={1}>
                      {rec.name}
                    </Text>
                    <Text style={[s.mut, s.mt3]} numberOfLines={1}>
                      {displayAddress(rec.address) ?? rec.address}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={s.saveChip}
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
                    <Text style={s.saveChipText}>Save</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={s.bottomPad} />
      </ScrollView>

      <TouchableOpacity
        style={[s.fab, {bottom: insets.bottom + 20}]}
        activeOpacity={0.85}
        onPress={addPlace}>
        <Text style={s.fabPlus}>＋</Text>
        <Text style={s.fabLabel}>Add place</Text>
      </TouchableOpacity>

      <Modal
        visible={showMemFilters}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMemFilters(false)}>
        <Pressable style={sheet.backdrop} onPress={() => setShowMemFilters(false)} />
        <View style={sheet.container}>
          <View style={sheet.handle} />
          <View style={s.sheetHead}>
            <Text style={s.sheetT}>Filter memories</Text>
            <TouchableOpacity
              hitSlop={8}
              onPress={() => {
                setMemPlace(null);
                setMemStatus('all');
              }}>
              <Text style={s.link}>Clear</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.groupT}>Place</Text>
          <View style={s.wrap}>
            {memGroups.map(g => (
              <Chip
                key={g.place.id}
                label={g.place.name}
                on={memPlace === g.place.id}
                onPress={() => setMemPlace(memPlace === g.place.id ? null : g.place.id)}
              />
            ))}
          </View>
          <Text style={s.groupT}>Status</Text>
          <View style={s.wrap}>
            {([
              ['all', 'All'],
              ['visited', 'Visited'],
              ['unvisited', 'Not visited'],
            ] as const).map(([k, label]) => (
              <Chip key={k} label={label} on={memStatus === k} onPress={() => setMemStatus(k)} />
            ))}
          </View>
          <TouchableOpacity style={s.btnP} activeOpacity={0.85} onPress={() => setShowMemFilters(false)}>
            <Text style={s.btnPText}>Show results</Text>
          </TouchableOpacity>
        </View>
      </Modal>

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
          myRole={members.find(m => m.user_id === user?.id)?.role}
          myId={user?.id}
          onRemove={removeMember}
          onToggleLeader={toggleLeader}
          onClose={() => setShowMembers(false)}
        />
      )}

      {showMemoryPlacePicker && (
        <MemoryPlacePickerModal
          places={sortedPlaces}
          activePlaceId={null}
          memoriesByPlace={Object.fromEntries(memGroups.map(g => [g.place.id, g.items]))}
          onClose={() => setShowMemoryPlacePicker(false)}
          onSelect={place => {
            setShowMemoryPlacePicker(false);
            openPlace(place);
          }}
          onAddMemory={place => {
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
            load();
          }}
        />
      )}
    </View>
  );
}

function Chip({label, on, onPress}: {label: string; on: boolean; onPress: () => void}) {
  return (
    <TouchableOpacity
      style={[s.chip, on && s.chipOn]}
      activeOpacity={0.8}
      accessibilityState={{selected: on}}
      onPress={onPress}>
      <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = themedStyles(() => ({
  root: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1, minWidth: 0},
  mt3: {marginTop: 3},
  mut: {fontFamily: fonts.regular, fontSize: 11.5, color: colors.textSecondary},
  link: {fontFamily: fonts.bold, fontSize: 12, color: colors.primaryDeep},
  loader: {marginTop: spacing.xl},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 15,
    paddingTop: 4,
    paddingBottom: 14,
  },
  back: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  backIcon: {fontSize: 30, color: colors.text, lineHeight: 32},
  title: {fontFamily: fonts.bold, fontSize: 17, color: colors.text},
  spaceAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 5,
  },
  spaceAvatarEmoji: {fontSize: 15},

  content: {paddingHorizontal: 20},

  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.primaryDeep,
    marginBottom: 8,
  },
  hero: {
    height: 170,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.surfaceDim,
    marginBottom: 22,
  },
  heroShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 72,
    backgroundColor: 'rgba(20,20,30,0.62)',
  },
  heroFoot: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  heroName: {fontFamily: fonts.bold, fontSize: 17, color: colors.white},
  heroMeta: {fontFamily: fonts.regular, fontSize: 12, color: 'rgba(255,255,255,0.9)', marginTop: 2},
  directions: {backgroundColor: colors.primary, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14},
  directionsText: {fontFamily: fonts.bold, fontSize: 12, color: colors.white},

  chipScroll: {marginHorizontal: -20, marginBottom: 18},
  chipRow: {paddingHorizontal: 20, gap: 8},
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    maxWidth: 220,
  },
  chipOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  chipText: {fontFamily: fonts.semibold, fontSize: 12.5, color: colors.text},
  chipTextOn: {color: colors.white},

  rows: {gap: 10, marginBottom: 26},
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
  seeAll: {alignSelf: 'flex-start', paddingVertical: 4},
  noMatch: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 20,
  },
  emptyNote: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 26,
  },

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

  secHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sec: {fontFamily: fonts.bold, fontSize: 14, color: colors.text},
  secLinks: {flexDirection: 'row', gap: 14},

  memList: {gap: 14, marginBottom: 26},
  memCard: {backgroundColor: colors.surface, borderRadius: radius.lg, padding: 10},
  memHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 8,
  },
  memPlace: {flex: 1, fontFamily: fonts.bold, fontSize: 13.5, color: colors.text},
  mtags: {flexDirection: 'row', gap: 5},
  mtag: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.textSecondary,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  photoRow: {gap: 7},
  photo: {width: 72, height: 72, borderRadius: 9, backgroundColor: colors.surfaceDim},
  photoAdd: {
    width: 72,
    height: 72,
    borderRadius: 9,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAddPlus: {fontSize: 20, color: colors.textSecondary},
  caption: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 8,
    overflow: 'hidden',
  },

  saveChip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  saveChipText: {fontFamily: fonts.bold, fontSize: 12, color: colors.primaryDeep},

  bottomPad: {height: 110},

  fab: {
    position: 'absolute',
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 20,
    ...shadows.primaryGlow,
  },
  fabPlus: {fontSize: 17, color: colors.white},
  fabLabel: {fontFamily: fonts.bold, fontSize: 15, color: colors.white},

  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sheetT: {fontFamily: fonts.bold, fontSize: 16, color: colors.text},
  groupT: {fontFamily: fonts.bold, fontSize: 11.5, color: colors.textSecondary, marginBottom: 8},
  wrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 18},
  btnP: {
    minHeight: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPText: {fontFamily: fonts.bold, fontSize: 15, color: colors.white},
}));
