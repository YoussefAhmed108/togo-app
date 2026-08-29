import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect} from '@react-navigation/native';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Pin} from '../../components/Pin';
import {SpaceCard, SpaceItem} from '../../components/home/SpaceCard';
import {PlaceCard, PlaceItem} from '../../components/home/PlaceCard';
import {apiSpaceToItem, apiPlaceToItem} from '../HomeScreen';
import {homeService} from '../../services/homeService';
import {AppStackParamList} from '../../types/navigation';
import {colors, fonts, radius, spacing} from '../../theme';

type Props = NativeStackScreenProps<AppStackParamList, 'SeeAll'>;

export default function SeeAllScreen({route, navigation}: Props) {
  const {kind} = route.params;
  const isSpaces = kind === 'spaces';

  const [spaces, setSpaces] = useState<SpaceItem[]>([]);
  const [places, setPlaces] = useState<PlaceItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      if (isSpaces) {
        setSpaces((await homeService.fetchSpaces()).map(apiSpaceToItem));
      } else {
        setPlaces((await homeService.fetchPlaces()).map(apiPlaceToItem));
      }
    } catch {
      setSpaces([]);
      setPlaces([]);
    } finally {
      setLoading(false);
    }
  }, [isSpaces]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const count = isSpaces ? spaces.length : places.length;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={s.backBtn}>
          <Text style={s.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isSpaces ? 'Spaces' : 'Saved places'}</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={s.loader} />
        ) : count === 0 ? (
          <View style={s.empty}>
            <Pin size={26} color={colors.textMuted} />
            <Text style={s.emptyTitle}>
              {isSpaces ? 'No spaces yet' : 'No saved places yet'}
            </Text>
            <Text style={s.emptyBody}>
              {isSpaces
                ? 'Create a shared space with friends to plan and save places together.'
                : 'Start building your personal list of places you want to visit.'}
            </Text>
            <TouchableOpacity
              style={s.emptyBtn}
              activeOpacity={0.8}
              onPress={() => navigation.navigate(isSpaces ? 'CreateSpace' : 'CreatePlace')}>
              <Text style={s.emptyBtnText}>
                {isSpaces ? '+ Create a space' : '+ Add a place'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={s.count}>
              {count} {isSpaces ? (count === 1 ? 'space' : 'spaces') : count === 1 ? 'place' : 'places'}
            </Text>

            {isSpaces ? (
              <View style={s.grid}>
                {spaces.map(item => (
                  <SpaceCard
                    key={item.id}
                    item={item}
                    style={s.gridCard}
                    onPress={id => {
                      const sp = spaces.find(x => x.id === id);
                      if (!sp) return;
                      navigation.navigate('SpaceDetail', {
                        spaceId: id,
                        spaceName: sp.name,
                        spaceIcon: sp.emoji,
                        bannerUrl: sp.bannerUrl ?? null,
                      });
                    }}
                  />
                ))}
              </View>
            ) : (
              places.map((item, idx) => (
                <PlaceCard
                  key={item.id}
                  item={item}
                  last={idx === places.length - 1}
                  onPress={() =>
                    navigation.navigate('PlaceDetail', {
                      placeId: item.id,
                      placeName: item.name,
                    })
                  }
                />
              ))
            )}
          </>
        )}

        <View style={s.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  backBtn: {width: 36, alignItems: 'center', justifyContent: 'center'},
  backIcon: {fontSize: 28, color: colors.primary, lineHeight: 30},
  headerTitle: {fontFamily: fonts.display, fontSize: 19, color: colors.text},

  content: {paddingHorizontal: spacing.lg, paddingTop: spacing.sm},
  loader: {marginTop: spacing.xl},
  count: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.lg,
  },
  gridCard: {width: '47.5%', marginRight: 0},

  empty: {
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: 6,
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyBtn: {
    marginTop: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
  },
  emptyBtnText: {fontFamily: fonts.semibold, fontSize: 15, color: colors.primary},

  bottomPad: {height: spacing.xl},
});
