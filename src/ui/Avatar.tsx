import { Text, View } from 'react-native';

import { colors } from './theme';

const PALETTE = [
  { bg: '#F1E6DA', fg: '#7A5634' },
  { bg: '#DDEBE4', fg: '#2F6B52' },
  { bg: '#E4E7F3', fg: '#46508A' },
  { bg: '#F3E3E3', fg: '#8A4646' },
  { bg: '#EEEEF0', fg: '#86868B' },
] as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function paletteFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? PALETTE[0];
}

type Props = { name: string; size?: number; self?: boolean; presence?: 'online' | 'offline' };

/** Initials avatar. `self` uses the black fill reserved for this device's user. */
export function Avatar({ name, size = 40, self, presence }: Props) {
  const c = self ? { bg: colors.ink, fg: '#FFFFFF' } : paletteFor(name);
  return (
    <View style={{ width: size, height: size }}>
      <View className="flex-1 items-center justify-center rounded-full" style={{ backgroundColor: c.bg }}>
        <Text style={{ color: c.fg, fontSize: size * 0.36, fontWeight: '700' }}>{initialsOf(name)}</Text>
      </View>
      {presence ? (
        <View
          className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white"
          style={{ backgroundColor: presence === 'online' ? colors.green : colors.gray5 }}
        />
      ) : null}
    </View>
  );
}
