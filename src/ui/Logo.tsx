import { View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { colors } from './theme';

const ECG = '6,27 16,27 20,19 26,35 31,15 35,27 44,27';

type Props = {
  /** Outer tile size and corner radius. Design: 92/28 (splash), 72/24 (welcome orbit), 28/9 (wordmark). */
  box: number;
  radius: number;
  /** Rendered size of the 52×52 glyph. Design: 54, 42, 18. */
  glyph: number;
  /** Polyline stroke width in viewBox units. Design: 3, 3.4, 5. */
  stroke: number;
  /** Faint circle around the trace (splash only). */
  halo?: boolean;
  /** Coral end dot (splash and orbit; not the 28pt wordmark tile). */
  dot?: boolean;
  /** Drop shadow 0 12px 30px rgba(0,0,0,.18) (orbit tile). */
  shadow?: boolean;
};

/** The logo mark: a white ECG trace on an ink tile, ported from the design's inline SVG. */
export function LogoMark({ box, radius, glyph, stroke, halo, dot, shadow }: Props) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width: box, height: box, borderRadius: radius, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
        shadow ? { shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 30, shadowOffset: { width: 0, height: 12 } } : null,
      ]}>
      <Svg width={glyph} height={glyph} viewBox="0 0 52 52">
        {halo ? <Circle cx={26} cy={26} r={22} fill="none" stroke="#FFFFFF" strokeOpacity={0.22} strokeWidth={2} /> : null}
        <Polyline points={ECG} fill="none" stroke="#FFFFFF" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
        {dot ? <Circle cx={45} cy={27} r={3} fill={colors.coral} /> : null}
      </Svg>
    </View>
  );
}
