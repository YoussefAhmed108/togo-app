import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
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
import {SafeAreaView} from 'react-native-safe-area-context';
import {LocationMapPicker, PickedLocation} from '../../components/LocationMapPicker';
import {savedLocationService, StartingPoint} from '../../services/savedLocationService';
import {useAuth} from '../../hooks/useAuth';
import {useAppSettings} from '../../hooks/useAppSettings';
import {colors, fonts, radius, spacing, THEME_OPTIONS} from '../../theme';

export default function SettingsScreen() {
  const {user, signOut, updateDisplayName} = useAuth();
  const {themeName, setThemeName} = useAppSettings();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);

  // Starting points — named origins the user can pick instead of GPS.
  const [points, setPoints] = useState<StartingPoint[]>([]);
  const [pointLabel, setPointLabel] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingPoint, setSavingPoint] = useState(false);

  useEffect(() => {
    savedLocationService.list().then(setPoints).catch(() => {});
  }, []);

  useEffect(() => {
    setDisplayName(user?.name ?? '');
  }, [user?.name]);

  const handlePointPicked = async (picked: PickedLocation) => {
    setPickerOpen(false);
    setSavingPoint(true);
    try {
      // Blank label → the first line of the address, which is the useful part.
      const label = (pointLabel.trim() || picked.label.split(',')[0]).slice(0, 60);
      const created = await savedLocationService.create(label, picked.label, picked.lat, picked.lng);
      setPoints(prev => [...prev, created]);
      setPointLabel('');
    } catch (err: any) {
      Alert.alert('Could Not Save', err?.response?.data?.error ?? 'Please try again.');
    } finally {
      setSavingPoint(false);
    }
  };

  const handleDeletePoint = (point: StartingPoint) => {
    Alert.alert('Remove Starting Point', `Remove "${point.label}"?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const before = points;
          setPoints(prev => prev.filter(p => p.id !== point.id));
          try {
            await savedLocationService.remove(point.id);
          } catch {
            setPoints(before);
            Alert.alert('Could Not Remove', 'Please try again.');
          }
        },
      },
    ]);
  };

  const handleSaveName = async () => {
    const nextName = displayName.trim();
    if (!nextName) {
      Alert.alert('Display Name Required', 'Please enter a display name.');
      return;
    }
    if (nextName === (user?.name ?? '')) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      await updateDisplayName(nextName);
      setEditingName(false);
    } catch (err: any) {
      const message =
        err?.response?.data?.error ?? err?.message ?? 'Could not update your display name.';
      Alert.alert('Update Failed', message);
    } finally {
      setSavingName(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Do you want to end this session on this device?', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Log Out', style: 'destructive', onPress: () => signOut()},
    ]);
  };

  const themeLabel = THEME_OPTIONS.find(o => o.id === themeName)?.name ?? 'Light';
  const pointsSummary =
    points.length === 0
      ? 'None yet'
      : `${points.length} ${points.length === 1 ? 'address' : 'addresses'}`;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.h1}>Profile</Text>

        <View style={s.hero}>
          {user?.avatar_url ? (
            <Image source={{uri: user.avatar_url}} style={s.avatar} />
          ) : (
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={s.avatarText}>
                {(user?.name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}
              </Text>
            </View>
          )}
          <View style={s.flex}>
            <Text style={s.heroName} numberOfLines={1}>
              {user?.name ?? 'Profile'}
            </Text>
            <Text style={s.mut}>@{user?.username ?? 'username'}</Text>
          </View>
        </View>

        <TouchableOpacity style={[s.row, s.rowGap]} activeOpacity={0.7} onPress={() => setSettingsOpen(true)}>
          <Text style={s.rowIcon}>⚙︎</Text>
          <View style={s.flex}>
            <Text style={s.rowName}>Settings</Text>
            <Text style={[s.mut, s.mt2]}>{themeLabel}</Text>
          </View>
          <Text style={s.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.row, s.rowGap]}
          activeOpacity={0.7}
          accessibilityState={{expanded: pointsOpen}}
          onPress={() => setPointsOpen(v => !v)}>
          <View style={s.pinGlyph} />
          <View style={s.flex}>
            <Text style={s.rowName}>Saved addresses</Text>
            <Text style={[s.mut, s.mt2]}>{pointsSummary}</Text>
          </View>
          <Text style={[s.caret, pointsOpen && s.caretOpen]}>⌄</Text>
        </TouchableOpacity>

        {pointsOpen && (
          <View style={s.reveal}>
            <Text style={[s.mut, s.revealNote]}>
              Named starting points you can pick instead of your live location.
            </Text>
            {points.length === 0 ? (
              <Text style={s.emptyNote}>
                No saved addresses yet. Add one and it becomes a one-tap origin on the location
                sheet.
              </Text>
            ) : (
              <View style={s.stack}>
                {points.map(p => (
                  <View key={p.id} style={s.row}>
                    <View style={s.pinGlyph} />
                    <View style={s.flex}>
                      <Text style={s.rowName}>{p.label}</Text>
                      <Text style={s.mut} numberOfLines={1}>
                        {p.address}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={s.removeBtn}
                      accessibilityLabel="Remove address"
                      onPress={() => handleDeletePoint(p)}>
                      <Text style={s.removeX}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <Text style={s.lab}>Label</Text>
            <TextInput
              style={s.field}
              value={pointLabel}
              onChangeText={setPointLabel}
              placeholder="Home, Work, Mum's"
              placeholderTextColor={colors.placeholder}
              maxLength={60}
            />
            <Text style={[s.mut, s.fieldHint]}>
              Leave it blank and we'll use the first line of the address.
            </Text>
            <TouchableOpacity
              style={s.btnG}
              activeOpacity={0.8}
              disabled={savingPoint}
              onPress={() => setPickerOpen(true)}>
              {savingPoint ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={s.btnGText}>Add a starting point</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <Text style={[s.lab, s.labSpaced]}>Account</Text>
        <View style={s.stack}>
          <View style={s.row}>
            <View style={s.flex}>
              <Text style={s.mut}>Display name</Text>
              {editingName ? (
                <TextInput
                  style={s.inlineInput}
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoFocus
                  maxLength={60}
                  returnKeyType="done"
                  onSubmitEditing={handleSaveName}
                />
              ) : (
                <Text style={[s.rowName, s.mt2]}>{user?.name ?? 'Not set'}</Text>
              )}
            </View>
            <TouchableOpacity
              hitSlop={10}
              disabled={savingName}
              onPress={editingName ? handleSaveName : () => setEditingName(true)}>
              {savingName ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Text style={s.link}>{editingName ? 'Save' : 'Edit'}</Text>
              )}
            </TouchableOpacity>
          </View>
          <InfoRow label="Email" value={user?.email ?? 'Not set'} />
          <InfoRow label="Phone" value={user?.phone_number ?? 'Not set'} />
          <InfoRow label="Username" value={`@${user?.username ?? 'Not set'}`} />
        </View>

        <TouchableOpacity style={s.btnG} activeOpacity={0.8} onPress={handleLogout}>
          <Text style={[s.btnGText, s.logout]}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={settingsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSettingsOpen(false)}>
        <Pressable style={s.scrim} onPress={() => setSettingsOpen(false)} />
        <View style={s.sheet}>
          <View style={s.grab} />
          <Text style={s.sheetT}>Settings</Text>
          <Text style={s.lab}>Appearance</Text>
          <View style={s.segw}>
            {THEME_OPTIONS.map(o => {
              const on = o.id === themeName;
              return (
                <TouchableOpacity
                  key={o.id}
                  style={[s.seg, on && s.segOn]}
                  activeOpacity={0.8}
                  onPress={() => setThemeName(o.id)}>
                  <Text style={[s.segText, on && s.segTextOn]}>{o.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity style={s.btnG} activeOpacity={0.8} onPress={() => setSettingsOpen(false)}>
            <Text style={s.btnGText}>Done</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <LocationMapPicker
        visible={pickerOpen}
        onConfirm={handlePointPicked}
        onClose={() => setPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

function InfoRow({label, value}: {label: string; value: string}) {
  return (
    <View style={s.row}>
      <View style={s.flex}>
        <Text style={s.mut}>{label}</Text>
        <Text style={[s.rowName, s.mt2]}>{value}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  content: {padding: 20, paddingBottom: spacing.xxl},
  flex: {flex: 1, minWidth: 0},
  mt2: {marginTop: 2},

  h1: {fontFamily: fonts.bold, fontSize: 24, letterSpacing: -0.5, color: colors.text, marginBottom: 20},
  hero: {flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24},
  avatar: {width: 64, height: 64, borderRadius: 32},
  avatarFallback: {backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'},
  avatarText: {fontFamily: fonts.bold, fontSize: 24, color: colors.white},
  heroName: {fontFamily: fonts.bold, fontSize: 17, color: colors.text},
  mut: {fontFamily: fonts.regular, fontSize: 11.5, color: colors.textSecondary},

  stack: {gap: 10, marginBottom: 12},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: 11,
    paddingHorizontal: 12,
    minHeight: 56,
  },
  rowGap: {marginBottom: 8},
  rowIcon: {fontSize: 18, color: colors.primaryDeep, marginHorizontal: 4},
  rowName: {fontFamily: fonts.semibold, fontSize: 13.5, color: colors.text},
  chevron: {fontSize: 22, color: colors.textSecondary},
  caret: {fontSize: 16, color: colors.textSecondary, marginTop: -6},
  caretOpen: {transform: [{rotate: '180deg'}], marginTop: 6},
  pinGlyph: {
    width: 16,
    height: 16,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: '#009FAA',
    transform: [{rotate: '-45deg'}],
    marginHorizontal: 6,
  },

  reveal: {paddingLeft: 12, marginBottom: 20},
  revealNote: {marginBottom: 12, lineHeight: 17},
  emptyNote: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 12,
  },
  removeBtn: {width: 44, height: 44, marginRight: -9, alignItems: 'center', justifyContent: 'center'},
  removeX: {fontSize: 14, color: colors.textSecondary},

  lab: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 7,
  },
  labSpaced: {marginTop: 12},
  field: {
    backgroundColor: colors.sunken,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  fieldHint: {marginTop: 6, marginBottom: 12},
  inlineInput: {
    fontFamily: fonts.semibold,
    fontSize: 13.5,
    color: colors.text,
    paddingVertical: 2,
    marginTop: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
  },
  link: {fontFamily: fonts.bold, fontSize: 12, color: colors.primaryDeep},

  btnG: {
    minHeight: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  btnGText: {fontFamily: fonts.bold, fontSize: 15, color: colors.text},
  logout: {color: colors.error},

  scrim: {flex: 1, backgroundColor: colors.overlay},
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 34,
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 18,
  },
  sheetT: {fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginBottom: 14},
  segw: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceDim,
    marginBottom: 12,
  },
  seg: {flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center'},
  segOn: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 1,
  },
  segText: {fontFamily: fonts.bold, fontSize: 13, color: colors.textSecondary},
  segTextOn: {color: colors.text},
});
