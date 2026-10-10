import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/ui';
import { Text } from '@/ui/Text';

/** Persistent marker above every screen while the DEMO bundle is active. Never rendered in live mode. */
export function SimulatedBar() {
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="simulated-bar"
      accessible
      accessibilityRole="header"
      accessibilityLabel="Simulated. Demo mode. Nothing on screen is real."
      style={{ paddingTop: insets.top, backgroundColor: colors.ink }}>
      <View className="flex-row items-center justify-center gap-2 px-4 py-[6px]">
        <Text className="text-[12px] font-bold tracking-[1.2px] text-white">SIMULATED</Text>
        <Text className="text-[12px] font-semibold text-gray-5">Demo mode · nothing here is real</Text>
      </View>
    </View>
  );
}
