import React, {useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
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
import {pickImage} from '../../utils/pickImage';
import {AppStackParamList} from '../../types/navigation';
import {spaceService, ApiSpace} from '../../services/spaceService';
import memoryService from '../../services/memoryService';
import {colors, fonts, radius, themedStyles} from '../../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'CreateSpace'>;

const EMOJIS = [
  '🌍', '🎯', '✨', '🔥', '💫', '🌟', '🎉', '💎', '🚀', '⚡',
  '🍕', '🍣', '🍜', '🥗', '🥩', '🍔', '🌮', '🍱', '🥐', '☕',
  '🏔️', '🌊', '🌸', '🌿', '🏝️', '🌅', '🌴', '🌳', '🌵', '🏕️',
  '🎨', '🎭', '🎬', '🎵', '🎮', '🏋️', '⚽', '🎸', '🎪', '🎲',
  '🏛️', '🏖️', '🗺️', '🧭', '🌃', '🌉', '🏙️', '🛍️', '💆', '🎁',
];
// The icon picks the accent: teal, violet, green, amber.
const ACCENTS = ['#00838E', '#6A69DB', '#00884B', '#B7791F'];
function accentFor(emoji: string): string {
  return ACCENTS[Math.max(0, EMOJIS.indexOf(emoji)) % ACCENTS.length];
}

// ─── Step 1: Configure ────────────────────────────────────────────────────────

function ConfigureStep({
  navigation,
  onCreated,
}: {
  navigation: Props['navigation'];
  onCreated: (space: ApiSpace, inviteLink: string) => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🌍');
  const [banner, setBanner] = useState<{uri: string; mime: string} | null>(null);
  const [loading, setLoading] = useState(false);

  // The banner is cropped to its 16:9 frame when picked, so it never shows cut off.
  const pickBanner = async () => {
    try {
      const img = await pickImage('gallery', 'banner');
      if (img) setBanner({uri: img.uri, mime: img.type});
    } catch (err: any) {
      Alert.alert('Could not open your photos', err?.message ?? 'Please try again.');
    }
  };

  const canCreate = name.trim().length > 0 && !loading;

  const handleCreate = async () => {
    if (!canCreate) return;
    setLoading(true);
    try {
      let bannerKey: string | undefined;
      if (banner) {
        const presigned = await memoryService.presign('space_banner');
        await memoryService.uploadToR2(presigned.presign_url, banner.uri, banner.mime);
        bannerKey = presigned.key;
      }
      const space = await spaceService.create(name.trim(), icon, bannerKey);
      let inviteLink = '';
      try {
        inviteLink = (await spaceService.generateInviteLink(space.id)).link;
      } catch {
        /* non-fatal: the success step can retry */
      }
      onCreated(space, inviteLink);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error ?? err?.message ?? 'Failed to create space');
    } finally {
      setLoading(false);
    }
  };

  const accent = accentFor(icon);

  return (
    <View style={s.flex}>
      <View style={s.header}>
        <TouchableOpacity style={s.back} accessibilityLabel="Back" onPress={() => navigation.goBack()}>
          <Text style={s.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>New space</Text>
        <View style={s.back} />
      </View>

      <ScrollView
        style={s.flex}
        contentContainerStyle={s.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          style={[s.banner, banner && s.bannerFilled]}
          activeOpacity={0.85}
          onPress={pickBanner}>
          {banner ? (
            <>
              <Image source={{uri: banner.uri}} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <View style={s.bannerShade} />
              <View style={s.changePill}>
                <Text style={s.changePillText}>Tap to change photo</Text>
              </View>
              <View style={[s.badge, {backgroundColor: accent}]}>
                <Text style={s.badgeEmoji}>{icon}</Text>
              </View>
            </>
          ) : (
            <View style={s.bannerEmpty}>
              <Text style={s.bannerGlyph}>🖼️</Text>
              <Text style={s.bannerTitle}>Add a banner photo</Text>
              <View style={s.libraryPill}>
                <Text style={s.libraryPillText}>Choose from library</Text>
              </View>
            </View>
          )}
        </TouchableOpacity>

        <Text style={[s.lab, s.labTop]}>Space name</Text>
        <View style={s.field}>
          <TextInput
            style={s.fieldInput}
            placeholder="e.g. Weekend Adventures"
            placeholderTextColor={colors.placeholder}
            value={name}
            onChangeText={setName}
            maxLength={60}
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />
          <Text style={s.mut}>{name.length}/60</Text>
        </View>

        <Text style={[s.lab, s.labTop]}>{banner ? 'Badge icon' : 'Icon'}</Text>
        <View style={s.grid}>
          {EMOJIS.map(e => (
            <TouchableOpacity
              key={e}
              style={[s.emoji, e === icon && s.emojiOn]}
              accessibilityLabel={e}
              accessibilityState={{selected: e === icon}}
              activeOpacity={0.7}
              onPress={() => setIcon(e)}>
              <Text style={s.emojiText}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <View style={s.footer}>
        {!name.trim() && <Text style={[s.mut, s.footerHint]}>Name your space to continue</Text>}
        <TouchableOpacity
          style={[s.btnP, !canCreate && s.btnOff]}
          activeOpacity={0.85}
          disabled={!canCreate}
          onPress={handleCreate}>
          {loading && <ActivityIndicator color={colors.white} size="small" />}
          <Text style={[s.btnPText, !canCreate && !loading && s.btnOffText]}>
            {loading ? 'Creating…' : 'Create space'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Step 2: Invite ───────────────────────────────────────────────────────────

function SuccessStep({
  space,
  initialInviteLink,
  navigation,
}: {
  space: ApiSpace;
  initialInviteLink: string;
  navigation: Props['navigation'];
}) {
  const accent = accentFor(space.icon);
  const [inviteLink, setInviteLink] = useState(initialInviteLink);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchInviteLink = async () => {
    setLinkLoading(true);
    setLinkError('');
    try {
      setInviteLink((await spaceService.generateInviteLink(space.id)).link);
    } catch (err: any) {
      setLinkError(err?.response?.data?.error ?? err?.message ?? 'Could not generate link');
    } finally {
      setLinkLoading(false);
    }
  };

  const copy = () => {
    Clipboard.setString(inviteLink);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2500);
  };

  const share = async () => {
    try {
      await Share.share({message: `Join my space "${space.name}": ${inviteLink}`});
    } catch {
      /* dismissed */
    }
  };

  return (
    <View style={s.flex}>
      <ScrollView contentContainerStyle={s.successBody} showsVerticalScrollIndicator={false}>
        <Text style={s.successTitle}>Space created</Text>

        {space.banner_url ? (
          <View style={s.successBanner}>
            <Image source={{uri: space.banner_url}} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <View style={[s.badge, s.badgeLg, {backgroundColor: accent}]}>
              <Text style={s.badgeEmojiLg}>{space.icon}</Text>
            </View>
          </View>
        ) : (
          <View style={[s.emojiTile, {backgroundColor: accent + '33'}]}>
            <Text style={s.emojiTileText}>{space.icon}</Text>
          </View>
        )}

        <Text style={s.h1}>{space.name}</Text>
        <Text style={[s.mut, s.centered]}>You're the only member so far.</Text>

        <View style={s.card}>
          <Text style={s.lab}>Invite friends</Text>
          {inviteLink ? (
            <>
              <TouchableOpacity style={s.linkPill} activeOpacity={0.75} onPress={copy}>
                <Text style={s.linkGlyph}>🔗</Text>
                <Text style={s.linkText} numberOfLines={1} ellipsizeMode="middle">
                  {inviteLink}
                </Text>
                <Text style={[s.linkHint, copied && s.linkHintDone]}>
                  {copied ? 'Copied' : 'Tap to copy'}
                </Text>
              </TouchableOpacity>
              <View style={s.btnRow}>
                <TouchableOpacity style={[s.btnG, s.btnSunken, s.btnHalf]} activeOpacity={0.8} onPress={copy}>
                  <Text style={s.btnGText}>{copied ? '✓ Copied' : 'Copy link'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btnP, s.btnHalf]} activeOpacity={0.85} onPress={share}>
                  <Text style={s.btnPText}>Share</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              {!!linkError && <Text style={s.error}>{linkError}</Text>}
              <TouchableOpacity
                style={s.btnP}
                activeOpacity={0.85}
                disabled={linkLoading}
                onPress={fetchInviteLink}>
                {linkLoading ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={s.btnPText}>{linkError ? 'Retry invite link' : 'Get invite link'}</Text>
                )}
              </TouchableOpacity>
            </>
          )}
          <Text style={[s.mut, s.inviteHint]}>Anyone with this link can join the space.</Text>
        </View>
      </ScrollView>

      <View style={s.doneWrap}>
        <TouchableOpacity style={s.btnG} activeOpacity={0.8} onPress={() => navigation.navigate('Tabs')}>
          <Text style={s.btnGText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function CreateSpaceScreen({navigation}: Props) {
  const [created, setCreated] = useState<{space: ApiSpace; link: string} | null>(null);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {created ? (
        <SuccessStep space={created.space} initialInviteLink={created.link} navigation={navigation} />
      ) : (
        <ConfigureStep navigation={navigation} onCreated={(space, link) => setCreated({space, link})} />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = themedStyles(() => ({
  safe: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1},
  mut: {fontFamily: fonts.regular, fontSize: 11.5, color: colors.textSecondary},
  centered: {textAlign: 'center', marginTop: 4},

  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10},
  back: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  backIcon: {fontSize: 30, color: colors.text, lineHeight: 32},
  headerTitle: {flex: 1, textAlign: 'center', fontFamily: fonts.bold, fontSize: 16, color: colors.text},

  body: {paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20},

  banner: {
    height: 176,
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  bannerFilled: {borderWidth: 0},
  bannerEmpty: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8},
  bannerGlyph: {fontSize: 28, opacity: 0.6},
  bannerTitle: {fontFamily: fonts.bold, fontSize: 14, color: colors.text},
  libraryPill: {backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14},
  libraryPillText: {fontFamily: fonts.bold, fontSize: 12, color: colors.white},
  bannerShade: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,20,30,0.25)'},
  changePill: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(20,20,30,0.55)',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  changePillText: {fontFamily: fonts.bold, fontSize: 11.5, color: colors.white},
  badge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeEmoji: {fontSize: 22},
  badgeLg: {width: 48, height: 48, borderRadius: 14},
  badgeEmojiLg: {fontSize: 24},

  lab: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 7,
  },
  labTop: {marginTop: 20},
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.sunken,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    // A minimum, not a fixed height: with a larger system text size the text
    // grows the field instead of being clipped (seen on device).
    minHeight: 48,
  },
  fieldInput: {flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.text, paddingVertical: 12},

  // Seven columns, as in the design.
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 4},
  emoji: {
    width: '13.3%',
    height: 46,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiOn: {borderColor: colors.primary, backgroundColor: colors.surface},
  emojiText: {fontSize: 22},

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerHint: {textAlign: 'center', marginBottom: 10},

  btnP: {
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPText: {fontFamily: fonts.bold, fontSize: 15, color: colors.white},
  btnOff: {backgroundColor: colors.disabledBg},
  btnOffText: {color: colors.disabledFg},
  btnG: {
    minHeight: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSunken: {backgroundColor: colors.sunken},
  btnGText: {fontFamily: fonts.bold, fontSize: 15, color: colors.text},
  btnRow: {flexDirection: 'row', gap: 10, marginTop: 12},
  btnHalf: {flex: 1, minHeight: 44},

  successBody: {paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20},
  successTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 18,
  },
  successBanner: {height: 150, borderRadius: 18, overflow: 'hidden'},
  emojiTile: {
    alignSelf: 'center',
    width: 112,
    height: 112,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiTileText: {fontSize: 54},
  h1: {
    fontFamily: fonts.bold,
    fontSize: 24,
    letterSpacing: -0.5,
    color: colors.text,
    textAlign: 'center',
    marginTop: 16,
  },
  card: {
    marginTop: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
  },
  linkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    backgroundColor: colors.sunken,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  linkGlyph: {fontSize: 14},
  linkText: {flex: 1, fontFamily: fonts.semibold, fontSize: 13, color: colors.text},
  linkHint: {fontFamily: fonts.bold, fontSize: 11.5, color: colors.primaryDeep},
  linkHintDone: {color: colors.success},
  inviteHint: {marginTop: 12, lineHeight: 17},
  error: {fontFamily: fonts.regular, fontSize: 12, color: colors.error, marginBottom: 8},
  doneWrap: {paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12},
}));
