import React, {useCallback, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {SpaceCard, NewSpaceCard, SpaceItem} from '../../components/home/SpaceCard';
import {apiSpaceToItem} from '../HomeScreen';
import {homeService} from '../../services/homeService';
import {AppStackParamList} from '../../types/navigation';
import {colors, fonts, spacing} from '../../theme';

type Nav = NativeStackNavigationProp<AppStackParamList>;

export default function SpacesScreen() {
  const navigation = useNavigation<Nav>();
  const [spaces, setSpaces] = useState<SpaceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      homeService
        .fetchSpaces()
        .then(data => setSpaces(data.map(apiSpaceToItem)))
        .catch(() => setSpaces([]))
        .finally(() => setLoading(false));
    }, []),
  );

  const openSpace = (item: SpaceItem) =>
    navigation.navigate('SpaceDetail', {
      spaceId: item.id,
      spaceName: item.name,
      spaceIcon: item.emoji,
      bannerUrl: item.bannerUrl ?? null,
    });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Text style={s.title}>Spaces</Text>
          <TouchableOpacity
            style={s.addBtn}
            accessibilityLabel="New space"
            activeOpacity={0.85}
            onPress={() => navigation.navigate('CreateSpace')}>
            <Text style={s.addPlus}>＋</Text>
          </TouchableOpacity>
        </View>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <View style={s.grid}>
            {spaces.map(item => (
              <SpaceCard key={item.id} item={item} style={s.cell} tall onPress={() => openSpace(item)} />
            ))}
            <NewSpaceCard style={s.cell} tall onPress={() => navigation.navigate('CreateSpace')} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  content: {padding: 20, paddingBottom: spacing.xl},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20},
  title: {fontFamily: fonts.bold, fontSize: 24, letterSpacing: -0.5, color: colors.text},
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlus: {fontSize: 20, color: colors.white},
  grid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16},
  cell: {width: '48%'},
});
