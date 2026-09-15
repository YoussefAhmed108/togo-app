import PostHog from 'posthog-react-native';
import {POSTHOG_API_KEY, POSTHOG_HOST} from '../config/maps.generated';

/**
 * The one PostHog client. It is created here rather than by PostHogProvider
 * because AuthProvider sits outside NavigationContainer (and so outside the
 * provider) and still has to identify and reset the user.
 */
export const posthog = new PostHog(POSTHOG_API_KEY || 'disabled', {
  host: POSTHOG_HOST,
  disabled: !POSTHOG_API_KEY,
});
