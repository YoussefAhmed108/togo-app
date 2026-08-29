// Organic design system — warm cream ground, terracotta + sage accents,
// Caprasimo (display) / Figtree (text).

const ORGANIC_EXTRAS = {
  sand: '#EADCC4',
  sandDeep: '#E2D4B9',
  sage: '#7A8A5E',
  sageTint: '#E0ECCB',
  blush: '#FFE1D0',
  primaryBorder: '#EDC9B3',
  primaryDeep: '#985B31',
  inkInput: '#544E45',
  sageSoft: '#EDF3DE',
};

const THEME_PRESETS = {
  sunrise: {
    // Brand
    primary: '#C67139',
    primaryDark: '#A85A28',
    primaryLight: '#FFF2EB',

    // Header / dark surfaces
    headerBg: '#2D2A24',
    headerMid: '#35322C',
    headerDeep: '#474238',

    // Card surfaces
    cardDark: '#474238',
    cardDarkBorder: 'rgba(255,255,255,0.08)',

    // Light surfaces
    secondary: '#2D2A24',
    background: '#F3E8D6',
    surface: '#F9F4ED',
    surfaceDim: '#EADCC4',
    border: '#E6DBCB',

    // Text
    text: '#2D2A24',
    textSecondary: '#7B7367',
    textMuted: '#9A9184',
    textOnDark: '#FFFFFF',
    textOnDarkSub: 'rgba(255,255,255,0.62)',

    // Misc
    placeholder: '#B3A895',
    error: '#B3261E',
    errorLight: '#F7E6E2',
    success: '#7A8A5E',
    white: '#FFFFFF',
    black: '#000000',
    overlay: 'rgba(45,42,36,0.5)',

    // Category accent colors
    catRestaurant: '#C67139',
    catPark: '#7A8A5E',
    catDeli: '#A8724C',
    catDefault: '#7B7367',

    // Reason colors
    reasonFav: '#C67139',
    reasonSpace: '#7A8A5E',

    // Glass
    glass: 'rgba(255,255,255,0.08)',
    glassBorder: 'rgba(255,255,255,0.18)',

    ...ORGANIC_EXTRAS,
  },
  midnight: {
    primary: '#7DD3FC',
    primaryDark: '#38BDF8',
    primaryLight: 'rgba(125,211,252,0.16)',
    headerBg: '#050816',
    headerMid: '#0D1328',
    headerDeep: '#172554',
    cardDark: '#10192E',
    cardDarkBorder: 'rgba(255,255,255,0.10)',
    secondary: '#DDE7FF',
    background: '#09111F',
    surface: '#10192B',
    surfaceDim: '#162238',
    border: '#22314D',
    text: '#F6FAFF',
    textSecondary: '#9EB0CA',
    textMuted: '#6F85A5',
    textOnDark: '#FFFFFF',
    textOnDarkSub: 'rgba(255,255,255,0.72)',
    placeholder: '#60748F',
    error: '#F87171',
    errorLight: 'rgba(248,113,113,0.14)',
    success: '#34D399',
    white: '#FFFFFF',
    black: '#000000',
    overlay: 'rgba(0,0,0,0.58)',
    catRestaurant: '#FB7185',
    catPark: '#34D399',
    catDeli: '#A78BFA',
    catDefault: '#60A5FA',
    reasonFav: '#F97316',
    reasonSpace: '#38BDF8',
    glass: 'rgba(255,255,255,0.10)',
    glassBorder: 'rgba(255,255,255,0.14)',

    sand: '#162238',
    sandDeep: '#1B2B44',
    sage: '#34D399',
    sageTint: 'rgba(52,211,153,0.16)',
    blush: 'rgba(125,211,252,0.16)',
    primaryBorder: 'rgba(125,211,252,0.45)',
    primaryDeep: '#7DD3FC',
    inkInput: '#1B2B44',
    sageSoft: 'rgba(52,211,153,0.12)',
  },
  grove: {
    primary: '#2F855A',
    primaryDark: '#276749',
    primaryLight: 'rgba(47,133,90,0.14)',
    headerBg: '#11261D',
    headerMid: '#19382B',
    headerDeep: '#24503D',
    cardDark: '#1D3A2C',
    cardDarkBorder: 'rgba(255,255,255,0.08)',
    secondary: '#173528',
    background: '#F3F1E8',
    surface: '#FFFDF7',
    surfaceDim: '#E7E1D0',
    border: '#D3CCB7',
    text: '#1E2A20',
    textSecondary: '#667564',
    textMuted: '#8C9584',
    textOnDark: '#FFFFFF',
    textOnDarkSub: 'rgba(255,255,255,0.7)',
    placeholder: '#A49F90',
    error: '#C05621',
    errorLight: 'rgba(192,86,33,0.12)',
    success: '#2F855A',
    white: '#FFFFFF',
    black: '#000000',
    overlay: 'rgba(18,28,20,0.42)',
    catRestaurant: '#C05621',
    catPark: '#2F855A',
    catDeli: '#B7791F',
    catDefault: '#2B6CB0',
    reasonFav: '#C05621',
    reasonSpace: '#2F855A',
    glass: 'rgba(255,255,255,0.09)',
    glassBorder: 'rgba(255,255,255,0.2)',

    sand: '#E7E1D0',
    sandDeep: '#DCD4BE',
    sage: '#2F855A',
    sageTint: 'rgba(47,133,90,0.14)',
    blush: 'rgba(192,86,33,0.12)',
    primaryBorder: 'rgba(47,133,90,0.4)',
    primaryDeep: '#276749',
    inkInput: '#24503D',
    sageSoft: 'rgba(47,133,90,0.10)',
  },
} as const;

export type AppThemeName = keyof typeof THEME_PRESETS;

export const THEME_OPTIONS: Array<{
  id: AppThemeName;
  name: string;
  description: string;
  /** Preview swatches shown on the Settings theme card. */
  swatches: [string, string, string];
}> = (['sunrise', 'midnight', 'grove'] as const).map(id => ({
  id,
  name: {sunrise: 'Sunrise', midnight: 'Midnight', grove: 'Grove'}[id],
  description: {
    sunrise: 'Warm and bright',
    midnight: 'Dark and crisp',
    grove: 'Soft and earthy',
  }[id],
  swatches: [
    THEME_PRESETS[id].primary,
    THEME_PRESETS[id].surface,
    THEME_PRESETS[id].headerDeep,
  ],
}));

// PostScript names of the linked font files (src/assets/fonts).
// Never pair these with fontWeight — the family already carries the weight.
export const fonts = {
  display: 'Caprasimo-Regular',
  regular: 'Figtree-Regular',
  medium: 'Figtree-Medium',
  semibold: 'Figtree-SemiBold',
  bold: 'Figtree-Bold',
};

function buildTypography(themeColors: typeof THEME_PRESETS.sunrise) {
  return {
    display: {fontFamily: fonts.display, fontSize: 30, color: themeColors.text},
    h1: {fontFamily: fonts.display, fontSize: 28, color: themeColors.text},
    h2: {fontFamily: fonts.display, fontSize: 22, color: themeColors.text},
    h3: {fontFamily: fonts.semibold, fontSize: 18, color: themeColors.text},
    body: {fontFamily: fonts.regular, fontSize: 16, color: themeColors.text},
    bodySmall: {fontFamily: fonts.regular, fontSize: 14, color: themeColors.textSecondary},
    label: {fontFamily: fonts.medium, fontSize: 13, color: themeColors.textSecondary},
    caption: {fontFamily: fonts.regular, fontSize: 12, color: themeColors.textSecondary},
    sectionTitle: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: themeColors.textMuted,
      letterSpacing: 1.2,
    },
  };
}

export const colors = {...THEME_PRESETS.sunrise};

export const spacing = {xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48};
export const radius = {sm: 10, md: 14, lg: 18, xl: 22, xxl: 28, full: 9999};

export const shadows = {
  card: {
    shadowColor: '#4A3B28',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  cardStrong: {
    shadowColor: '#4A3B28',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 6,
  },
  primaryGlow: {
    shadowColor: '#C67139',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 5,
  },
};

export const typography = buildTypography(colors);

export function applyTheme(themeName: AppThemeName) {
  const nextTheme = THEME_PRESETS[themeName];
  Object.assign(colors, nextTheme);
  Object.assign(typography, buildTypography(colors));
}
