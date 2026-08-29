/**
 * Custom URL scheme for share-sheet deep links.
 *
 * NOTE: this is a placeholder — the app still ships the default React Native
 * bundle identifiers. When the real bundle id is set, change this constant and
 * the two native declarations that must match it:
 *   ios/frontend/Info.plist          → CFBundleURLSchemes
 *   android/app/src/main/AndroidManifest.xml → <data android:scheme="...">
 */
export const APP_SCHEME = 'placeapp';

/** Deep link a share extension opens: placeapp://add-place?tiktokUrl=<encoded> */
export const ADD_PLACE_PATH = 'add-place';

/**
 * A link shared while logged out would otherwise be dropped on the login
 * screen. Park it here and let the app consume it once authenticated.
 */
let pendingTikTokURL: string | null = null;

export function setPendingTikTokURL(url: string | null) {
  pendingTikTokURL = url;
}

export function consumePendingTikTokURL(): string | null {
  const url = pendingTikTokURL;
  pendingTikTokURL = null;
  return url;
}

/** Pull the tiktokUrl param out of a deep link, if it is one. */
export function parseAddPlaceLink(url: string): string | null {
  if (!url.includes(`${APP_SCHEME}://${ADD_PLACE_PATH}`)) return null;
  const match = url.match(/[?&]tiktokUrl=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
