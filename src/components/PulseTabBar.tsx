import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Press, colors, tabBarHeight, type IconName } from '@/ui';

export type TabKey = 'index' | 'network' | 'activity' | 'settings';

type Item = { key: TabKey; label: string; icon: IconName };

const LEFT: readonly Item[] = [
  { key: 'index', label: 'Home', icon: 'home' },
  { key: 'network', label: 'Network', icon: 'hub' },
];
const RIGHT: readonly Item[] = [
  { key: 'activity', label: 'Activity', icon: 'history' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

type Props = { active: string; onSelect: (key: TabKey) => void; onSOS: () => void };

function Tab({ item, selected, onPress }: { item: Item; selected: boolean; onPress: () => void }) {
  const color = selected ? colors.ink : colors.gray4;
  return (
    <Pressable
      testID={`tab-${item.key}`}
      accessibilityRole="tab"
      accessibilityLabel={item.label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ flex: 1, minHeight: 52, alignItems: 'center', gap: 4, paddingVertical: 6 }}>
      <Icon name={item.icon} size={25} color={color} filled={selected} />
      <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 10.5, fontWeight: '600', color }}>
        {item.label}
      </Text>
    </Pressable>
  );
}

/**
 * Tab bar (design 661–671): 94px tall in the design frame (60pt above the home-indicator inset), five
 * equal columns, padding 8/6/0, a #EEEEF0 top hairline, and the raised 62pt coral SOS
 * button (4pt white border, margin-top -22, shadow 0 4px 12px rgba(237,98,94,.22), scale .94 on press).
 * The design is white at 94% over a 20px backdrop blur; there is no blur module in the build, so the
 * bar is opaque instead of letting sharp content show through.
 */
export function PulseTabBar({ active, onSelect, onSOS }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="tab-bar"
      accessibilityRole="tablist"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: tabBarHeight(insets.bottom),
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingTop: 8,
        paddingHorizontal: 6,
        backgroundColor: '#FFFFFF',
        borderTopWidth: 1,
        borderTopColor: colors.line,
      }}>
      {LEFT.map((item) => (
        <Tab key={item.key} item={item} selected={active === item.key} onPress={() => onSelect(item.key)} />
      ))}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Press
          testID="tab-sos"
          accessibilityRole="button"
          accessibilityLabel="Request assistance"
          accessibilityHint="Opens the SOS countdown"
          onPress={onSOS}
          hitSlop={6}
          press={0.94}
          style={{
              width: 62,
              height: 62,
              borderRadius: 31,
              marginTop: -22,
              backgroundColor: colors.coral,
              borderWidth: 4,
              borderColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: colors.coral,
              shadowOpacity: 0.22,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
          }}>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: '800', letterSpacing: 0.5, color: '#FFFFFF' }}>
            SOS
          </Text>
        </Press>
      </View>
      {RIGHT.map((item) => (
        <Tab key={item.key} item={item} selected={active === item.key} onPress={() => onSelect(item.key)} />
      ))}
    </View>
  );
}
