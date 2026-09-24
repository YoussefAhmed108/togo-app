import React, {useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useAuth} from '../../hooks/useAuth';
import {colors, fonts, radius, spacing, typography, themedStyles} from '../../theme';

interface Category {
  slug: string;
  label: string;
  emoji: string;
  description: string;
}

const CATEGORIES: Category[] = [
  {slug: 'food',          label: 'Food & Dining',     emoji: '🍽️', description: 'Restaurants, street food, local eats'},
  {slug: 'coffee',        label: 'Coffee & Cafés',    emoji: '☕',  description: 'Cafés, bakeries, brunch spots'},
  {slug: 'outdoors',      label: 'Outdoors & Parks',  emoji: '🌳', description: 'Parks, hikes, beaches, nature'},
  {slug: 'arts',          label: 'Arts & Culture',    emoji: '🎨', description: 'Museums, galleries, exhibitions'},
  {slug: 'shopping',      label: 'Shopping',          emoji: '🛍️', description: 'Malls, markets, boutiques'},
  {slug: 'nightlife',     label: 'Bars & Nightlife',  emoji: '🍸', description: 'Bars, clubs, rooftops'},
  {slug: 'wellness',      label: 'Wellness & Fitness',emoji: '💆', description: 'Spas, gyms, yoga'},
  {slug: 'entertainment', label: 'Entertainment',     emoji: '🎬', description: 'Cinemas, theatres, concerts'},
];

export function InterestPickerScreen() {
  const {saveInterests} = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  function toggle(slug: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }

  async function handleContinue() {
    setLoading(true);
    try {
      await saveInterests(Array.from(selected));
    } finally {
      setLoading(false);
    }
  }

  async function handleSkip() {
    setLoading(true);
    try {
      await saveInterests([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <Text style={styles.sparkle}>✨</Text>
          <Text style={styles.heading}>What do you love?</Text>
          <Text style={styles.sub}>We'll use this to recommend places.</Text>
        </View>

        {/* Grid of category pills */}
        <View style={styles.grid}>
          {CATEGORIES.map(cat => {
            const isSelected = selected.has(cat.slug);
            return (
              <TouchableOpacity
                key={cat.slug}
                style={[styles.card, isSelected && styles.cardSelected]}
                onPress={() => toggle(cat.slug)}
                activeOpacity={0.8}>

                {/* Background layer */}
                <View style={[styles.cardBg, isSelected && styles.cardBgSelected]} />

                {/* Selected checkmark */}
                {isSelected && (
                  <View style={styles.checkBadge}>
                    <Text style={styles.checkText}>✓</Text>
                  </View>
                )}

                <Text style={styles.catEmoji}>{cat.emoji}</Text>
                <Text style={[styles.catLabel, isSelected && styles.catLabelSelected]}>
                  {cat.label}
                </Text>
                <Text style={[styles.catDesc, isSelected && styles.catDescSelected]} numberOfLines={2}>
                  {cat.description}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

      </ScrollView>

      {/* Pinned footer: the choice is always one tap away however far you scroll. */}
      <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.continueBtn, selected.size === 0 && styles.continueBtnDisabled]}
            onPress={handleContinue}
            activeOpacity={0.85}
            disabled={loading || selected.size === 0}>
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={[styles.continueBtnText, selected.size === 0 && styles.continueBtnTextOff]}>
                {selected.size === 0
                  ? 'Continue'
                  : `Continue with ${selected.size} selected`}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipBtn}
            onPress={handleSkip}
            activeOpacity={0.7}
            disabled={loading}>
            <Text style={styles.skipBtnText}>Skip for now</Text>
          </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  safe: {flex: 1, backgroundColor: colors.background},
  scroll: {flexGrow: 1, paddingHorizontal: 20, paddingTop: 48, paddingBottom: spacing.lg},

  header: {alignItems: 'flex-start', marginBottom: 22},
  sparkle: {fontSize: 30},
  heading: {...typography.h1, marginTop: 12, marginBottom: 6},
  sub: {fontFamily: fonts.regular, fontSize: 13, color: colors.textSecondary},

  grid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12},
  card: {width: '48.4%', borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 12, overflow: 'hidden', borderWidth: 1.5, borderColor: 'transparent'},
  cardSelected: {borderColor: colors.primary},
  cardBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  cardBgSelected: {backgroundColor: colors.primaryLight},
  checkBadge: {position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', zIndex: 1},
  checkText: {color: colors.white, fontSize: 11, fontFamily: fonts.bold},
  catEmoji: {fontSize: 22, marginBottom: 8},
  catLabel: {fontFamily: fonts.bold, fontSize: 13.5, color: colors.text, marginBottom: 2},
  catLabelSelected: {color: colors.text},
  catDesc: {fontFamily: fonts.regular, fontSize: 11.5, color: colors.textSecondary, lineHeight: 16},
  catDescSelected: {color: colors.textSecondary},

  actions: {paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border},
  continueBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnDisabled: {backgroundColor: colors.disabledBg},
  continueBtnTextOff: {color: colors.disabledFg},
  continueBtnText: {fontFamily: fonts.bold, fontSize: 15, color: colors.white},
  skipBtn: {alignItems: 'center', paddingTop: 12, minHeight: 40},
  skipBtnText: {fontFamily: fonts.semibold, fontSize: 13, color: colors.textSecondary},
}));
