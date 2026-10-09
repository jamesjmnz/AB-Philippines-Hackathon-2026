import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from './Button';

type Props = {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  headerRight?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra bottom padding so content clears the tab bar. */
  tabbed?: boolean;
  white?: boolean;
  testID?: string;
};

/** Scrolling screen scaffold with the design's 20pt gutters and large title. */
export function Screen({ title, subtitle, onBack, headerRight, children, footer, tabbed, white, testID }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View testID={testID} className={`flex-1 ${white ? 'bg-card' : 'bg-page'}`} style={{ paddingTop: insets.top }}>
      {onBack || headerRight ? (
        <View className="flex-row items-center justify-between px-5 pb-1 pt-2">
          {onBack ? <IconButton icon="arrow_back" label="Back" onPress={onBack} onCard={white} /> : <View />}
          {headerRight}
        </View>
      ) : null}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: (tabbed ? 110 : 32) + (footer ? 0 : insets.bottom), gap: 18 }}>
        {title ? (
          <View className="gap-1">
            <Text accessibilityRole="header" className="text-[30px] font-bold leading-[33px] tracking-[-0.9px] text-ink">
              {title}
            </Text>
            {subtitle ? <Text className="text-[15px] leading-[21px] text-gray-1">{subtitle}</Text> : null}
          </View>
        ) : null}
        {children}
      </ScrollView>
      {footer ? (
        <View className={`gap-2 px-5 pt-2 ${white ? 'bg-card' : 'bg-page'}`} style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}
