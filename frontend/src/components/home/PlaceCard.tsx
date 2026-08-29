import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {colors, fonts, radius, spacing} from '../../theme';
import {displayAddress} from '../../utils/address';

export interface PlaceItem {
  id: number;
  name: string;
  category: string;   // e.g. "Restaurant", "Park"
  address: string;
  distance?: string;  // e.g. "0.3 mi"
  emoji: string;      // representative category emoji
  tags?: string[];
}

interface Props {
  item: PlaceItem;
  onPress: (id: number) => void;
  /** Last row in a list — drops the hairline separator. */
  last?: boolean;
}

/** Soft tint behind the category emoji, keyed off the place category. */
export function categoryTint(category: string): string {
  const lower = category.toLowerCase();
  if (/park|outdoor|garden|nature|beach|hik/.test(lower)) return colors.sageTint;
  if (/cafe|coffee|bakery|deli|brunch/.test(lower)) return colors.blush;
  if (/bar|cocktail|wine|beer|night/.test(lower)) return colors.primaryLight;
  return colors.sand;
}

export function PlaceCard({item, onPress, last}: Props) {
  const meta = [item.category, item.distance, displayAddress(item.address)]
    .filter(Boolean)
    .join(' · ');

  return (
    <TouchableOpacity
      style={[styles.row, last && styles.rowLast]}
      activeOpacity={0.7}
      onPress={() => onPress(item.id)}>
      <View style={[styles.thumb, {backgroundColor: categoryTint(item.category)}]}>
        <Text style={styles.thumbEmoji}>{item.emoji}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLast: {borderBottomWidth: 0},
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  thumbEmoji: {fontSize: 24},
  body: {flex: 1},
  name: {fontFamily: fonts.semibold, fontSize: 16, color: colors.text},
  meta: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 3,
  },
  chevron: {fontSize: 24, color: colors.textMuted, marginLeft: spacing.sm},
});
