import { Text, View } from 'react-native';

import { colors } from './theme';

/** The design's avatar tints (design line 943–950). */
const PALETTE = [
  { bg: '#F1E6DA', fg: '#7A5634' },
  { bg: '#DDEBE4', fg: '#2F6B52' },
  { bg: '#E4E7F3', fg: '#46508A' },
  { bg: '#F3E3E3', fg: '#8A4646' },
  { bg: '#EEEEF0', fg: '#86868B' },
] as const;

const INK = { bg: colors.ink, fg: '#FFFFFF' } as const;

/** The design's simulated people keep the tint the design gave them, so Demo matches the mockup. */
const PERSONA: Record<string, { bg: string; fg: string }> = {
  alex: INK,
  mika: PALETTE[0],
  noah: PALETTE[1],
  sofia: PALETTE[2],
  daniel: PALETTE[3],
  jordan: PALETTE[4],
};

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Background and text colour for a person. `self` is the ink fill the design gives this device's user. */
export function avatarColors(name: string, self?: boolean): { bg: string; fg: string } {
  const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const persona = PERSONA[first];
  if (persona) return persona;
  if (self) return INK;
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? PALETTE[0];
}

/** Font size the design pairs with each avatar diameter. */
const FONT: Record<number, number> = { 26: 10, 28: 10, 32: 11, 34: 12, 38: 13, 40: 13, 44: 14, 46: 14, 52: 15, 58: 19, 62: 20 };

type Props = {
  name: string;
  size?: number;
  self?: boolean;
  /**
   * Presence dot. The design draws 11pt at -1/-1 (lists) and 12pt at 0/0 (relay chain). Those are CSS
   * content-box sizes: the 2pt border is added outside, so the dot renders 4pt larger than `dotSize`.
   */
  presence?: 'online' | 'offline';
  dotSize?: number;
  dotInset?: number;
  /** White ring around the avatar (welcome orbit: 3pt), added outside `size` as in the design. */
  ring?: number;
  /** Border colour of the presence dot; the page colour when the avatar sits on the page. */
  dotBorder?: string;
};

/** Initials avatar with the design's size-to-type pairing. */
export function Avatar({ name, size = 40, self, presence, dotSize = 11, dotInset = -1, ring, dotBorder = '#FFFFFF' }: Props) {
  const c = avatarColors(name, self);
  const outer = size + 2 * (ring ?? 0);
  const dot = dotSize + 4;
  return (
    <View style={{ width: outer, height: outer }}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: outer / 2,
          backgroundColor: c.bg,
          borderWidth: ring ?? 0,
          borderColor: '#FFFFFF',
        }}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: c.fg, fontSize: FONT[size] ?? Math.round(size * 0.33), fontWeight: '700' }}>
          {initialsOf(name)}
        </Text>
      </View>
      {presence ? (
        <View
          style={{
            position: 'absolute',
            right: (ring ?? 0) + dotInset,
            bottom: (ring ?? 0) + dotInset,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            borderWidth: 2,
            borderColor: dotBorder,
            backgroundColor: presence === 'online' ? colors.green : colors.gray5,
          }}
        />
      ) : null}
    </View>
  );
}
