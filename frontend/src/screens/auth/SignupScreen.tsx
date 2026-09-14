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
import {colors, fonts, radius, shadows, spacing, typography} from '../../theme';
import {AuthStackParamList} from '../../types/navigation';

type Props = NativeStackScreenProps<AuthStackParamList, 'Signup'>;

export function SignupScreen({navigation}: Props) {
  const {signUp} = useAuth();

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{
    email?: string;
    phone?: string;
    password?: string;
    confirm?: string;
  }>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate() {
    const e: typeof errors = {};
    if (!email.trim()) {
      e.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      e.email = 'Enter a valid email address';
    }
    const rawPhone = phone.trim().replace(/\s/g, '');
    if (!rawPhone) {
      e.phone = 'Phone number is required';
    } else if (!/^\+?[0-9\-().]{7,20}$/.test(rawPhone)) {
      e.phone = 'Enter a valid phone number';
    }
    if (!password) {
      e.password = 'Password is required';
    } else if (password.length < 8) {
      e.password = 'Must be at least 8 characters';
    }
    if (!confirm) {
      e.confirm = 'Please confirm your password';
    } else if (confirm !== password) {
      e.confirm = 'Passwords do not match';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSignup() {
    if (!validate()) return;
    setApiError(null);
    setLoading(true);
    try {
      await signUp(email.trim().toLowerCase(), password, phone.trim());
      // AuthContext sets isProfileComplete = false → RootNavigator shows ProfileSetup
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ?? 'Something went wrong. Please try again.';
      setApiError(
        msg === 'unable to create account'
          ? "We couldn't create an account with these details. If you already have one, try logging in."
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}>
          {/* The sign-in map, shorter: same place, one step further in. */}
          <AuthMapHero height={220} onBack={() => navigation.navigate('Login')} />

          {/* Form card */}
          <View style={styles.card}>
            <Text style={styles.heading}>Create account</Text>
            <Text style={styles.sub}>It's free and takes 30 seconds.</Text>

            <ErrorBanner message={apiError} />

            <AppInput
              placeholder="Email"
              keyboardType="email-address"
              value={email}
              onChangeText={t => {
                setEmail(t);
                setErrors(e => ({...e, email: undefined}));
              }}
              error={errors.email}
            />

            <AppInput
              placeholder="Phone number"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={t => {
                setPhone(t);
                setErrors(e => ({...e, phone: undefined}));
              }}
              error={errors.phone}
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

            {/* Password strength hint */}
            <PasswordStrength password={password} />

            <AppInput
              placeholder="Confirm password"
              isPassword
              value={confirm}
              onChangeText={t => {
                setConfirm(t);
                setErrors(e => ({...e, confirm: undefined}));
              }}
              error={errors.confirm}
            />

            <AppButton
              title="Create account"
              loading={loading}
              onPress={handleSignup}
              style={styles.submitBtn}
            />

            <Text style={styles.terms}>
              By continuing you agree to our{' '}
              <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
              <Text style={styles.termsLink}>Privacy Policy</Text>.
            </Text>
          </View>


        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Password strength indicator ─────────────────────────────────────────────
function PasswordStrength({password}: {password: string}) {
  const len = password.length;
  const strength =
    len === 0 ? 0 : len < 8 ? 1 : len < 12 ? 2 : 3;
  const labels = ['', 'Weak', 'Good', 'Strong'];
  const barColors = [colors.border, colors.error, colors.sage, colors.sage];

  if (len === 0) return null;

  return (
    <View style={ps.container}>
      <View style={ps.bars}>
        {[1, 2, 3].map(i => (
          <View
            key={i}
            style={[
              ps.bar,
              {backgroundColor: strength >= i ? barColors[strength] : colors.border},
            ]}
          />
        ))}
      </View>
      <Text style={[ps.label, {color: barColors[strength]}]}>
        {labels[strength]}
      </Text>
    </View>
  );
}

const ps = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  bars: {flexDirection: 'row', gap: 6, flex: 1},
  bar: {flex: 1, height: 3, borderRadius: 9999},
  label: {fontFamily: fonts.semibold, fontSize: 13, minWidth: 48, textAlign: 'right'},
});

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1},
  scroll: {flexGrow: 1, paddingBottom: spacing.xl},
  back: {width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center', marginBottom: 20},
  backIcon: {fontSize: 30, color: colors.text, lineHeight: 32},
  card: {paddingHorizontal: 24, marginTop: -30},
  heading: {fontFamily: fonts.bold, fontSize: 30, lineHeight: 32, letterSpacing: -0.9, color: colors.text, marginBottom: 2},
  sub: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  submitBtn: {marginTop: spacing.sm},
  terms: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  termsLink: {color: colors.primary},
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  footerText: {fontFamily: fonts.regular, fontSize: 15, color: colors.textSecondary},
  footerLink: {fontFamily: fonts.display, fontSize: 15, color: colors.primary},
});
