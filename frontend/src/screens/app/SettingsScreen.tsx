import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useAuth} from '../../hooks/useAuth';
import {useAppSettings} from '../../hooks/useAppSettings';
import {AppStackParamList} from '../../types/navigation';
import {colors, fonts, radius, spacing, THEME_OPTIONS} from '../../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'Settings'>;

export default function SettingsScreen({navigation}: Props) {
  const {user, signOut, updateDisplayName} = useAuth();
  const {themeName, setThemeName} = useAppSettings();

  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    setDisplayName(user?.name ?? '');
  }, [user?.name]);

  const handleSaveName = async () => {
    const nextName = displayName.trim();
    if (!nextName) {
      Alert.alert('Display Name Required', 'Please enter a display name.');
      return;
    }

    if (nextName === (user?.name ?? '')) return;

    setSavingName(true);
    try {
      await updateDisplayName(nextName);
      Alert.alert('Saved', 'Your display name has been updated.');
    } catch (err: any) {
      const message = err?.response?.data?.error ?? err?.message ?? 'Could not update your display name.';
      Alert.alert('Update Failed', message);
    } finally {
      setSavingName(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Do you want to end this session on this device?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: () => {
          signOut();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={s.headerBtn}>
          <Text style={s.headerBtnIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Settings</Text>
        <View style={s.headerBtn} />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <View style={s.avatarBubble}>
            <Text style={s.avatarText}>
              {(user?.name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}
            </Text>
          </View>
          <Text style={s.heroName}>{user?.name ?? 'Profile'}</Text>
          <Text style={s.heroSub}>@{user?.username ?? 'username'}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Appearance</Text>
          <Text style={s.cardSub}>Pick the mood of the app on this device.</Text>
          <View style={s.themeGrid}>
            {THEME_OPTIONS.map(option => {
              const active = option.id === themeName;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[s.themeCard, active && s.themeCardActive]}
                  activeOpacity={0.85}
                  onPress={() => setThemeName(option.id)}>
                  <View style={s.themePreviewRow}>
                    {option.swatches.map(c => (
                      <View key={c} style={[s.themeSwatch, {backgroundColor: c}]} />
                    ))}
                  </View>
                  <Text style={s.themeName}>{option.name}</Text>
                  <Text style={s.themeDesc}>{option.description}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Profile</Text>
          <Text style={s.label}>DISPLAY NAME</Text>
          <View style={s.editRow}>
            <TextInput
              style={s.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Display name"
              placeholderTextColor={colors.placeholder}
              maxLength={60}
            />
            <TouchableOpacity
              style={[s.inlineBtn, savingName && s.inlineBtnDisabled]}
              activeOpacity={0.85}
              onPress={handleSaveName}
              disabled={savingName}>
              {savingName ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={s.inlineBtnText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={s.infoList}>
            <View style={s.infoRow}>
              <Text style={s.infoKey}>Email</Text>
              <Text style={s.infoValue}>{user?.email ?? 'Not set'}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoKey}>Phone</Text>
              <Text style={s.infoValue}>{user?.phone_number ?? 'Not set'}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoKey}>Username</Text>
              <Text style={s.infoValue}>@{user?.username ?? 'Not set'}</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={s.logoutBtn} activeOpacity={0.85} onPress={handleLogout}>
          <Text style={s.logoutBtnText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnIcon: {fontSize: 28, color: colors.primary, lineHeight: 30},
  headerTitle: {fontFamily: fonts.display, fontSize: 19, color: colors.text},

  scroll: {flex: 1},
  content: {paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl},

  hero: {alignItems: 'center', paddingVertical: spacing.lg, marginBottom: spacing.sm},
  avatarBubble: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginBottom: spacing.md,
  },
  avatarText: {fontFamily: fonts.display, fontSize: 32, color: colors.white},
  heroName: {fontFamily: fonts.display, fontSize: 26, color: colors.text, marginBottom: 6},
  heroSub: {fontFamily: fonts.regular, fontSize: 15, color: colors.textSecondary},

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardTitle: {fontFamily: fonts.display, fontSize: 21, color: colors.text, marginBottom: 4},
  cardSub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },

  themeGrid: {flexDirection: 'row', gap: spacing.sm},
  themeCard: {
    flex: 1,
    backgroundColor: colors.sand,
    borderRadius: radius.lg,
    padding: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  themeCardActive: {
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primaryLight,
  },
  themePreviewRow: {flexDirection: 'row', gap: 5, marginBottom: 10},
  themeSwatch: {flex: 1, height: 26, borderRadius: 8},
  themeName: {fontFamily: fonts.semibold, fontSize: 14, color: colors.text, marginBottom: 2},
  themeDesc: {fontFamily: fonts.regular, fontSize: 11.5, color: colors.textSecondary},

  label: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  editRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md},
  input: {
    flex: 1,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.sand,
    color: colors.text,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.regular,
    fontSize: 16,
  },
  inlineBtn: {
    height: 52,
    minWidth: 88,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineBtnDisabled: {opacity: 0.55},
  inlineBtnText: {fontFamily: fonts.display, fontSize: 16, color: colors.white},

  infoList: {borderRadius: radius.md, overflow: 'hidden'},
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    backgroundColor: colors.sand,
    borderBottomWidth: 1,
    borderBottomColor: colors.sandDeep,
  },
  infoKey: {fontFamily: fonts.regular, fontSize: 15, color: colors.textSecondary},
  infoValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
  },

  logoutBtn: {
    marginTop: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.error,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtnText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},
});
