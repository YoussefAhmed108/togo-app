import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, fonts} from '../theme';
import {Pin} from './Pin';

interface Props {
  size?: 'sm' | 'md' | 'lg';
  /** Hide the wordmark and show the tile only. */
  markOnly?: boolean;
}

const sizes = {
  sm: {tile: 48, pin: 22, name: 20},
  md: {tile: 66, pin: 30, name: 26},
  lg: {tile: 88, pin: 40, name: 32},
};

export function AppLogo({size = 'md', markOnly = false}: Props) {
  const s = sizes[size];
  return (
    <View style={styles.container}>
      <View
        style={[
          styles.tile,
          {width: s.tile, height: s.tile, borderRadius: s.tile * 0.3},
        ]}>
        <Pin size={s.pin} color={colors.white} />
      </View>
      {!markOnly && <Text style={[styles.name, {fontSize: s.name}]}>togolist</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {alignItems: 'center', gap: 14},
  tile: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {fontFamily: fonts.display, color: colors.text},
});
