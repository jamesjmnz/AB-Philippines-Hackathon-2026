import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { EASE, type EaseName } from './Motion';
import { colors, design } from './theme';
import { Text } from './Text';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type RingProps = {
  /** Outer box in points (the design's svg width/height). */
  size: number;
  /** Circle radius exactly as in the design's `r` attribute. */
  r: number;
  stroke: number;
  /** 0..1 of the ring that is drawn. */
  progress: number;
  color?: string;
  track?: string;
  /** Fill of the track circle (the SOS and session rings are white inside). */
  fill?: string;
  /** Transition of stroke-dashoffset: the design uses 1s linear for countdowns, .8s spring for readiness. */
  durationMs?: number;
  ease?: EaseName;
  children?: ReactNode;
};

/** The design's progress ring: a track circle and a round-capped arc starting at 12 o'clock. */
export function Ring({ size, r, stroke, progress, color = colors.ink, track = design.ringTrack, fill = 'none', durationMs = 800, ease = 'spring', children }: RingProps) {
  const reduced = useReducedMotion();
  const circumference = 2 * Math.PI * r;
  const target = circumference * (1 - Math.max(0, Math.min(1, progress)));
  const offset = useSharedValue(target);

  useEffect(() => {
    offset.value = reduced ? target : withTiming(target, { duration: durationMs, easing: EASE[ease] });
  }, [target, reduced, durationMs, ease, offset]);

  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill={fill} />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
          fill="none"
        />
      </Svg>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}

type LegacyRingProps = { size: number; stroke?: number; progress: number; color?: string; track?: string; children?: ReactNode };

/** Circular progress ring sized from its stroke; kept for screens outside the design. */
export function ProgressRing({ size, stroke = 6, progress, color = colors.ink, track = design.ringTrack, children }: LegacyRingProps) {
  return (
    <Ring size={size} r={(size - stroke) / 2} stroke={stroke} progress={progress} color={color} track={track}>
      {children}
    </Ring>
  );
}

export type Step = { label: string; done: boolean };

/**
 * Five-step delivery bar (design 468–470): 4pt bars 4pt apart, 9.5pt labels 6pt below. A step is
 * filled only when the state it names has actually been reached.
 */
export function StepBar({ steps, color = colors.green }: { steps: readonly Step[]; color?: string }) {
  return (
    <View accessible style={{ flexDirection: 'row', gap: 4 }} accessibilityRole="progressbar" accessibilityLabel={steps.map((s) => `${s.label} ${s.done ? 'done' : 'pending'}`).join(', ')}>
      {steps.map((s) => (
        <View key={s.label} style={{ flex: 1, minWidth: 0 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: s.done ? color : colors.line }} />
          <Text numberOfLines={1} style={{ marginTop: 6, fontSize: 10, fontWeight: '600', color: s.done ? colors.ink : colors.gray4 }}>
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
