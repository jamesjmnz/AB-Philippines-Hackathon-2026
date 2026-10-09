import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

type Props = { size: number; color: string; active?: boolean; durationMs?: number; style?: StyleProp<ViewStyle> };

/** Expanding, fading ring behind a live element. Static when Reduce Motion is on. Decorative. */
export function PulseRing({ size, color, active = true, durationMs = 1600, style }: Props) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!active || reduced) {
      cancelAnimation(t);
      t.value = 0;
      return undefined;
    }
    t.value = withRepeat(withTiming(1, { duration: durationMs, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(t);
  }, [active, reduced, durationMs, t]);

  const animated = useAnimatedStyle(() => ({ opacity: 0.35 * (1 - t.value), transform: [{ scale: 0.85 + 0.45 * t.value }] }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, animated, style]}
    />
  );
}
