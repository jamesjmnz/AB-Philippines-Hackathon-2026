// Mirrors tailwind.config.js for APIs that cannot take className (SVG, navigation options, animations).
export const colors = {
  ink: '#151515',
  page: '#F7F7F9',
  card: '#FFFFFF',
  gray1: '#86868B',
  gray2: '#6E6E73',
  gray3: '#3A3A3C',
  gray4: '#A1A1A6',
  gray5: '#C7C7CC',
  hairline: '#F2F2F4',
  line: '#EEEEF0',
  lineInput: '#E5E5EA',
  track: '#E3E3E8',
  disabled: '#D5D5DA',
  fillSeg: '#EBEBEE',
  fillPill: '#EFEFF2',
  coral: '#ED625E',
  coralText: '#C8433F',
  coralTint: '#FDECEB',
  amber: '#F4B860',
  amberText: '#9A6210',
  amberTint: '#FDF3E2',
  green: '#27A878',
  greenText: '#1E7F5B',
  greenTint: '#E6F5EE',
  indigo: '#46508A',
  indigoTint: '#E9EBF6',
} as const;

export type Tone = 'neutral' | 'gray' | 'amber' | 'green' | 'coral' | 'indigo';

export const tones: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: colors.ink, bg: colors.hairline },
  gray: { fg: colors.gray1, bg: colors.hairline },
  amber: { fg: colors.amberText, bg: colors.amberTint },
  green: { fg: colors.greenText, bg: colors.greenTint },
  coral: { fg: colors.coralText, bg: colors.coralTint },
  indigo: { fg: colors.indigo, bg: colors.indigoTint },
};

/** Design neutrals that have no Tailwind token: map paper, ring track, soft button fill. */
export const design = {
  scrim: 'rgba(10,10,12,0.4)',
  ringTrack: '#F0F0F2',
  soft: '#EFEFF2',
  softer: '#F5F5F7',
  mapPaper: '#F8F4EC',
  coralRingTrack: '#FBE3E2',
  conflictTint: '#FDF1F0',
  offlineText: '#8A5A0E',
} as const;

/**
 * The design draws a 402×874 frame whose bottom paddings (40px) already contain the 34pt home
 * indicator. On a device the same padding is the safe-area inset plus the design's 6pt, never less
 * than the design value.
 */
export function padBottom(insetBottom: number, designPx = 40): number {
  return Math.max(designPx, insetBottom + 6);
}

/** Tab bar: 60pt of content above the home-indicator inset (94px in the design frame). */
export function tabBarHeight(insetBottom: number): number {
  return 60 + Math.max(insetBottom, 10);
}
