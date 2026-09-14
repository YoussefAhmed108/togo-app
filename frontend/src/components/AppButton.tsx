import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableOpacityProps,
} from 'react-native';
import {colors, fonts, radius} from '../theme';

interface Props extends TouchableOpacityProps {
  title: string;
  loading?: boolean;
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
}

export function AppButton({
  title,
  loading = false,
  variant = 'primary',
  size = 'md',
  disabled,
  style,
  ...rest
}: Props) {
  const isDisabled = disabled || loading;
  const spinnerColor = variant === 'primary' || variant === 'danger' ? colors.white : colors.primary;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      disabled={isDisabled}
      style={[
        styles.base,
        size === 'sm' && styles.baseSm,
        variant === 'primary' && styles.primary,
        variant === 'danger' && styles.danger,
        variant === 'outline' && styles.outline,
        variant === 'ghost' && styles.ghost,
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={spinnerColor} size="small" />
      ) : (
        <Text
          style={[
            styles.label,
            size === 'sm' && styles.labelSm,
            (variant === 'primary' || variant === 'danger') && styles.labelOnFill,
            variant === 'outline' && styles.labelOutline,
            variant === 'ghost' && styles.labelGhost,
            isDisabled && styles.labelDisabled,
          ]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  baseSm: {minHeight: 44, paddingHorizontal: 16},
  primary: {backgroundColor: colors.primary},
  danger: {backgroundColor: colors.error},
  // Design's ghost button (btnG): a white card-coloured slab, no border.
  outline: {backgroundColor: colors.surface},
  ghost: {backgroundColor: 'transparent'},
  disabled: {backgroundColor: colors.disabledBg},
  label: {fontFamily: fonts.bold, fontSize: 15, color: colors.text},
  labelSm: {fontSize: 13.5},
  labelOnFill: {color: colors.white},
  labelOutline: {color: colors.text},
  labelDisabled: {color: colors.disabledFg},
  labelGhost: {fontFamily: fonts.medium, color: colors.textSecondary},
});
