import { useEffect, useState, type ReactNode } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';

/**
 * Motion from the design's @keyframes (design/PULSE-2.6.dc.html lines 19–29), with the same
 * durations and timing functions. Everything here is static when Reduce Motion is on.
 */
export const EASE = {
  /** CSS `ease` */
  ease: Easing.bezier(0.25, 0.1, 0.25, 1),
  /** CSS `ease-out` */
  out: Easing.bezier(0, 0, 0.58, 1),
  /** CSS `ease-in-out` */
  inOut: Easing.bezier(0.42, 0, 0.58, 1),
  /** cubic-bezier(.2,.9,.3,1): sheets, pop-ins, toggles, rings */
  spring: Easing.bezier(0.2, 0.9, 0.3, 1),
  /** cubic-bezier(.4,0,.2,1): map pins */
  move: Easing.bezier(0.4, 0, 0.2, 1),
  linear: Easing.linear,
} as const;

export type EaseName = keyof typeof EASE;
export type EnterKind = 'fadeUp' | 'fadeIn' | 'slideIn' | 'popIn' | 'toastIn';

const DEFAULT_MS: Record<EnterKind, number> = { fadeUp: 350, fadeIn: 500, slideIn: 350, popIn: 400, toastIn: 350 };

type EnterProps = {
  kind?: EnterKind;
  /** Milliseconds. Defaults to the value the design uses most for that keyframe. */
  duration?: number;
  ease?: EaseName;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
};

/**
 * One-shot entrance: fadeUp (10px), fadeIn, slideIn (28px from the right), popIn (scale .94) and
 * toastIn (12px from above). Layout goes on `style`; the animation only touches opacity and transform.
 */
export function Enter({ kind = 'fadeUp', duration, ease = 'ease', style, children, testID, pointerEvents }: EnterProps) {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);
  const ms = duration ?? DEFAULT_MS[kind];

  useEffect(() => {
    if (reduced) {
      t.value = 1;
      return undefined;
    }
    t.value = withTiming(1, { duration: ms, easing: EASE[ease] });
    return () => cancelAnimation(t);
  }, [reduced, ms, ease, t]);

  const animated = useAnimatedStyle(() => {
    const p = t.value;
    switch (kind) {
      case 'fadeUp':
        return { opacity: p, transform: [{ translateY: 10 * (1 - p) }] };
      case 'slideIn':
        return { opacity: p, transform: [{ translateX: 28 * (1 - p) }] };
      case 'popIn':
        return { opacity: p, transform: [{ scale: 0.94 + 0.06 * p }] };
      case 'toastIn':
        return { opacity: p, transform: [{ translateY: -12 * (1 - p) }] };
      default:
        return { opacity: p };
    }
  });

  return (
    <Animated.View testID={testID} pointerEvents={pointerEvents} style={[style, animated]}>
      {children}
    </Animated.View>
  );
}

/** sheetUp: translateY(100%) → 0 over .42s cubic-bezier(.2,.9,.3,1). The height is measured first. */
export function SheetUp({ style, children, testID }: { style?: StyleProp<ViewStyle>; children?: ReactNode; testID?: string }) {
  const reduced = useReducedMotion();
  const [height, setHeight] = useState<number | null>(null);
  const t = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      t.value = 1;
      return undefined;
    }
    if (height === null) return undefined;
    t.value = withTiming(1, { duration: 420, easing: EASE.spring });
    return () => cancelAnimation(t);
  }, [reduced, height, t]);

  const onLayout = (e: LayoutChangeEvent) => {
    if (height === null) setHeight(e.nativeEvent.layout.height);
  };
  const h = height ?? 0;
  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: h * (1 - t.value) }] }), [h]);

  return (
    <Animated.View testID={testID} onLayout={onLayout} style={[style, { opacity: height === null && !reduced ? 0 : 1 }, animated]}>
      {children}
    </Animated.View>
  );
}

type PulseProps = {
  /** Diameter of the ring at scale 1. */
  size: number;
  color: string;
  active?: boolean;
  durationMs?: number;
  delayMs?: number;
  /** Draws an outline of this width instead of a filled disc (the Welcome orbit ring). */
  outline?: number;
  style?: StyleProp<ViewStyle>;
};

/** pulseRing: scale .7 → 2.2 while opacity .45 → 0, ease-out, repeating. Decorative. */
export function PulseRing({ size, color, active = true, durationMs = 1600, delayMs = 0, outline, style }: PulseProps) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!active || reduced) {
      cancelAnimation(t);
      t.value = 0;
      return undefined;
    }
    t.value = withDelay(delayMs, withRepeat(withTiming(1, { duration: durationMs, easing: EASE.out }), -1, false));
    return () => cancelAnimation(t);
  }, [active, reduced, durationMs, delayMs, t]);

  const animated = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - t.value), transform: [{ scale: 0.7 + 1.5 * t.value }] }));
  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { position: 'absolute', width: size, height: size, borderRadius: size / 2 },
        outline ? { borderWidth: outline, borderColor: color } : { backgroundColor: color },
        animated,
        style,
      ]}
    />
  );
}

/** spin: one turn per `durationMs`, linear, repeating. */
export function Spin({ durationMs = 800, children, style }: { durationMs?: number; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduced) return undefined;
    t.value = withRepeat(withTiming(1, { duration: durationMs, easing: EASE.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [reduced, durationMs, t]);
  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: `${360 * t.value}deg` }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** The 18px two-tone spinner used for the current processing step. */
export function Spinner({ size = 18, width = 2.5, color = '#151515', track = '#E3E3E8' }: { size?: number; width?: number; color?: string; track?: string }) {
  return (
    <Spin style={{ width: size, height: size }}>
      <Animated.View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: width, borderColor: track, borderTopColor: color }} />
    </Spin>
  );
}

/** breathe: scale 1 → 1.06 → 1 over 2.4s, ease-in-out, repeating. */
export function Breathe({ children, style, durationMs = 2400 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; durationMs?: number }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduced) return undefined;
    t.value = withRepeat(withTiming(1, { duration: durationMs / 2, easing: EASE.inOut }), -1, true);
    return () => cancelAnimation(t);
  }, [reduced, durationMs, t]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.06 * t.value }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

function WaveBar({ delayMs, color }: { delayMs: number; color: string }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduced) return undefined;
    t.value = withDelay(delayMs, withRepeat(withTiming(1, { duration: 450, easing: EASE.inOut }), -1, true));
    return () => cancelAnimation(t);
  }, [reduced, delayMs, t]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.25 + 0.75 * t.value }] }));
  return <Animated.View style={[{ width: 4, height: 28, borderRadius: 2, backgroundColor: color }, animated]} />;
}

/** wave: five 4×28 bars, scaleY .25 ↔ 1 over .9s, each 150ms after the last. */
export function WaveBars({ color = '#ED625E' }: { color?: string }) {
  return (
    <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 28 }}>
      {[0, 150, 300, 450, 600].map((d) => (
        <WaveBar key={d} delayMs={d} color={color} />
      ))}
    </Animated.View>
  );
}

/** packet: an 8px coral dot travelling down a connector of height `travel` in 1s, ease-in-out, repeating. */
export function PacketDot({ travel = 44, left = 19 }: { travel?: number; left?: number }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduced) return undefined;
    t.value = withRepeat(withTiming(1, { duration: 1000, easing: EASE.inOut }), -1, false);
    return () => cancelAnimation(t);
  }, [reduced, t]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: (travel - 8) * t.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: left - 4, top: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: 'rgba(237,98,94,0.18)', alignItems: 'center', justifyContent: 'center' }, animated]}>
      <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#ED625E' }} />
    </Animated.View>
  );
}
