import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, colors, type IconName } from '@/ui';
import { Text } from '@/ui/Text';

/** Section title of the incident scroll (design 497, 512, 518, 537): 13/600 grey, padding 4 4 0. */
export function SectionTitle({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={{ fontSize: 13, fontWeight: '600', color: colors.gray1, paddingTop: 4, paddingHorizontal: 4 }}>
      {children}
    </Text>
  );
}

/** White 22pt card whose rows clip to the corners. */
export function CardBox({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View testID={testID} style={[{ backgroundColor: '#FFFFFF', borderRadius: 22, overflow: 'hidden' }, style]}>
      {children}
    </View>
  );
}

/** Status / provenance pill: 11pt bold, padding 4/8 (3/8 and semibold in the evidence list). */
export function TagPill({ label, fg, bg, weight = '700', py = 4, testID }: { label: string; fg: string; bg: string; weight?: '600' | '700'; py?: number; testID?: string }) {
  return (
    <View testID={testID} style={{ flexShrink: 0, backgroundColor: bg, borderRadius: 999, paddingVertical: py, paddingHorizontal: 8 }}>
      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: weight, color: fg }}>
        {label}
      </Text>
    </View>
  );
}

type MoreRowProps = { icon: IconName; label: string; onPress: () => void; first?: boolean; testID?: string; expanded?: boolean };

/** Row of the design's "More" card (539–555): padding 14/16, gap 14, 20pt icon, 15/500 label, grey chevron. */
export function MoreRow({ icon, label, onPress, first, testID, expanded }: MoreRowProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: '#FFFFFF', borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline }}>
      <Icon name={icon} size={20} />
      <Text style={{ flex: 1, fontSize: 15, fontWeight: '500', color: colors.ink }}>{label}</Text>
      <Icon name="chevron_right" size={20} color={colors.gray5} />
    </Pressable>
  );
}

/** Label/value line shared by the Details and Relay sheets (design 820): 14.5pt, padding 12/0, hairline below. */
export function SheetRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
      <Text style={{ fontSize: 14, color: colors.gray1 }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

/** Design colours without a theme token. */
export const INK_LINES = { coralLine: '#F3CFCD', indigoLine: '#E1E3F2', fillInput: '#FAFAFB', amberDeep: '#7A4E0B' } as const;
