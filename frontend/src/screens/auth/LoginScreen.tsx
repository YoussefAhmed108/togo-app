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
import {AppButton} from '../../components/AppButton';
import {AppInput} from '../../components/AppInput';
import {AuthMapHero} from '../../components/AuthMapHero';
import {ErrorBanner} from '../../components/ErrorBanner';
import {useAuth} from '../../hooks/useAuth';
import {colors, fonts, spacing} from '../../theme';
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
      setApiError(msg === 'invalid credentials' ? 'Incorrect email or password.' : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}>
          <AuthMapHero height={470} showCaptureCard />

          <View style={styles.form}>
            <Text style={styles.heading}>Your city, already saved.</Text>
            <Text style={styles.sub}>Sign in to your places and spaces.</Text>

            <ErrorBanner message={apiError} />

            <AppInput
              placeholder="you@email.com"
              keyboardType="email-address"
              value={email}
              onChangeText={t => {
                setEmail(t);
                setErrors(e => ({...e, email: undefined}));
              }}
              error={errors.email}
            />

            <AppInput
              placeholder="Password"
              isPassword
              value={password}
              onChangeText={t => {
                setPassword(t);
                setErrors(e => ({...e, password: undefined}));
              }}
              error={errors.password}
            />

            <AppButton
              title="Sign in"
              loading={loading}
              onPress={handleLogin}
              style={styles.submitBtn}
            />

            <View style={styles.footer}>
              <Text style={styles.footerText}>Don't have an account? </Text>
              <TouchableOpacity hitSlop={10} onPress={() => navigation.navigate('Signup')}>
                <Text style={styles.footerLink}>Create one</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1},
  scroll: {flexGrow: 1, paddingBottom: spacing.xl},
  // The form rises into the map's fade.
  form: {paddingHorizontal: 24, marginTop: -42},
  heading: {
    fontFamily: fonts.bold,
    fontSize: 30,
    lineHeight: 32,
    letterSpacing: -0.9,
    color: colors.text,
  },
  sub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 8,
    marginBottom: 24,
  },
  submitBtn: {marginTop: 6},
  footer: {flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20},
  footerText: {fontFamily: fonts.regular, fontSize: 13, color: colors.textSecondary},
  footerLink: {fontFamily: fonts.bold, fontSize: 13, color: colors.primary},
});
