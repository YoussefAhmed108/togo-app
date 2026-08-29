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
import {colors, fonts, radius, spacing, typography} from '../../theme';

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

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.heading}>What do you love?</Text>
          <Text style={styles.sub}>
            Pick your interests — you can change this any time.
          </Text>
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

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.continueBtn, selected.size === 0 && styles.continueBtnDisabled]}
            onPress={handleContinue}
            activeOpacity={0.85}
            disabled={loading || selected.size === 0}>
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.continueBtnText}>
                {selected.size === 0
                  ? 'Select interests to continue'
                  : `Continue with ${selected.size} interest${selected.size > 1 ? 's' : ''}`}
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

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },

  header: {alignItems: 'center', marginBottom: spacing.lg},
  heading: {...typography.h1, textAlign: 'center', marginBottom: 6},
  sub: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  card: {
    width: '48.4%',
    borderRadius: radius.lg,
    padding: spacing.md,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'transparent',
    minHeight: 128,
  },
  cardSelected: {borderColor: colors.primaryBorder},
  cardBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  cardBgSelected: {backgroundColor: colors.primaryLight},
  checkBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  checkText: {color: colors.white, fontSize: 13, fontFamily: fonts.bold},
  catEmoji: {fontSize: 26, marginBottom: 12},
  catLabel: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
    marginBottom: 4,
  },
  catLabelSelected: {color: colors.primaryDeep},
  catDesc: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  catDescSelected: {color: colors.textSecondary},

  actions: {gap: 2},
  continueBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnDisabled: {backgroundColor: colors.sandDeep},
  continueBtnText: {fontFamily: fonts.display, fontSize: 17, color: colors.white},
  skipBtn: {alignItems: 'center', paddingVertical: 14},
  skipBtnText: {fontFamily: fonts.regular, fontSize: 15, color: colors.textSecondary},
});
