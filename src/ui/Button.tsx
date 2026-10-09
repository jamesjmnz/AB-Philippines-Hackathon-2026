import { Pressable, Text, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { colors } from './theme';

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

const BG: Record<Variant, string> = { primary: 'bg-ink', urgent: 'bg-coral', secondary: 'bg-fill-pill' };
const FG: Record<Variant, string> = { primary: 'text-white', urgent: 'text-white', secondary: 'text-ink' };
const HEIGHT: Record<Size, string> = { lg: 'min-h-[58px]', md: 'min-h-[50px]', sm: 'min-h-[44px]' };
const TEXT: Record<Size, string> = { lg: 'text-[17px]', md: 'text-[16px]', sm: 'text-[14.5px]' };

/** Pill call-to-action from the PULSE design: black primary, coral urgent, grey secondary. */
export function Button({ label, onPress, variant = 'primary', size = 'lg', icon, disabled, accessibilityHint, testID }: Props) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`flex-row items-center justify-center gap-2 rounded-full px-5 active:scale-[0.98] ${HEIGHT[size]} ${
        disabled ? 'bg-line-disabled' : BG[variant]
      }`}>
      {icon ? <Icon name={icon} size={20} color={variant === 'secondary' && !disabled ? colors.ink : '#FFFFFF'} filled /> : null}
      <Text className={`font-semibold ${TEXT[size]} ${disabled ? 'text-white' : FG[variant]}`}>{label}</Text>
    </Pressable>
  );
}

type TextButtonProps = { label: string; onPress: () => void; tone?: 'ink' | 'gray' | 'coral'; testID?: string };
const TONE = { ink: 'text-ink', gray: 'text-gray-1', coral: 'text-coral-text' } as const;

export function TextButton({ label, onPress, tone = 'gray', testID }: TextButtonProps) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} hitSlop={8} className="min-h-[44px] items-center justify-center px-3">
      <Text className={`text-[15px] font-semibold ${TONE[tone]}`}>{label}</Text>
    </Pressable>
  );
}

type IconButtonProps = { icon: IconName; label: string; onPress: () => void; onCard?: boolean };

export function IconButton({ icon, label, onPress, onCard }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      className={`h-[42px] w-[42px] items-center justify-center rounded-full ${onCard ? 'bg-hairline' : 'bg-card'}`}>
      <View>
        <Icon name={icon} size={20} />
      </View>
    </Pressable>
  );
}
