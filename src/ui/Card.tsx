import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { colors } from './theme';
import { Text } from './Text';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <View className={`rounded-card bg-card p-4 ${className}`}>{children}</View>;
}

export function SectionHeader({ title }: { title: string }) {
  return (
    <Text accessibilityRole="header" className="px-1 pb-2 text-[13px] font-semibold text-gray-1">
      {title}
    </Text>
  );
}

/** White rounded card whose rows are separated by hairlines. */
export function GroupedList({ children }: { children: ReactNode }) {
  return <View className="overflow-hidden rounded-card bg-card">{children}</View>;
}

type RowProps = {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: IconName;
  iconColor?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  first?: boolean;
  destructive?: boolean;
  testID?: string;
};

export function ListRow({ title, subtitle, value, icon, iconColor, onPress, trailing, first, destructive, testID }: RowProps) {
  const body = (
    <View className={`min-h-[54px] flex-row items-center gap-3 px-4 py-3 ${first ? '' : 'border-t border-hairline'}`}>
      {icon ? (
        <View className="h-9 w-9 items-center justify-center rounded-tile bg-hairline">
          <Icon name={icon} size={20} color={iconColor ?? colors.ink} />
        </View>
      ) : null}
      <View className="flex-1">
        <Text className={`text-[15px] font-semibold ${destructive ? 'text-coral-text' : 'text-ink'}`}>{title}</Text>
        {subtitle ? <Text className="mt-0.5 text-[13px] text-gray-1">{subtitle}</Text> : null}
      </View>
      {value ? <Text className="max-w-[45%] text-right text-[14px] text-gray-1">{value}</Text> : null}
      {trailing}
      {onPress && !trailing ? <Icon name="chevron_right" size={20} color={colors.gray5} /> : null}
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} onPress={onPress}>
      {body}
    </Pressable>
  );
}
