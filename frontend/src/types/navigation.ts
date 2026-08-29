export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

export type AppStackParamList = {
  Home: undefined;
  Settings: undefined;
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
  SeeAll: {kind: 'spaces' | 'places'};
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
