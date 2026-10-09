import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon, type IconName } from './Icon';
import { EASE } from './Motion';
import { colors } from './theme';

type SegOption<T extends string> = { key: T; label: string; icon?: IconName };

type SegProps<T extends string> = {
  options: readonly SegOption<T>[];
  value: T;
  onChange: (key: T) => void;
  accessibilityLabel: string;
  /** Item height. Design: 32 (Network, Incident, Capsule), 36 (report mode), 28 (Settings rows). */
  height?: number;
  /** Track radius / item radius / track padding. Design: 12/9/3, 13/10/3, 10/8/2. */
  radius?: number;
  itemRadius?: number;
  pad?: number;
  gap?: number;
  fontSize?: number;
  /** Items hug their label (the Settings row segment) instead of sharing the width equally. */
  hug?: boolean;
};

/** The design's segmented control: #EBEBEE track, white selected item with a 0 1px 4px shadow, ink labels. */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel, height = 32, radius = 12, itemRadius = 9, pad = 3, gap = 0, fontSize = 13.5, hug }: SegProps<T>) {
  const slop = Math.max(0, Math.ceil((44 - height) / 2));
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={{ flexDirection: 'row', backgroundColor: colors.fillSeg, borderRadius: radius, padding: pad, gap }}>
      {options.map((o) => {
        const selected = o.key === value;
        return (
          <Pressable
            key={o.key}
            testID={`seg-${o.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.key)}
            hitSlop={{ top: slop, bottom: slop }}
            style={[
              { minHeight: height, borderRadius: itemRadius, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
              hug ? { paddingHorizontal: 10 } : { flex: 1, paddingHorizontal: 2 },
              selected ? { backgroundColor: '#FFFFFF', shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } } : null,
            ]}>
            {o.icon ? <Icon name={o.icon} size={18} /> : null}
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={{ fontSize, fontWeight: '600', color: colors.ink }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type ToggleProps = { value: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; testID?: string };

/**
 * Design toggle: 51×31 track (radius 16), #E3E3E8 off and ink on, 27pt white knob that moves from
 * left 2 to left 22 in .22s cubic-bezier(.2,.9,.3,1).
 */
export function Toggle({ value, onChange, label, disabled, testID }: ToggleProps) {
  const reduced = useReducedMotion();
  const t = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    const to = value ? 1 : 0;
    t.value = reduced ? to : withTiming(to, { duration: 220, easing: EASE.spring });
  }, [value, reduced, t]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: 20 * t.value }] }));
  const fill = useAnimatedStyle(() => ({ opacity: t.value }));
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={{ width: 51, height: 31, borderRadius: 16, backgroundColor: colors.track, opacity: disabled ? 0.4 : 1 }}>
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 16, backgroundColor: colors.ink }, fill]} />
      <Animated.View
        style={[
          { position: 'absolute', top: 2, left: 2, width: 27, height: 27, borderRadius: 13.5, backgroundColor: '#FFFFFF', shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
          knob,
        ]}
      />
    </Pressable>
  );
}

type ChoiceChipProps = { label: string; selected?: boolean; onPress: () => void; testID?: string; ghost?: boolean };

/** 40pt answer chip from the clarification card: white with a #E5E5EA hairline, or borderless grey text (`ghost`). */
export function ChoiceChip({ label, selected, onPress, testID, ghost }: ChoiceChipProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      hitSlop={{ top: 2, bottom: 2 }}
      style={{
        minHeight: 40,
        justifyContent: 'center',
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: ghost ? 'transparent' : selected ? colors.ink : colors.lineInput,
        backgroundColor: ghost ? 'transparent' : selected ? colors.ink : '#FFFFFF',
      }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: ghost ? colors.gray1 : selected ? '#FFFFFF' : colors.ink }}>{label}</Text>
    </Pressable>
  );
}
