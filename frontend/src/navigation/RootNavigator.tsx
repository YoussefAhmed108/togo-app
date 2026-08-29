import React from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useAuth} from '../hooks/useAuth';
import {useAppSettings} from '../hooks/useAppSettings';
import {AuthNavigator} from './AuthNavigator';
import {AppNavigator} from './AppNavigator';
import {ProfileSetupScreen} from '../screens/auth/ProfileSetupScreen';
import {InterestPickerScreen} from '../screens/auth/InterestPickerScreen';
import {colors} from '../theme';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const {themeName} = useAppSettings();
  const {accessToken, isProfileComplete, needsInterestSetup, isLoading} = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Registered but profile not yet complete → go straight to ProfileSetup
  if (accessToken && !isProfileComplete) {
    return (
      <Stack.Navigator key={themeName} screenOptions={{headerShown: false}}>
        <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
      </Stack.Navigator>
    );
  }

  // Profile complete but just finished onboarding → show interest picker once
  if (accessToken && isProfileComplete && needsInterestSetup) {
    return (
      <Stack.Navigator key={`${themeName}-interests`} screenOptions={{headerShown: false}}>
        <Stack.Screen name="InterestPicker" component={InterestPickerScreen} />
      </Stack.Navigator>
    );
  }

  // Fully authenticated → show the main app
  if (accessToken && isProfileComplete) {
    return <AppNavigator />;
  }

  // Not logged in → show login / signup
  return <AuthNavigator />;
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
