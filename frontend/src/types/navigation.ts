import type {ExtractedPlace} from '../services/extractService';

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

/** Bottom navigation bar — the app's top-level destinations. */
export type TabParamList = {
  Home: undefined;
  Map: undefined;
  Spaces: undefined;
  Account: undefined;
};

export type AppStackParamList = {
  Tabs: undefined;
  CreateSpace: undefined;
  CreatePlace: {
    spaceId?: number;
    spaceTags?: string[];
    /** A shared TikTok link — triggers extraction on mount */
    tiktokUrl?: string;
    /** Pre-fill from a recommendation tap */
    prefillName?: string;
    prefillAddress?: string;
    prefillLat?: number;
    prefillLng?: number;
  } | undefined;
  /** A TikTok featuring several venues — pick where each one goes. */
  ReviewPlaces: {
    places: ExtractedPlace[];
    /** Opened from a space: that space is every place's default destination. */
    spaceId?: number;
    /** The TikTok the places came from. */
    sourceUrl?: string;
    /** The extraction's feedback_keys, for the "right places?" prompt. */
    feedbackKeys?: string[];
  };
  SpaceDetail: {
    spaceId: number;
    spaceName: string;
    spaceIcon: string;
    bannerUrl: string | null;
  };
  PlaceDetail: {
    placeId: number;
    placeName: string;
    /** When navigating from a space screen, pass the spaceId so those memories appear first. */
    fromSpaceId?: number;
  };
};

export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
};
