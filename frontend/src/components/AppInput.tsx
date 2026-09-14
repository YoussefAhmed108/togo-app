import React, {useState} from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import {colors, fonts, radius, spacing, typography} from '../theme';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  isPassword?: boolean;
}

export function AppInput({label, error, isPassword, style, ...rest}: Props) {
  const [secure, setSecure] = useState(isPassword ?? false);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrapper}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.inputRow,
          focused && styles.focused,
          !!error && styles.errored,
        ]}>
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={colors.placeholder}
          secureTextEntry={secure}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
        {isPassword && (
          <TouchableOpacity
            onPress={() => setSecure(s => !s)}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={styles.toggle}>{secure ? 'Show' : 'Hide'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {marginBottom: spacing.md},
  label: {
    ...typography.label,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Only the auth screens use this field, and they sit on the page ground,
    // so the field is the white card surface rather than the sunken tone.
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  focused: {borderColor: colors.primary},
  errored: {borderColor: colors.error, backgroundColor: colors.errorLight},
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 14,
  },
  toggle: {fontFamily: fonts.bold, fontSize: 13, color: colors.primaryDeep},
  error: {...typography.caption, color: colors.error, marginTop: 6},
});
