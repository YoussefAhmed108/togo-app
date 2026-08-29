import React from 'react';
import {StyleSheet, View} from 'react-native';
import {colors} from '../theme';

interface Props {
  size?: number;
  color?: string;
  /** Solid teardrop (map marker) vs. outlined ring (logo / inline icon). */
  filled?: boolean;
}

/**
 * ponytail: hand-rolled marker glyph instead of pulling in react-native-svg
 * for one icon. The teardrop is a square with three rounded corners, rotated
 * 45° so the square corner becomes the point.
 */
export function Pin({size = 24, color = colors.primary, filled = false}: Props) {
  const body = size * 0.8;
  const stroke = Math.max(1.5, size * 0.11);
  const dot = size * 0.24;

  return (
    <View style={[styles.wrap, {width: size, height: size * 1.06}]}>
      <View
        style={[
          styles.body,
          {
            width: body,
            height: body,
            borderTopLeftRadius: body / 2,
            borderTopRightRadius: body / 2,
            borderBottomRightRadius: body / 2,
            borderBottomLeftRadius: 0,
            borderWidth: filled ? 0 : stroke,
            borderColor: color,
            backgroundColor: filled ? color : 'transparent',
          },
        ]}>
        <View
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: filled ? colors.surface : color,
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {alignItems: 'center'},
  body: {
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{rotate: '-45deg'}],
  },
});
