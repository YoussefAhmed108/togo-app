// Waypoint design system — neutral ground, white cards, teal identity (a1),
// violet for people and spaces (a2). Source: .design/proto (oklch tokens,
// converted to hex because RN cannot parse oklch).
//
// Every legacy key (sand, sage, blush, …) is kept and remapped onto the new
// palette so screens that still read them pick up the new look unchanged.

const LIGHT = {
  // Brand: a1Fill for fills and text, a1Text where text must be darker.
  primary: '#00838E',
  primaryDark: '#00717C',
  primaryLight: '#D5F2F3',
  primaryBorder: '#7CCED2',
  primaryDeep: '#006873',
  accent: '#6A69DB', // a2Fill — people and spaces
  accentSoft: '#DBDBFF',
  accentSoftB: '#E8E8FF',

  // Home header block the page rises over.
  headerBg: '#00828E',
  headerMid: '#00717C',
  headerDeep: '#005F68',
  cardDark: '#00717C',
  cardDarkBorder: 'rgba(255,255,255,0.12)',

  secondary: '#1C1C25',
  background: '#F0F0F3',
  surface: '#FDFDFF',
  surfaceDim: '#E7E7EC',
  sunken: '#F0F0F3',
  border: '#DCDCE0',
  ringIdle: '#BABAC1',
  stripeA: '#DADAE0',
  stripeB: '#E7E7EC',

  text: '#1C1C25',
  textSecondary: '#5C5C69',
  textMuted: '#5C5C69',
  textOnDark: '#FFFFFF',
  textOnDarkSub: 'rgba(255,255,255,0.72)',

  placeholder: '#5C5C69',
  error: '#D33A3C',
  errorLight: '#FFE8E6',
  success: '#00884B',
  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(20,20,30,0.45)',
  disabledBg: '#DADADF',
  disabledFg: '#54545E',

  // Category pin colours.
  catRestaurant: '#E65719',
  catPark: '#2E9E52',
  catDeli: '#7C63D6',
  catDefault: '#009FAA',
  catShop: '#DB5392',

  reasonFav: '#006873',
  reasonSpace: '#6A69DB',

  glass: 'rgba(255,255,255,0.12)',
  glassBorder: 'rgba(255,255,255,0.2)',

  // Legacy organic keys → Waypoint equivalents.
  sand: '#F0F0F3',
  sandDeep: '#DCDCE0',
  sage: '#00884B',
  sageTint: '#D7F4E0',
  sageSoft: '#D7F4E0',
  blush: '#DBDBFF',
  inkInput: '#1C1C25',
};

type Palette = typeof LIGHT;

const DARK: Palette = {
  ...LIGHT,
  primary: '#00A3AD',
  primaryDark: '#00838E',
  primaryLight: '#0B2F31',
  primaryBorder: '#005459',
  primaryDeep: '#00BCC5',
  accentSoft: '#2B2A44',
  accentSoftB: '#222232',

  headerBg: '#0E1217',
  headerMid: '#1B2026',
  headerDeep: '#242930',
  cardDark: '#1B2026',

  secondary: '#E8EBEF',
  background: '#0E1217',
  surface: '#1B2026',
  surfaceDim: '#242930',
  sunken: '#1B2026',
  border: '#242930',
  ringIdle: '#52565B',
  stripeA: '#1B2026',
  stripeB: '#242930',

  text: '#E8EBEF',
  textSecondary: '#8B9095',
  textMuted: '#8B9095',
  placeholder: '#8B9095',
  error: '#EA6A64',
  errorLight: '#3E1E1C',
  overlay: 'rgba(0,0,0,0.62)',
  disabledBg: '#2A2E34',
  disabledFg: '#81878D',
  reasonFav: '#00BCC5',

  sand: '#1B2026',
  sandDeep: '#242930',
  sageTint: '#182F20',
  sageSoft: '#182F20',
  blush: '#2B2A44',
  inkInput: '#E8EBEF',
};

const THEME_PRESETS = {light: LIGHT, dark: DARK};

export type AppThemeName = keyof typeof THEME_PRESETS;

export const THEME_OPTIONS: Array<{
  id: AppThemeName;
  name: string;
  description: string;
  /** Preview swatches shown on the Settings theme card. */
  swatches: [string, string, string];
}> = (['light', 'dark'] as const).map(id => ({
  id,
  name: {light: 'Light', dark: 'Dark'}[id],
  description: {light: 'Neutral and bright', dark: 'Easy at night'}[id],
  swatches: [
    THEME_PRESETS[id].primary,
    THEME_PRESETS[id].surface,
    THEME_PRESETS[id].accent,
  ],
}));

// PostScript names of the linked font files (src/assets/fonts).
// Never pair these with fontWeight — the family already carries the weight.
// ponytail: the design is set in Inter; Figtree (already bundled) is the
// nearest geometric sans. Drop Inter TTFs into assets/fonts and repoint here.
export const fonts = {
  display: 'Figtree-Bold',
  regular: 'Figtree-Regular',
  medium: 'Figtree-Medium',
  semibold: 'Figtree-SemiBold',
  bold: 'Figtree-Bold',
};

function buildTypography(themeColors: Palette) {
  return {
    display: {fontFamily: fonts.bold, fontSize: 28, color: themeColors.text, letterSpacing: -0.5},
    h1: {fontFamily: fonts.bold, fontSize: 24, color: themeColors.text, letterSpacing: -0.5},
    h2: {fontFamily: fonts.bold, fontSize: 19, color: themeColors.text},
    h3: {fontFamily: fonts.bold, fontSize: 16, color: themeColors.text},
    body: {fontFamily: fonts.regular, fontSize: 15, color: themeColors.text},
    bodySmall: {fontFamily: fonts.regular, fontSize: 13, color: themeColors.textSecondary},
    label: {fontFamily: fonts.bold, fontSize: 11, color: themeColors.textSecondary, letterSpacing: 0.7},
    caption: {fontFamily: fonts.regular, fontSize: 12, color: themeColors.textSecondary},
    sectionTitle: {fontFamily: fonts.bold, fontSize: 14, color: themeColors.text},
  };
}

export const colors = {...THEME_PRESETS.light};

// 4-base scale: tight inside a group, generous between topics.
export const spacing = {xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48};
export const radius = {sm: 9, md: 12, lg: 14, xl: 16, xxl: 20, full: 9999};

export const shadows = {
  card: {
    shadowColor: '#14141E',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  cardStrong: {
    shadowColor: '#14141E',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 5,
  },
  primaryGlow: {
    shadowColor: '#14141E',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.26,
    shadowRadius: 20,
    elevation: 6,
  },
};

export const typography = buildTypography(colors);

export function applyTheme(themeName: AppThemeName) {
  Object.assign(colors, THEME_PRESETS[themeName]);
  Object.assign(typography, buildTypography(colors));
}
