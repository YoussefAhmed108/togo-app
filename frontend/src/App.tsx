import React from 'react';
import {Linking} from 'react-native';
import {NavigationContainer, LinkingOptions} from '@react-navigation/native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {PostHogProvider} from 'posthog-react-native';
import {posthog} from './services/analytics';
import {AppSettingsProvider} from './context/AppSettingsContext';
import {AuthProvider} from './context/AuthContext';
import {LocationProvider} from './context/LocationContext';
import RootNavigator from './navigation/RootNavigator';
import {AppStackParamList} from './types/navigation';
import {
  ADD_PLACE_PATH,
  APP_SCHEME,
  parseAddPlaceLink,
  setPendingTikTokURL,
} from './config/deepLink';

/**
 * Deep links from the share sheet look like:
 *   placeapp://add-place?tiktokUrl=https%3A%2F%2Fvt.tiktok.com%2FZSVxxxx%2F
 *
 * RootNavigator swaps navigators on auth state, so a link that arrives while
 * logged out cannot resolve to CreatePlace. We park the URL and AppNavigator
 * picks it up after login instead of dropping the share.
 */
const linking: LinkingOptions<AppStackParamList> = {
  prefixes: [`${APP_SCHEME}://`],
  config: {
    screens: {
      CreatePlace: {
        path: ADD_PLACE_PATH,
        parse: {
          tiktokUrl: (v: string) => decodeURIComponent(v),
        },
      },
    },
  },
  async getInitialURL() {
    const url = await Linking.getInitialURL();
    if (url) {
      const tiktokUrl = parseAddPlaceLink(url);
      if (tiktokUrl) setPendingTikTokURL(tiktokUrl);
    }
    return url;
  },
  subscribe(listener) {
    const sub = Linking.addEventListener('url', ({url}) => {
      const tiktokUrl = parseAddPlaceLink(url);
      if (tiktokUrl) setPendingTikTokURL(tiktokUrl);
      listener(url);
    });
    return () => sub.remove();
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AppSettingsProvider>
        <AuthProvider>
          <LocationProvider>
            <NavigationContainer linking={linking}>
              {/* Inside NavigationContainer: react-navigation v6 screen
                  autocapture needs it. Touches give tap-level behaviour. */}
              <PostHogProvider
                client={posthog}
                autocapture={{captureScreens: true, captureTouches: true}}>
                <RootNavigator />
              </PostHogProvider>
            </NavigationContainer>
          </LocationProvider>
        </AuthProvider>
      </AppSettingsProvider>
    </SafeAreaProvider>
  );
}
