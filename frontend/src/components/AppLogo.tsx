import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, fonts} from '../theme';

interface Props {
  size?: 'sm' | 'md' | 'lg';
  /** Hide the wordmark and show the mark only. */
  markOnly?: boolean;
  /** Wordmark colour — white when sitting on the teal header. */
  inkColor?: string;
  /** Ring the mark so teal-on-teal stays visible. */
  ringed?: boolean;
}

const sizes = {
  sm: {tile: 30, name: 19},
  md: {tile: 34, name: 21},
  lg: {tile: 56, name: 30},
};

const TEAL = '#00838E';
const VIOLET = '#6A69DB';
const VIOLET_SOFT = '#DBDBFF';

// Route W, in a 100-unit box: the W is a route through three stops,
// ending at a violet waypoint. Same geometry as the app icon.
const ROUTE: Array<[number, number]> = [[16, 30], [33, 72], [50, 42], [67, 72], [84, 30]];

/**
 * ponytail: drawn from rotated rounded views rather than SVG — no new native
 * dependency, sharp at any size. Round caps on each segment overlap into round joins.
 */
export function LogoMark({size, ringed}: {size: number; ringed?: boolean}) {
  const box = size * 0.733; // mark box inside the tile, as on the icon
  const off = (size - box) / 2;
  const u = box / 100;
  const detail = size >= 40; // small marks drop the white stops, as on the icon
  const stroke = (detail ? 9 : 10) * u;

  const segments = ROUTE.slice(1).map(([x2, y2], i) => {
    const [x1, y1] = ROUTE[i];
    const len = Math.hypot(x2 - x1, y2 - y1) * u;
    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const cx = off + ((x1 + x2) / 2) * u;
    const cy = off + ((y1 + y2) / 2) * u;
    const w = len + stroke;
    return {
      key: i,
      style: {
        left: cx - w / 2,
        top: cy - stroke / 2,
        width: w,
        height: stroke,
        borderRadius: stroke / 2,
        transform: [{rotate: `${angle}deg`}],
      },
    };
  });

  const dot = (x: number, y: number, r: number, color: string) => ({
    left: off + x * u - r * u,
    top: off + y * u - r * u,
    width: 2 * r * u,
    height: 2 * r * u,
    borderRadius: r * u,
    backgroundColor: color,
  });

  return (
    <View
      style={[
        s.tile,
        {width: size, height: size, borderRadius: size * 0.225},
        ringed && s.ring,
      ]}>
      {segments.map(seg => (
        <View key={seg.key} style={[s.abs, s.white, seg.style]} />
      ))}
      {detail && <View style={[s.abs, dot(16, 30, 8, colors.white)]} />}
      {detail && <View style={[s.abs, dot(50, 42, 8, colors.white)]} />}
      <View style={[s.abs, dot(84, 30, 11, VIOLET_SOFT)]} />
      <View style={[s.abs, dot(84, 30, 4.5, VIOLET)]} />
    </View>
  );
}

export function AppLogo({size = 'md', markOnly = false, inkColor, ringed}: Props) {
  const sz = sizes[size];
  return (
    <View style={s.row}>
      <LogoMark size={sz.tile} ringed={ringed} />
      {!markOnly && (
        <Text style={[s.name, {fontSize: sz.name, color: inkColor ?? colors.text}]}>
          Waypoint
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: 9},
  tile: {backgroundColor: TEAL, overflow: 'hidden'},
  ring: {borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)'},
  abs: {position: 'absolute'},
  white: {backgroundColor: colors.white},
  name: {fontFamily: fonts.bold, letterSpacing: -0.2},
});
