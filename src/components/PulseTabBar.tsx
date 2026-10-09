import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, colors, type IconName } from '@/ui';

export type TabKey = 'index' | 'network' | 'activity' | 'settings';

const LEFT: readonly { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'index', label: 'Home', icon: 'home' },
  { key: 'network', label: 'Network', icon: 'hub' },
];
const RIGHT: readonly { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'activity', label: 'Activity', icon: 'history' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

type Props = { active: string; onSelect: (key: TabKey) => void; onSOS: () => void };

function Tab({ item, selected, onPress }: { item: { key: TabKey; label: string; icon: IconName }; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={`tab-${item.key}`}
      accessibilityRole="tab"
      accessibilityLabel={item.label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className="min-h-[52px] flex-1 items-center gap-1 py-[6px]">
      <Icon name={item.icon} size={25} color={selected ? colors.ink : colors.gray4} filled={selected} />
      <Text numberOfLines={1} className={`text-[10.5px] font-semibold ${selected ? 'text-ink' : 'text-gray-4'}`}>
        {item.label}
      </Text>
    </Pressable>
  );
}

/** Home | Network | SOS | Activity | Settings, with the raised coral SOS button in the centre. */
export function PulseTabBar({ active, onSelect, onSOS }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      className="absolute bottom-0 left-0 right-0 flex-row items-start border-t border-line px-[6px] pt-2"
      style={{ paddingBottom: Math.max(insets.bottom, 10), backgroundColor: 'rgba(255,255,255,0.96)' }}>
      {LEFT.map((item) => (
        <Tab key={item.key} item={item} selected={active === item.key} onPress={() => onSelect(item.key)} />
      ))}
      <View className="flex-1 items-center">
        <Pressable
          testID="tab-sos"
          accessibilityRole="button"
          accessibilityLabel="Request assistance"
          accessibilityHint="Opens the SOS countdown"
          onPress={onSOS}
          hitSlop={6}
          className="-mt-[22px] h-[62px] w-[62px] items-center justify-center rounded-full border-4 border-white bg-coral active:scale-[0.94]"
          style={{ shadowColor: colors.coral, shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
          <Text maxFontSizeMultiplier={1.4} className="text-[15px] font-extrabold tracking-[0.5px] text-white">
            SOS
          </Text>
        </Pressable>
      </View>
      {RIGHT.map((item) => (
        <Tab key={item.key} item={item} selected={active === item.key} onPress={() => onSelect(item.key)} />
      ))}
    </View>
  );
}
