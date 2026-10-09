import { View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

type Props = {
  /** Fixed length in points; omit to fill the parent along the line's axis. */
  length?: number;
  vertical?: boolean;
  color: string;
  dashed?: boolean;
  /** Line width. The design's connectors are 2px. */
  thickness?: number;
};

/**
 * A straight connector (`border-left: 2px dashed …` / `border-top: 2px solid …` in the design).
 * iOS cannot dash a border on one side only, so the line is drawn with SVG. Dashes are 3× the
 * width with 2× gaps, close to how a browser dashes a 2px border.
 */
export function Rule({ length, vertical, color, dashed, thickness = 2 }: Props) {
  const dash = dashed ? `${thickness * 3} ${thickness * 2}` : undefined;
  const fill = length === undefined;
  if (vertical) {
    return (
      <View pointerEvents="none" style={[{ width: thickness }, fill ? { flex: 1 } : { height: length }]}>
        <Svg width={thickness} height="100%">
          <Line x1={thickness / 2} y1={0} x2={thickness / 2} y2="100%" stroke={color} strokeWidth={thickness} strokeDasharray={dash} />
        </Svg>
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={[{ height: thickness }, fill ? { flex: 1 } : { width: length }]}>
      <Svg width="100%" height={thickness}>
        <Line x1={0} y1={thickness / 2} x2="100%" y2={thickness / 2} stroke={color} strokeWidth={thickness} strokeDasharray={dash} />
      </Svg>
    </View>
  );
}
