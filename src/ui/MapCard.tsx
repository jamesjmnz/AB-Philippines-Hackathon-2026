import { useEffect, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, FeGaussianBlur, Filter, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { Icon, type IconName } from './Icon';
import { EASE, PulseRing } from './Motion';
import { colors, design } from './theme';

/**
 * The 17:9 campus map from the design (lines 179–216, repeated at 238 and 427), ported shape for shape.
 * Coordinates are the design's 340×180 viewBox. Pins are overlaid views, as in the design, so they can
 * move with the same 1.4s cubic-bezier(.4,0,.2,1) transition.
 */
const VB_W = 340;
const VB_H = 180;
const BUILDING = '#EAE4DA';
const BUILDING_LINE = '#DDD5C8';

export type MapFills = { lib?: string; b?: string; sc?: string; park?: string };

export type MapPin =
  | { key: string; kind: 'request'; x: number; y: number }
  | { key: string; kind: 'peer'; x: number; y: number; initials: string; bg: string; fg: string };

type Props = {
  /** Corner radius: 16 inside the incoming-request card, 20 inside the 26pt status cards. */
  radius?: number;
  fills?: MapFills;
  pins?: readonly MapPin[];
  /** Text of the location chip (bottom left). Null hides the chip. */
  label?: string | null;
  /** Text of the veil pill. Null draws no veil. */
  veil?: string | null;
  veilIcon?: IconName;
  testID?: string;
};

/** SVG has no `paint-order`, so the paper-coloured halo is a stroked copy drawn under the label. */
function Label({ x, y, size, weight, fill, children }: { x: number; y: number; size: number; weight: '600' | '700'; fill: string; children: string }) {
  return (
    <>
      <SvgText x={x} y={y} textAnchor="middle" fontSize={size} fontWeight={weight} fill={design.mapPaper} stroke={design.mapPaper} strokeWidth={2.4} strokeLinejoin="round">
        {children}
      </SvgText>
      <SvgText x={x} y={y} textAnchor="middle" fontSize={size} fontWeight={weight} fill={fill}>
        {children}
      </SvgText>
    </>
  );
}

function RequestPin() {
  return (
    <>
      <PulseRing size={28} color={colors.coral} durationMs={2200} style={{ left: -14, top: -14 }} />
      <View style={{ position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.coral, borderWidth: 2, borderColor: '#FFFFFF' }} />
      <View style={{ position: 'absolute', left: -1, top: -12, width: 2, height: 9, backgroundColor: colors.coral }} />
      <View
        style={{
          position: 'absolute',
          left: -14,
          top: -40,
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: colors.coral,
          borderWidth: 2.5,
          borderColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
        }}>
        <Icon name="emergency" size={14} color="#FFFFFF" filled />
      </View>
    </>
  );
}

function PeerPin({ pin }: { pin: Extract<MapPin, { kind: 'peer' }> }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: -14,
        top: -14,
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: pin.bg,
        borderWidth: 2.5,
        borderColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000000',
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      }}>
      <Text allowFontScaling={false} style={{ fontSize: 10, fontWeight: '700', color: pin.fg }}>
        {pin.initials}
      </Text>
    </View>
  );
}

/** A zero-size anchor at the pin's map position; its children hang off it, as in the design. */
function Pin({ pin, width, height }: { pin: MapPin; width: number; height: number }) {
  const reduced = useReducedMotion();
  const left = (pin.x / VB_W) * width;
  const top = (pin.y / VB_H) * height;
  const x = useSharedValue(left);
  const y = useSharedValue(top);
  useEffect(() => {
    if (reduced) {
      x.value = left;
      y.value = top;
      return;
    }
    x.value = withTiming(left, { duration: 1400, easing: EASE.move });
    y.value = withTiming(top, { duration: 1400, easing: EASE.move });
  }, [left, top, reduced, x, y]);
  const position = useAnimatedStyle(() => ({ left: x.value, top: y.value }));
  return (
    <Animated.View
      testID={pin.kind === 'request' ? 'map-pin-request' : `map-pin-${pin.key}`}
      pointerEvents="none"
      style={[{ position: 'absolute', width: 0, height: 0, zIndex: pin.kind === 'request' ? 2 : 3 }, position]}>
      {pin.kind === 'request' ? <RequestPin /> : <PeerPin pin={pin} />}
    </Animated.View>
  );
}

/** Before the card has been measured the pin sits at the same place by percentage, without motion. */
function StaticPin({ pin }: { pin: MapPin }) {
  return (
    <View
      testID={pin.kind === 'request' ? 'map-pin-request' : `map-pin-${pin.key}`}
      pointerEvents="none"
      style={{ position: 'absolute', width: 0, height: 0, zIndex: pin.kind === 'request' ? 2 : 3, left: `${(pin.x / VB_W) * 100}%`, top: `${(pin.y / VB_H) * 100}%` }}>
      {pin.kind === 'request' ? <RequestPin /> : <PeerPin pin={pin} />}
    </View>
  );
}

export function CampusMap({ radius = 20, fills, pins = [], label = null, veil = null, veilIcon = 'lock', testID = 'campus-map' }: Props) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!box || box.w !== width || box.h !== height) setBox({ w: width, h: height });
  };
  const f = { lib: fills?.lib ?? BUILDING, b: fills?.b ?? BUILDING, sc: fills?.sc ?? BUILDING, park: fills?.park ?? '#EEEAE3' };
  const roads = 'M0 82 H156 M162 78 H340 M60 112 V180 M232 112 V180 M200 0 L240 78';

  return (
    <View
      testID={testID}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={veil ? (label ? `Map illustration. ${veil}. ${label}` : `Map illustration. ${veil}`) : label ? `Map illustration. ${label}` : 'Map illustration'}
      style={{ width: '100%', aspectRatio: 17 / 9, borderRadius: radius, overflow: 'hidden', backgroundColor: design.mapPaper }}>
      <Svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" style={{ position: 'absolute', left: 0, top: 0 }}>
        {veil ? (
          <Defs>
            {/* Stands in for the design's backdrop-filter: blur(6px) under the veil. */}
            <Filter id="veilBlur" x="-10%" y="-10%" width="120%" height="120%">
              <FeGaussianBlur stdDeviation={6} />
            </Filter>
          </Defs>
        ) : null}
        <G filter={veil ? 'url(#veilBlur)' : undefined}>
          <Rect width={340} height={180} fill={design.mapPaper} />
          <Path d="M292 0 C300 18 322 30 340 34 L340 0 Z" fill="#A9D3F3" />
          <Rect x={284} y={120} width={70} height={70} rx={18} fill="#D3E9C6" />
          <Rect x={-10} y={168} width={140} height={20} fill="#D3E9C6" />
          <Circle cx={232} cy={90} r={7} fill="#D3E9C6" />
          <Path d={roads} stroke="#E4DED3" strokeWidth={7} fill="none" />
          <Path d={roads} stroke="#FFFFFF" strokeWidth={5} fill="none" />
          <Path d="M156 0 V180" stroke="#E4DED3" strokeWidth={10} fill="none" />
          <Path d="M156 0 V180" stroke="#FFFFFF" strokeWidth={8} fill="none" />
          <Path d="M0 106 H340" stroke="#EBC86E" strokeWidth={12} fill="none" />
          <Path d="M0 106 H340" stroke="#FCE29A" strokeWidth={10} fill="none" />
          <Rect x={24} y={18} width={100} height={46} rx={3} fill={f.lib} stroke={BUILDING_LINE} strokeWidth={0.8} />
          <Rect x={176} y={16} width={20} height={48} rx={2} fill={BUILDING} stroke={BUILDING_LINE} strokeWidth={0.8} />
          <Rect x={200} y={40} width={30} height={24} rx={2} fill={BUILDING} stroke={BUILDING_LINE} strokeWidth={0.8} />
          <Rect x={250} y={14} width={66} height={52} rx={3} fill={f.b} stroke={BUILDING_LINE} strokeWidth={0.8} />
          <Rect x={70} y={122} width={54} height={40} rx={3} fill={f.park} stroke={BUILDING_LINE} strokeWidth={0.8} />
          <Rect x={176} y={122} width={48} height={40} rx={3} fill={f.sc} stroke={BUILDING_LINE} strokeWidth={0.8} />
          <Rect x={240} y={122} width={32} height={26} rx={2} fill={BUILDING} stroke={BUILDING_LINE} strokeWidth={0.8} />
          <Label x={74} y={44} size={7} weight="600" fill="#7C786F">
            Library
          </Label>
          <Label x={283} y={44} size={7} weight="600" fill="#7C786F">
            Building B
          </Label>
          <Label x={97} y={145} size={7} weight="600" fill="#7C786F">
            Parking
          </Label>
          <Label x={200} y={145} size={7} weight="600" fill="#7C786F">
            Student Ctr
          </Label>
          <Label x={318} y={160} size={6.5} weight="600" fill="#5E8C4E">
            Rizal Park
          </Label>
          <Label x={108} y={103.5} size={6} weight="700" fill="#8A6A1F">
            Rizal Ave
          </Label>
          <SvgText x={159} y={160} fontSize={5.5} fontWeight="600" fill="#9A958B" transform="rotate(90 159 160)">
            Campus Dr
          </SvgText>
        </G>
      </Svg>

      {pins.map((p) => (box ? <Pin key={p.key} pin={p} width={box.w} height={box.h} /> : <StaticPin key={p.key} pin={p} />))}

      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          right: 8,
          top: 8,
          width: 28,
          height: 28,
          borderRadius: 8,
          backgroundColor: 'rgba(255,255,255,0.95)',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000000',
          shadowOpacity: 0.08,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 1 },
        }}>
        <Icon name="near_me" size={15} />
      </View>

      {veil ? (
        <View testID="map-veil" pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(248,244,236,0.7)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 }}>
            <Icon name={veilIcon} size={15} />
            <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.ink }}>{veil}</Text>
          </View>
        </View>
      ) : null}

      {label ? (
        <View
          testID="map-label"
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8,
            maxWidth: '80%',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            backgroundColor: 'rgba(255,255,255,0.95)',
            borderRadius: 9,
            paddingTop: 5,
            paddingRight: 9,
            paddingBottom: 5,
            paddingLeft: 6,
            shadowColor: '#000000',
            shadowOpacity: 0.08,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 1 },
          }}>
          <Icon name="location_on" size={14} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 11.5, fontWeight: '600', color: colors.ink }}>
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
