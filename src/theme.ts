/**
 * Dark theme. Palette follows the VitalX hackathon branding:
 * near-black surfaces with a single teal-green accent.
 */

export const colors = {
  bg: '#0A0C0F',
  surface: '#14181D',
  surfaceAlt: '#1C2228',
  surfaceHigh: '#242C34',
  border: '#2A323B',
  borderSoft: '#1F262D',

  text: '#F2F5F7',
  textDim: '#8A97A5',
  textFaint: '#5C6773',

  accent: '#00E5A0',
  accentSoft: '#00E5A020',
  accentText: '#04120C',

  info: '#4DA6FF',
  infoSoft: '#4DA6FF20',
  warning: '#FFB020',
  warningSoft: '#FFB02020',
  danger: '#FF5A5A',
  dangerSoft: '#FF5A5A20',

  /** macro split colours, reused across food log + dashboard */
  protein: '#4DA6FF',
  carbs: '#FFB020',
  fat: '#FF7B9C',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const type = {
  display: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
  micro: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.6 },
} as const;

/** Standard card surface. */
export const card = {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.borderSoft,
  padding: space.lg,
} as const;
