import { useState } from 'react';
import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { colors, design } from './theme';
import { Text } from './Text';

type PressProps = Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; /** `style-active` scale from the design. 1 = none. */ press?: number };

/**
 * Pressable with the design's press scale. NativeWind's JSX transform drops function-form `style` on
 * Pressable, so the pressed state is tracked here and the style stays a plain value.
 */
export function Press({ style, press = 1, onPressIn, onPressOut, ...rest }: PressProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
      style={[style, pressed && press !== 1 ? { transform: [{ scale: press }] } : null]}
    />
  );
}

type PillTone = 'ink' | 'coral' | 'soft' | 'softer' | 'white';

const PILL_BG: Record<PillTone, string> = { ink: colors.ink, coral: colors.coral, soft: design.soft, softer: design.softer, white: '#FFFFFF' };
const PILL_FG: Record<PillTone, string> = { ink: '#FFFFFF', coral: '#FFFFFF', soft: colors.ink, softer: colors.ink, white: colors.ink };

type PillProps = {
  label: string;
  onPress: () => void;
  tone?: PillTone;
  /** Design height in px. Used as a minimum so large Dynamic Type never clips. */
  h?: number;
  /** Font size and weight exactly as in the design. */
  size?: number;
  weight?: '500' | '600' | '700' | '800';
  icon?: IconName;
  iconSize?: number;
  iconFilled?: boolean;
  /** `style-active` scale from the design (.98, .97, .94). 1 = no press scale. */
  press?: number;
  disabled?: boolean;
  /** How a disabled pill looks: `fade` = opacity .35 (most of the design), `gray` = #D5D5DA fill (onboarding CTA). */
  disabledLook?: 'fade' | 'gray';
  /** Coral drop shadow of the "Send SOS now" button. */
  glow?: boolean;
  /** Corner radius; the design uses 999 except for the 11–12pt demo tiles. */
  radius?: number;
  /** Horizontal padding for pills that hug their label. Omit for full-width / flex pills. */
  px?: number;
  flex?: boolean;
  fg?: string;
  bg?: string;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

/** The design's pill button with every dimension passed explicitly from the markup. */
export function Pill({
  label,
  onPress,
  tone = 'ink',
  h = 58,
  size = 17,
  weight = '600',
  icon,
  iconSize = 20,
  iconFilled,
  press = 1,
  disabled,
  disabledLook = 'fade',
  glow,
  radius = 999,
  px,
  flex,
  fg,
  bg,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: PillProps) {
  const slop = Math.max(0, Math.ceil((44 - h) / 2));
  const background = disabled && disabledLook === 'gray' ? colors.disabled : (bg ?? PILL_BG[tone]);
  const color = disabled && disabledLook === 'gray' ? '#FFFFFF' : (fg ?? PILL_FG[tone]);
  return (
    <Press
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: slop, bottom: slop }}
      press={press}
      style={[
        {
          minHeight: h,
          borderRadius: radius,
          backgroundColor: background,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: icon ? (size >= 18 ? 10 : size <= 13.5 ? 6 : 8) : 0,
          paddingHorizontal: px ?? 12,
          opacity: disabled && disabledLook === 'fade' ? 0.35 : 1,
        },
        flex ? { flex: 1 } : null,
        glow ? { shadowColor: colors.coral, shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } } : null,
      ]}>
      {icon ? <Icon name={icon} size={iconSize} color={color} filled={iconFilled} /> : null}
      <Text style={{ fontSize: size, fontWeight: weight, color, textAlign: 'center' }}>{label}</Text>
    </Press>
  );
}

type LinkProps = { label: string; onPress: () => void; color?: string; size?: number; h?: number; testID?: string; accessibilityHint?: string; disabled?: boolean };

/** Borderless text button (`border:none;background:none`) with a 44pt touch target. */
export function LinkButton({ label, onPress, color = colors.ink, size = 14, h = 44, testID, accessibilityHint, disabled }: LinkProps) {
  const slop = Math.max(0, Math.ceil((44 - h) / 2));
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: slop, bottom: slop, left: 6, right: 6 }}
      style={{ minHeight: h, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}>
      <Text style={{ fontSize: size, fontWeight: '600', color }}>{label}</Text>
    </Pressable>
  );
}

type Variant = 'primary' | 'urgent' | 'secondary';
type Size = 'lg' | 'md' | 'sm';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

const TONE_OF: Record<Variant, PillTone> = { primary: 'ink', urgent: 'coral', secondary: 'soft' };
const HEIGHT: Record<Size, number> = { lg: 58, md: 54, sm: 46 };
const TEXT: Record<Size, number> = { lg: 17, md: 16, sm: 14.5 };

/** Named-size pill for screens that are not in the design (pairing, diagnostics). */
export function Button({ label, onPress, variant = 'primary', size = 'lg', icon, disabled, accessibilityHint, testID }: Props) {
  return (
    <Pill
      testID={testID}
      label={label}
      onPress={onPress}
      tone={TONE_OF[variant]}
      h={HEIGHT[size]}
      size={TEXT[size]}
      icon={icon}
      disabled={disabled}
      disabledLook="gray"
      press={0.98}
      accessibilityHint={accessibilityHint}
    />
  );
}

type TextButtonProps = { label: string; onPress: () => void; tone?: 'ink' | 'gray' | 'coral'; testID?: string };
const TONE = { ink: colors.ink, gray: colors.gray1, coral: colors.coralText } as const;

export function TextButton({ label, onPress, tone = 'gray', testID }: TextButtonProps) {
  return <LinkButton testID={testID} label={label} onPress={onPress} color={TONE[tone]} size={15} h={44} />;
}

type IconButtonProps = { icon: IconName; label: string; onPress: () => void; onCard?: boolean; size?: number; testID?: string };

/** Round header button: 40pt (42 in Demo Lab and Safety Session), white on the page or #F2F2F4 on white. */
export function IconButton({ icon, label, onPress, onCard, size = 40, testID }: IconButtonProps) {
  const slop = Math.max(0, Math.ceil((44 - size) / 2));
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={slop}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: onCard ? colors.hairline : '#FFFFFF' }}>
      <View>
        <Icon name={icon} size={20} />
      </View>
    </Pressable>
  );
}
