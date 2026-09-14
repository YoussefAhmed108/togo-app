import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import HomeScreen from '../screens/HomeScreen';
import MapScreen from '../screens/app/MapScreen';
import SpacesScreen from '../screens/app/SpacesScreen';
import SettingsScreen from '../screens/app/SettingsScreen';
import {TabParamList} from '../types/navigation';
import {colors, fonts} from '../theme';

const Tab = createBottomTabNavigator<TabParamList>();

// ponytail: emoji glyphs instead of the design's line icons — no new native
// dependency. Swap for react-native-svg icons when the tab bar needs them.
const ICONS: Record<keyof TabParamList, string> = {
  Home: '🏠',
  Map: '🗺️',
  Spaces: '👥',
  Account: '👤',
};

function TabIcon({name, focused}: {name: keyof TabParamList; focused: boolean}) {
  return (
    <View style={s.icon}>
      <Text style={[s.glyph, !focused && s.glyphIdle]}>{ICONS[name]}</Text>
    </View>
  );
}

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({route}) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primaryDeep,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: s.bar,
        tabBarLabelStyle: s.label,
        tabBarIcon: ({focused}) => <TabIcon name={route.name} focused={focused} />,
      })}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen name="Spaces" component={SpacesScreen} />
      <Tab.Screen
        name="Account"
        component={SettingsScreen as React.ComponentType}
        options={{title: 'Profile'}}
      />
    </Tab.Navigator>
  );
}

const s = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    height: 84,
    paddingTop: 6,
  },
  label: {fontFamily: fonts.semibold, fontSize: 11},
  icon: {alignItems: 'center', justifyContent: 'center'},
  glyph: {fontSize: 19},
  glyphIdle: {opacity: 0.4},
});
