import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, fonts, radius, spacing} from '../theme';

interface Props {
  message: string | null;
}

export function ErrorBanner({message}: Props) {
  if (!message) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.errorLight,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  text: {fontFamily: fonts.regular, fontSize: 15, color: colors.error},
});
