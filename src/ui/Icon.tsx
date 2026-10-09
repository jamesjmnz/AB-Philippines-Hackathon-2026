import Svg, { Path } from 'react-native-svg';

import { ICONS, type IconName } from './icons.generated';
import { colors } from './theme';

export type { IconName };

type Props = { name: IconName; size?: number; color?: string; filled?: boolean };

/** Material Symbols Rounded glyph. Decorative by default; put the accessibility label on the pressable that wraps it. */
export function Icon({ name, size = 20, color = colors.ink, filled = false }: Props) {
  const glyph = ICONS[name];
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" accessibilityElementsHidden importantForAccessibility="no">
      <Path d={filled && glyph.f ? glyph.f : glyph.o} fill={color} />
    </Svg>
  );
}
