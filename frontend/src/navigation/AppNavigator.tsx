import React, {useEffect} from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {TabNavigator} from './TabNavigator';
import CreateSpaceScreen from '../screens/app/CreateSpaceScreen';
import CreatePlaceScreen from '../screens/app/CreatePlaceScreen';
import ReviewPlacesScreen from '../screens/app/ReviewPlacesScreen';
import SpaceScreen from '../screens/app/SpaceScreen';
import PlaceScreen from '../screens/app/PlaceScreen';
import {AppStackParamList} from '../types/navigation';
import {colors, fonts} from '../theme';
import {useAppSettings} from '../hooks/useAppSettings';
import {consumePendingTikTokURL} from '../config/deepLink';

const Stack = createNativeStackNavigator<AppStackParamList>();

export function AppNavigator() {
  const {themeName} = useAppSettings();

  return (
    <>
      <PendingShareHandler />
      <AppStack themeName={themeName} />
    </>
  );
}

/**
 * A TikTok shared while logged out cannot resolve to CreatePlace, because this
 * navigator was not mounted yet. Once it is, replay the parked link so the
 * share is not silently lost.
 */
function PendingShareHandler() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();

  useEffect(() => {
    const tiktokUrl = consumePendingTikTokURL();
    if (tiktokUrl) {
      navigation.navigate('CreatePlace', {tiktokUrl});
    }
  }, [navigation]);

  return null;
}

function AppStack({themeName}: {themeName: string}) {

  return (
    <Stack.Navigator
      key={themeName}
      screenOptions={{
        headerStyle: {backgroundColor: colors.background},
        headerTitleStyle: {color: colors.text, fontFamily: fonts.display},
        headerTintColor: colors.primary,
      }}>
      <Stack.Screen
        name="Tabs"
        component={TabNavigator}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="CreateSpace"
        component={CreateSpaceScreen}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="CreatePlace"
        component={CreatePlaceScreen}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="ReviewPlaces"
        component={ReviewPlacesScreen}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="SpaceDetail"
        component={SpaceScreen}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="PlaceDetail"
        component={PlaceScreen}
        options={{headerShown: false}}
      />
    </Stack.Navigator>
  );
}
