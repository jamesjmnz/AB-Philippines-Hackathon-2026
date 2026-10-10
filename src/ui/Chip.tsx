import { View } from 'react-native';

import { tones, type Tone } from './theme';
import { Text } from './Text';

type Props = { label: string; tone?: Tone; solid?: boolean };

/** Status chip. `solid` is the white-on-green "confirmed" variant from the design. */
export function Chip({ label, tone = 'neutral', solid }: Props) {
  const t = tones[tone];
  return (
    <View className="self-start rounded-full px-[9px] py-1" style={{ backgroundColor: solid ? t.fg : t.bg }}>
      <Text className="text-[12px] font-semibold" style={{ color: solid ? '#FFFFFF' : t.fg }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Uppercase micro label used for SIMULATED / DEMO markers. */
export function MicroPill({ label, tone = 'gray' }: { label: string; tone?: Tone }) {
  const t = tones[tone];
  return (
    <View className="self-start rounded-full px-2 py-[3px]" style={{ backgroundColor: t.bg }}>
      <Text className="text-[11px] font-bold uppercase tracking-[0.5px]" style={{ color: t.fg }}>
        {label}
      </Text>
    </View>
  );
}
