import React, {useState} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppButton} from '../../components/AppButton';
import {AppInput} from '../../components/AppInput';
import {AppLogo} from '../../components/AppLogo';
import {ErrorBanner} from '../../components/ErrorBanner';
import {useAuth} from '../../hooks/useAuth';
import {colors, fonts, radius, shadows, spacing, typography} from '../../theme';
import {AuthStackParamList} from '../../types/navigation';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginScreen({navigation}: Props) {
  const {signIn} = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{email?: string; password?: string}>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate() {
    const e: typeof errors = {};
    if (!email.trim()) {
      e.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      e.email = 'Enter a valid email address';
    }
    if (!password) {
      e.password = 'Password is required';
    } else if (password.length < 8) {
      e.password = 'Password must be at least 8 characters';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleLogin() {
    if (!validate()) return;
    setApiError(null);
    setLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      // Navigation handled automatically by RootNavigator based on auth state
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ?? 'Something went wrong. Please try again.';
      setApiError(
        msg === 'invalid credentials'
          ? 'Incorrect email or password.'
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

          {/* Logo */}
          <View style={styles.logoArea}>
            <AppLogo size="lg" />
            <Text style={styles.tagline}>Your places, your memories.</Text>
          </View>

          {/* Form card */}
          <View style={styles.card}>
            <Text style={styles.heading}>Welcome back</Text>
            <Text style={styles.sub}>Sign in to your account</Text>

            <ErrorBanner message={apiError} />

            <AppInput
              label="Email"
              placeholder="you@example.com"
              keyboardType="email-address"
              value={email}
              onChangeText={t => {
                setEmail(t);
                setErrors(e => ({...e, email: undefined}));
              }}
              error={errors.email}
            />

            <AppInput
              label="Password"
              placeholder="••••••••"
              isPassword
              value={password}
              onChangeText={t => {
                setPassword(t);
                setErrors(e => ({...e, password: undefined}));
              }}
              error={errors.password}
            />

            <AppButton
              title="Sign In"
              loading={loading}
              onPress={handleLogin}
              style={styles.submitBtn}
            />
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
              <Text style={styles.footerLink}>Create one</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1},
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  tagline: {
    fontFamily: fonts.regular,
    fontSize: 15,
    marginTop: spacing.md,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 26,
    ...shadows.card,
  },
  heading: {
    ...typography.h1,
    marginBottom: 2,
  },
  sub: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  submitBtn: {
    marginTop: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  footerText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
  },
  footerLink: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.primary,
  },
});
