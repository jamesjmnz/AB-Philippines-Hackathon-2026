import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors } from './theme';

type RingProps = { size: number; stroke?: number; progress: number; color?: string; track?: string; children?: ReactNode };

/** Circular progress ring; `progress` is 0..1. */
export function ProgressRing({ size, stroke = 6, progress, color = colors.ink, track = '#F0F0F2', children }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - p)}
          fill="none"
        />
      </Svg>
      {children}
    </View>
  );
}

export type Step = { label: string; done: boolean };

/** Five-step delivery bar. A step is filled only when the state it names has actually been reached. */
export function StepBar({ steps, color = colors.green }: { steps: readonly Step[]; color?: string }) {
  return (
    <View accessible className="flex-row gap-1.5" accessibilityRole="progressbar" accessibilityLabel={steps.map((s) => `${s.label} ${s.done ? 'done' : 'pending'}`).join(', ')}>
      {steps.map((s) => (
        <View key={s.label} className="flex-1 gap-1">
          <View className="h-1 rounded-full" style={{ backgroundColor: s.done ? color : colors.line }} />
          <Text numberOfLines={1} className={`text-[10px] font-semibold ${s.done ? 'text-ink' : 'text-gray-4'}`}>
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
