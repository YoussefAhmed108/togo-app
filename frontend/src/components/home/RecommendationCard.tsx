import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {colors, fonts, radius, spacing} from '../../theme';
import {categoryTint} from './PlaceCard';
import {displayAddress} from '../../utils/address';

export type RecommendationReason =
  | {type: 'fav'}
  | {type: 'space'; spaceName: string}
  | {type: 'interests'; label: string}
  | {type: 'space_area'; label: string};

export interface RecommendationItem {
  id: number;             // 0 = external (Google) place, not yet in DB
  name: string;
  category: string;
  address: string;
  distance?: string;
  emoji: string;
  reason: RecommendationReason;
  googlePlaceId?: string;
  lat?: number;
  lng?: number;
}

interface Props {
  item: RecommendationItem;
  onPress: (id: number) => void;
}

function reasonText(reason: RecommendationReason): string {
  switch (reason.type) {
    case 'fav':
      return 'Based on your saved places';
    case 'space':
      return `Popular near ${reason.spaceName}`;
    default:
      return reason.label;
  }
}

export function RecommendationCard({item, onPress}: Props) {
  const isSpace = item.reason.type === 'space' || item.reason.type === 'space_area';
  const reasonColor = isSpace ? colors.reasonSpace : colors.reasonFav;
  const meta = [item.category, item.distance, displayAddress(item.address)]
    .filter(Boolean)
    .join(' · ');

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => onPress(item.id)}>
      <View style={[styles.thumb, {backgroundColor: categoryTint(item.category)}]}>
        <Text style={styles.thumbEmoji}>{item.emoji}</Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.reason, {color: reasonColor}]} numberOfLines={1}>
          {reasonText(item.reason)}
        </Text>
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  thumbEmoji: {fontSize: 22},
  body: {flex: 1},
  reason: {fontFamily: fonts.semibold, fontSize: 12.5, marginBottom: 3},
  name: {fontFamily: fonts.semibold, fontSize: 17, color: colors.text},
  meta: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 3,
  },
  chevron: {fontSize: 24, color: colors.textMuted, marginLeft: spacing.sm},
});
