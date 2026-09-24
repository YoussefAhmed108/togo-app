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
import {colors, fonts, radius, themedStyles} from '../../theme';

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
  style?: StyleProp<ViewStyle>;
  /** Spaces tab: taller tile and a plain stat line instead of the member pill. */
  tall?: boolean;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// Space tiles wear the violet secondary: violet = people and spaces.
export function SpaceCard({item, onPress, style, tall}: Props) {
  return (
    <TouchableOpacity style={style} activeOpacity={0.85} onPress={() => onPress(item.id)}>
      <View style={[styles.tile, tall && styles.tileTall]}>
        {item.bannerUrl ? (
          <Image source={{uri: item.bannerUrl}} style={styles.banner} />
        ) : (
          <Text style={styles.emoji}>{item.emoji}</Text>
        )}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {item.name}
      </Text>
      {tall ? (
        <Text style={styles.meta} numberOfLines={1}>
          {plural(item.memberCount, 'member')} · {plural(item.placeCount, 'place')}
        </Text>
      ) : (
        <View style={styles.pill}>
          <Text style={styles.pillText}>{plural(item.memberCount, 'member')}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function NewSpaceCard({
  onPress,
  style,
  tall,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  tall?: boolean;
}) {
  return (
    <TouchableOpacity style={style} activeOpacity={0.85} onPress={onPress}>
      <View style={[styles.tile, styles.tileNew, tall && styles.tileTall]}>
        <Text style={styles.newPlus}>＋</Text>
        <Text style={styles.newLabel}>New space</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = themedStyles(() => ({
  tile: {
    height: 100,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tileTall: {height: 118},
  tileNew: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    gap: 4,
  },
  banner: {...StyleSheet.absoluteFillObject, resizeMode: 'cover'},
  emoji: {fontSize: 34},
  newPlus: {fontSize: 20, color: colors.textSecondary},
  newLabel: {fontFamily: fonts.semibold, fontSize: 11.5, color: colors.textSecondary},
  name: {fontFamily: fonts.bold, fontSize: 13, color: colors.text, marginTop: 8},
  meta: {fontFamily: fonts.regular, fontSize: 11.5, color: colors.textSecondary, marginTop: 2},
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  pillText: {fontFamily: fonts.semibold, fontSize: 11, color: colors.white},
}));
