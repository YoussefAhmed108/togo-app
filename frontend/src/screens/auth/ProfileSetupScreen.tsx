import React, {useState} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppButton} from '../../components/AppButton';
import {AppInput} from '../../components/AppInput';
import {ErrorBanner} from '../../components/ErrorBanner';
import {useAuth} from '../../hooks/useAuth';
import {colors, fonts, radius, shadows, spacing, typography} from '../../theme';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function ProfileSetupScreen() {
  const {completeProfile} = useAuth();

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [errors, setErrors] = useState<{name?: string; username?: string}>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate() {
    const e: typeof errors = {};
    if (!name.trim()) {
      e.name = 'Display name is required';
    }
    if (!username.trim()) {
      e.username = 'Username is required';
    } else if (!USERNAME_RE.test(username.trim())) {
      e.username = '3–20 characters: letters, numbers, underscores only';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleContinue() {
    if (!validate()) return;
    setApiError(null);
    setLoading(true);
    try {
      await completeProfile(name.trim(), username.trim().toLowerCase());
      // Auth state updates → RootNavigator switches to AppNavigator automatically
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ?? 'Something went wrong. Please try again.';
      setApiError(
        msg === 'username already taken'
          ? 'That username is already taken. Pick another one.'
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.emojiCircle}>
              <Text style={styles.emoji}>👥</Text>
            </View>
            <Text style={styles.heading}>One last step</Text>
            <Text style={styles.sub}>
              Tell people who you are.
            </Text>
          </View>

          {/* Form card */}
          <View style={styles.card}>
            <ErrorBanner message={apiError} />

            <AppInput
              label="Display Name"
              placeholder="How you'll appear to others"
              value={name}
              onChangeText={t => {
                setName(t);
                setErrors(e => ({...e, name: undefined}));
              }}
              error={errors.name}
              maxLength={60}
            />

            <AppInput
              label="Username"
              placeholder="e.g. alice_wanders"
              value={username}
              onChangeText={t => {
                setUsername(t.toLowerCase());
                setErrors(e => ({...e, username: undefined}));
              }}
              error={errors.username}
              maxLength={20}
            />

            <View style={styles.hint}>
              <Text style={styles.hintText}>
                Letters, numbers and underscores.
              </Text>
            </View>

            <AppButton
              title="Continue"
              loading={loading}
              onPress={handleContinue}
              style={styles.submitBtn}
            />
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1},
  scroll: {flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: 72, paddingBottom: spacing.xl},
  header: {alignItems: 'flex-start', marginBottom: spacing.lg},
  emojiCircle: {marginBottom: 14},
  emoji: {fontSize: 34},
  heading: {...typography.h1, marginBottom: 6},
  sub: {fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.textSecondary},
  card: {marginTop: spacing.sm},
  hint: {marginTop: -8, marginBottom: spacing.md},
  hintText: {fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: colors.textSecondary},
  submitBtn: {marginTop: spacing.xs},
});
