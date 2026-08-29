import React from 'react';
import {
  Image,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {colors, fonts, radius, spacing} from '../../theme';

export interface MemberPreviewItem {
  userId: number;
  name: string;
  avatarUrl: string | null;
}

export interface SpaceItem {
  id: number;
  name: string;
  memberCount: number;
  placeCount: number;
  memberPreviews: MemberPreviewItem[];
  accentColor: string;
  emoji: string;
  bannerUrl?: string | null;
}

interface Props {
  item: SpaceItem;
  onPress: (id: number) => void;
  /** Override the carousel sizing (e.g. to lay cards out in a grid). */
  style?: StyleProp<ViewStyle>;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function SpaceCard({item, onPress, style}: Props) {
  return (
    <TouchableOpacity
      style={[styles.wrap, style]}
      activeOpacity={0.85}
      onPress={() => onPress(item.id)}>
      <View style={[styles.tile, {backgroundColor: item.accentColor}]}>
        {item.bannerUrl ? (
          <Image source={{uri: item.bannerUrl}} style={styles.banner} />
        ) : (
          <Text style={styles.emoji}>{item.emoji}</Text>
        )}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {item.name}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {plural(item.memberCount, 'member')} · {plural(item.placeCount, 'place')}
      </Text>
    </TouchableOpacity>
  );
}

export function NewSpaceCard({onPress}: {onPress: () => void}) {
  return (
    <TouchableOpacity style={styles.wrap} activeOpacity={0.85} onPress={onPress}>
      <View style={[styles.tile, styles.tileNew]}>
        <Text style={styles.newPlus}>＋</Text>
      </View>
      <Text style={styles.name}>New space</Text>
      <Text style={styles.meta}>Start a shared list</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {width: 168, marginRight: spacing.md},
  tile: {
    height: 118,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 10,
  },
  tileNew: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  banner: {...StyleSheet.absoluteFillObject, resizeMode: 'cover'},
  emoji: {fontSize: 40},
  newPlus: {fontSize: 28, color: colors.textMuted},
  name: {fontFamily: fonts.semibold, fontSize: 16, color: colors.text},
  meta: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 3,
  },
});
