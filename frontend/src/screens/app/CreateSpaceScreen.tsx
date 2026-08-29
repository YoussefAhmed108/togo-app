import React, {useState, useRef} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Clipboard,
  Image,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {launchImageLibrary} from 'react-native-image-picker';
import {AppStackParamList} from '../../types/navigation';
import {spaceService, ApiSpace} from '../../services/spaceService';
import memoryService from '../../services/memoryService';
import {colors, fonts, radius, spacing} from '../../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'CreateSpace'>;

type Mode = 'photo' | 'emoji';

// ─── Emoji data ────────────────────────────────────────────────────────────────

const EMOJI_ROWS = [
  ['🌍', '🎯', '✨', '🔥', '💫', '🌟', '🎉', '💎', '🚀', '⚡'],
  ['🍕', '🍣', '🍜', '🥗', '🥩', '🍔', '🌮', '🍱', '🥐', '☕'],
  ['🏔️', '🌊', '🌸', '🌿', '🏝️', '🌅', '🌴', '🌳', '🌵', '🏕️'],
  ['🎨', '🎭', '🎬', '🎵', '🎮', '🏋️', '⚽', '🎸', '🎪', '🎯'],
  ['🏛️', '🏖️', '🗺️', '🧭', '🌃', '🌉', '🏙️', '🛍️', '💆', '🎁'],
];
const ALL_EMOJIS = EMOJI_ROWS.flat();
const ICON_COLORS = [
  colors.primary, colors.sage, colors.primaryDeep, colors.catDeli,
];
function emojiColor(emoji: string): string {
  const idx = ALL_EMOJIS.indexOf(emoji);
  return ICON_COLORS[((idx < 0 ? 0 : idx) % ICON_COLORS.length)];
}

// ─── Step 1: Configure ────────────────────────────────────────────────────────

interface ConfigureStepProps {
  navigation: Props['navigation'];
  onCreated: (space: ApiSpace, inviteLink: string) => void;
}

function ConfigureStep({navigation, onCreated}: ConfigureStepProps) {
  const [mode, setMode] = useState<Mode>('photo');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🌍');

  // Banner image state
  const [bannerUri, setBannerUri] = useState<string | null>(null);
  const [bannerMime, setBannerMime] = useState('image/jpeg');

  const [loading, setLoading] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // ── Image picker ────────────────────────────────────────────────────────────
  const pickBannerImage = async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      selectionLimit: 1,
    });
    if (result.didCancel || !result.assets?.length) return;
    const asset = result.assets[0];
    if (asset.uri) {
      setBannerUri(asset.uri);
      setBannerMime(asset.type ?? 'image/jpeg');
    }
  };

  // ── Emoji select ────────────────────────────────────────────────────────────
  const handleEmojiSelect = (emoji: string) => {
    setIcon(emoji);
    Animated.sequence([
      Animated.timing(scaleAnim, {toValue: 1.25, duration: 100, useNativeDriver: true}),
      Animated.spring(scaleAnim, {toValue: 1, friction: 4, useNativeDriver: true}),
    ]).start();
  };

  // ── Create ──────────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Photo mode requires an image to be selected
    if (mode === 'photo' && !bannerUri) {
      Alert.alert('Add a photo', 'Please select a banner image, or switch to emoji mode.');
      return;
    }

    setLoading(true);
    try {
      let bannerKey: string | undefined;

      // Upload banner if we have one
      if (mode === 'photo' && bannerUri) {
        const presigned = await memoryService.presign('space_banner');
        await memoryService.uploadToR2(presigned.presign_url, bannerUri, bannerMime);
        bannerKey = presigned.key;
      }

      const space = await spaceService.create(
        trimmed,
        icon, // emoji is used as icon overlay even in photo mode
        bannerKey,
      );

      let inviteLink = '';
      try {
        const inv = await spaceService.generateInviteLink(space.id);
        inviteLink = inv.link;
      } catch {/* non-fatal */}

      onCreated(space, inviteLink);
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? 'Failed to create space';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const accentColor = emojiColor(icon);
  const canCreate = name.trim().length > 0 && !loading &&
    (mode === 'emoji' || (mode === 'photo' && bannerUri !== null));

  return (
    <View style={styles.flex}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Space</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.configBody}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>

        {/* ── Mode toggle ──────────────────────────────────────────────────── */}
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeTab, mode === 'photo' && styles.modeTabActive]}
            onPress={() => setMode('photo')}
            activeOpacity={0.8}>
            <Text style={[styles.modeTabText, mode === 'photo' && styles.modeTabTextActive]}>
              Photo
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeTab, mode === 'emoji' && styles.modeTabActive]}
            onPress={() => setMode('emoji')}
            activeOpacity={0.8}>
            <Text style={[styles.modeTabText, mode === 'emoji' && styles.modeTabTextActive]}>
              Emoji
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Photo mode: banner picker ─────────────────────────────────────── */}
        {mode === 'photo' && (
          <TouchableOpacity
            style={styles.bannerPicker}
            onPress={pickBannerImage}
            activeOpacity={0.85}>

            {bannerUri ? (
              /* Image selected — show preview */
              <>
                <Image source={{uri: bannerUri}} style={styles.bannerImage} resizeMode="cover" />
                {/* Dim overlay */}
                <View style={styles.bannerOverlay} />
                {/* Change photo hint */}
                <View style={styles.bannerChangeHint}>
                  <Text style={styles.bannerChangeHintText}>📷  Tap to change photo</Text>
                </View>
                {/* Emoji overlay in bottom-left */}
                <View style={[styles.bannerEmojiBadge, {backgroundColor: accentColor + 'CC'}]}>
                  <Text style={styles.bannerEmojiText}>{icon}</Text>
                </View>
              </>
            ) : (
              /* No image — show placeholder */
              <>
                <View style={styles.bannerPlaceholderBg} />
                <View style={styles.bannerPlaceholderContent}>
                  <Text style={styles.bannerPlaceholderIcon}>🖼️</Text>
                  <Text style={styles.bannerPlaceholderTitle}>Add a Banner Photo</Text>
                  <Text style={styles.bannerPlaceholderSub}>
                    Appears at the top of your space page
                  </Text>
                  <View style={styles.bannerPlaceholderBtn}>
                    <Text style={styles.bannerPlaceholderBtnText}>Choose from Library</Text>
                  </View>
                </View>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* ── Emoji mode: animated preview ─────────────────────────────────── */}
        {mode === 'emoji' && (
          <View style={styles.iconPreviewWrap}>
            <Animated.View
              style={[
                styles.iconCircle,
                {backgroundColor: accentColor + '22', transform: [{scale: scaleAnim}]},
              ]}>
              <View style={[styles.iconCircleInner, {backgroundColor: accentColor + '44'}]}>
                <Text style={styles.iconEmoji}>{icon}</Text>
              </View>
            </Animated.View>
            <Text style={styles.iconHint}>Pick an icon below</Text>
          </View>
        )}

        {/* ── Space name ────────────────────────────────────────────────────── */}
        <View style={styles.inputCard}>
          <Text style={styles.inputLabel}>SPACE NAME</Text>
          <TextInput
            ref={inputRef}
            style={styles.nameInput}
            placeholder="e.g. Weekend Adventures"
            placeholderTextColor={colors.placeholder}
            value={name}
            onChangeText={setName}
            maxLength={60}
            returnKeyType="done"
            onSubmitEditing={canCreate ? handleCreate : undefined}
            autoFocus
          />
          <View style={styles.charCount}>
            <Text style={styles.charCountText}>{name.length}/60</Text>
          </View>
        </View>

        {/* ── Emoji picker (shown in emoji mode + as icon chooser in photo mode) */}
        <View style={styles.pickerCard}>
          <Text style={styles.pickerLabel}>
            {mode === 'photo' ? 'SPACE ICON (OVERLAY)' : 'CHOOSE ICON'}
          </Text>
          {EMOJI_ROWS.map((row, rowIdx) => (
            <View key={rowIdx} style={styles.emojiRow}>
              {row.map(emoji => {
                const selected = emoji === icon;
                return (
                  <TouchableOpacity
                    key={emoji}
                    style={[
                      styles.emojiItem,
                      selected && {
                        backgroundColor: colors.primary + '22',
                        borderColor: colors.primary,
                        borderWidth: 2,
                      },
                    ]}
                    onPress={() => handleEmojiSelect(emoji)}
                    activeOpacity={0.7}>
                    <Text style={styles.emojiText}>{emoji}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>

      {/* ── Footer / create button ───────────────────────────────────────────── */}
      <View style={styles.footer}>
        {mode === 'photo' && !bannerUri && (
          <Text style={styles.footerHint}>Select a photo above to continue</Text>
        )}
        <TouchableOpacity
          style={[styles.createBtn, !canCreate && styles.createBtnDisabled]}
          onPress={handleCreate}
          disabled={!canCreate}
          activeOpacity={0.85}>
          {loading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.createBtnText}>Create Space</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Step 2: Success / Share ───────────────────────────────────────────────────

interface SuccessStepProps {
  space: ApiSpace;
  initialInviteLink: string;
  navigation: Props['navigation'];
}

function SuccessStep({space, initialInviteLink, navigation}: SuccessStepProps) {
  const accentColor = emojiColor(space.icon);

  const [inviteLink, setInviteLink] = useState(initialInviteLink);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchInviteLink = async () => {
    setLinkLoading(true);
    setLinkError('');
    try {
      const inv = await spaceService.generateInviteLink(space.id);
      setInviteLink(inv.link);
    } catch (err: any) {
      setLinkError(err?.response?.data?.error ?? err?.message ?? 'Could not generate link');
    } finally {
      setLinkLoading(false);
    }
  };

  const handleCopy = () => {
    Clipboard.setString(inviteLink);
    setCopied(true);
    if (copyTimeout.current) clearTimeout(copyTimeout.current);
    copyTimeout.current = setTimeout(() => setCopied(false), 2500);
  };

  const handleShare = async () => {
    try {
      await Share.share({message: `Join my space "${space.name}" on the app: ${inviteLink}`});
    } catch {/* dismissed */}
  };

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <View style={styles.backBtn} />
        <Text style={styles.headerTitle}>Space Created</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.successBody}
        showsVerticalScrollIndicator={false}>

        {/* Success banner — show space image or emoji */}
        {space.banner_url ? (
          <View style={styles.successBannerWrap}>
            <Image
              source={{uri: space.banner_url}}
              style={styles.successBanner}
              resizeMode="cover"
            />
            <View style={styles.successBannerOverlay} />
            <View style={[styles.successBannerEmoji, {backgroundColor: accentColor + 'CC'}]}>
              <Text style={styles.successBannerEmojiText}>{space.icon}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.successCheckWrap}>
            <View style={[styles.successIconCircle, {backgroundColor: accentColor + '33'}]}>
              <Text style={styles.successIconEmoji}>{space.icon}</Text>
            </View>
          </View>
        )}

        <Text style={styles.successHeading}>{space.name}</Text>
        <Text style={styles.successSub}>
          Your space is ready. Invite friends to join and explore places together.
        </Text>

        {/* Invite link */}
        <View style={styles.inviteCard}>
          <Text style={styles.inviteLabel}>INVITE FRIENDS</Text>

          {inviteLink ? (
            <>
              <TouchableOpacity style={styles.inviteLinkBox} onPress={handleCopy} activeOpacity={0.75}>
                <Text style={styles.inviteLinkText} numberOfLines={1} ellipsizeMode="middle">
                  {inviteLink}
                </Text>
                <Text style={styles.inviteLinkCopyHint}>
                  {copied ? '✓ Copied!' : 'Tap to copy'}
                </Text>
              </TouchableOpacity>
              <View style={styles.inviteBtnRow}>
                <TouchableOpacity
                  style={[styles.copyBtn, copied && styles.copyBtnDone]}
                  onPress={handleCopy}
                  activeOpacity={0.85}>
                  <Text style={styles.copyBtnIcon}>{copied ? '✓' : '⎘'}</Text>
                  <Text style={styles.copyBtnText}>{copied ? 'Copied!' : 'Copy Link'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.85}>
                  <Text style={styles.shareBtnIcon}>↑</Text>
                  <Text style={styles.shareBtnText}>Share</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.inviteHint}>
                Share a link so friends can join this space instantly.
              </Text>
              {linkError ? <Text style={styles.inviteError}>{linkError}</Text> : null}
              <TouchableOpacity
                style={[styles.shareBtn, linkLoading && {opacity: 0.6}]}
                onPress={fetchInviteLink}
                disabled={linkLoading}
                activeOpacity={0.85}>
                {linkLoading ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <>
                    <Text style={styles.shareBtnIcon}>🔗</Text>
                    <Text style={styles.shareBtnText}>
                      {linkError ? 'Retry Invite Link' : 'Get Invite Link'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => navigation.navigate('Home')}
          activeOpacity={0.85}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────────

export default function CreateSpaceScreen({navigation}: Props) {
  const [created, setCreated] = useState<{space: ApiSpace; link: string} | null>(null);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {created ? (
        <SuccessStep
          space={created.space}
          initialInviteLink={created.link}
          navigation={navigation}
        />
      ) : (
        <ConfigureStep
          navigation={navigation}
          onCreated={(space, link) => setCreated({space, link})}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.headerBg},
  flex: {flex: 1},

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  backBtn: {width: 44, alignItems: 'flex-start'},
  backIcon: {fontSize: 30, color: colors.white, lineHeight: 32},
  headerTitle: {fontFamily: fonts.display, fontSize: 19, color: colors.white},

  // ── Configure body ──────────────────────────────────────────────────────
  configBody: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },

  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    padding: 5,
    marginBottom: spacing.lg,
  },
  modeTab: {
    flex: 1,
    borderRadius: radius.full,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modeTabActive: {backgroundColor: colors.primary},
  modeTabText: {fontFamily: fonts.medium, fontSize: 16, color: colors.textSecondary},
  modeTabTextActive: {fontFamily: fonts.display, color: colors.white},

  // ── Banner picker ───────────────────────────────────────────────────────
  bannerPicker: {
    height: 216,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.sandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerImage: {...StyleSheet.absoluteFillObject},
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(45,42,36,0.28)',
  },
  bannerChangeHint: {
    backgroundColor: 'rgba(45,42,36,0.7)',
    borderRadius: radius.full,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  bannerChangeHintText: {fontFamily: fonts.medium, fontSize: 14, color: colors.white},
  bannerEmojiBadge: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerEmojiText: {fontSize: 24},
  bannerPlaceholderBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface,
  },
  bannerPlaceholderContent: {alignItems: 'center', paddingHorizontal: spacing.lg},
  bannerPlaceholderIcon: {fontSize: 30, marginBottom: 12, opacity: 0.55},
  bannerPlaceholderTitle: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    color: colors.text,
    marginBottom: 4,
  },
  bannerPlaceholderSub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  bannerPlaceholderBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
  },
  bannerPlaceholderBtnText: {fontFamily: fonts.semibold, fontSize: 15, color: colors.white},

  // ── Emoji preview ───────────────────────────────────────────────────────
  iconPreviewWrap: {alignItems: 'center', paddingVertical: spacing.lg},
  iconCircle: {
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleInner: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmoji: {fontSize: 46},
  iconHint: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },

  // ── Name + picker cards ─────────────────────────────────────────────────
  inputCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  nameInput: {
    fontFamily: fonts.display,
    fontSize: 21,
    color: colors.text,
    paddingVertical: 4,
  },
  charCount: {alignItems: 'flex-end', marginTop: 6},
  charCountText: {fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted},

  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  pickerLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  emojiRow: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8},
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
  emojiText: {fontSize: 21},
  bottomPad: {height: spacing.xl},

  // ── Footer ──────────────────────────────────────────────────────────────
  footer: {
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  footerHint: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textOnDarkSub,
    textAlign: 'center',
    marginBottom: 12,
  },
  createBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnDisabled: {backgroundColor: 'rgba(198,113,57,0.35)'},
  createBtnText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},

  // ── Success step ────────────────────────────────────────────────────────
  successBody: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    flexGrow: 1,
  },
  successBannerWrap: {
    height: 180,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  successBanner: {...StyleSheet.absoluteFillObject},
  successBannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(45,42,36,0.2)',
  },
  successBannerEmoji: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successBannerEmojiText: {fontSize: 24},
  successCheckWrap: {alignItems: 'center', marginBottom: spacing.lg},
  successIconCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIconEmoji: {fontSize: 40},
  successHeading: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  successSub: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },

  // ── Invite card (dark) ──────────────────────────────────────────────────
  inviteCard: {
    backgroundColor: colors.cardDark,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  inviteLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.textOnDarkSub,
    marginBottom: 12,
  },
  inviteLinkBox: {
    backgroundColor: colors.inkInput,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: 12,
  },
  inviteLinkText: {
    fontFamily: 'Menlo',
    fontSize: 15,
    color: colors.white,
    marginBottom: 4,
  },
  inviteLinkCopyHint: {fontFamily: fonts.regular, fontSize: 13, color: colors.textOnDarkSub},
  inviteBtnRow: {flexDirection: 'row', gap: 12},
  copyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.inkInput,
    borderRadius: radius.full,
    height: 48,
  },
  copyBtnDone: {backgroundColor: 'rgba(122,138,94,0.4)'},
  copyBtnIcon: {fontSize: 15, color: colors.white},
  copyBtnText: {fontFamily: fonts.semibold, fontSize: 15, color: colors.white},
  inviteHint: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textOnDarkSub,
    marginBottom: 12,
  },
  inviteError: {fontFamily: fonts.regular, fontSize: 13, color: colors.error, marginBottom: 8},
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 48,
  },
  shareBtnIcon: {fontSize: 15, color: colors.white},
  shareBtnText: {fontFamily: fonts.semibold, fontSize: 15, color: colors.white},

  doneBtn: {
    backgroundColor: colors.headerDeep,
    borderRadius: radius.full,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},
});
