import { Text, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import type { Tone } from './theme';

/** Banner colours as the design writes them (lines 712, 716, 795, 796): deep text on the tint. */
const LOOK: Record<Tone, { fg: string; bg: string }> = {
  amber: { fg: '#7A4E0B', bg: '#FDF3E2' },
  coral: { fg: '#9B3532', bg: '#FDECEB' },
  green: { fg: '#1E7F5B', bg: '#E6F5EE' },
  indigo: { fg: '#46508A', bg: '#E9EBF6' },
  gray: { fg: '#6E6E73', bg: '#F7F7F9' },
  neutral: { fg: '#151515', bg: '#F2F2F4' },
};

type Props = {
  text: string;
  tone?: Tone;
  icon?: IconName;
  /** FILL 1 glyph (the design fills `sos`, `lock` and `check_circle`, not `info` or `warning`). */
  filled?: boolean;
  /** 14 all round (design 716) instead of 12/14. */
  roomy?: boolean;
  weight?: '400' | '500' | '600';
  testID?: string;
};

/** Inline notice: radius 16, gap 10, 18pt icon, 13pt text. */
export function Banner({ text, tone = 'amber', icon = 'info', filled, roomy, weight = '400', testID }: Props) {
  const look = LOOK[tone];
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={{ flexDirection: 'row', gap: 10, backgroundColor: look.bg, borderRadius: 16, paddingVertical: roomy ? 14 : 12, paddingHorizontal: 14 }}>
      <Icon name={icon} size={18} color={look.fg} filled={filled} />
      <Text style={{ flex: 1, fontSize: 13, lineHeight: roomy ? 18.85 : 18.2, fontWeight: weight, color: look.fg }}>{text}</Text>
    </View>
  );
}
