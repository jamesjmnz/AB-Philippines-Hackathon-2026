import { Text, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { colors, tones, type Tone } from './theme';

export type TimelineEntry = {
  id: string;
  icon: IconName;
  tone: Tone;
  solid?: boolean;
  label: string;
  time: string;
  meta?: string;
  pending?: boolean;
};

export function TimelineItem({ entry, last }: { entry: TimelineEntry; last?: boolean }) {
  const t = tones[entry.tone];
  return (
    <View className={`flex-row gap-3 ${entry.pending ? 'opacity-60' : ''}`} accessible accessibilityLabel={`${entry.label}, ${entry.time}${entry.meta ? `, ${entry.meta}` : ''}`}>
      <View className="items-center">
        <View
          className={`h-7 w-7 items-center justify-center rounded-full ${entry.pending ? 'border border-dashed border-line-disabled bg-card' : ''}`}
          style={entry.pending ? undefined : { backgroundColor: entry.solid ? colors.green : t.bg }}>
          <Icon name={entry.pending ? 'more_horiz' : entry.icon} size={16} color={entry.pending ? colors.gray4 : entry.solid ? '#FFFFFF' : t.fg} />
        </View>
        {last ? null : <View className="w-0.5 flex-1 bg-line" />}
      </View>
      <View className="flex-1 pb-4">
        <View className="flex-row items-start justify-between gap-2">
          <Text className="flex-1 text-[14.5px] font-semibold text-ink">{entry.label}</Text>
          <Text className="text-[12px] text-gray-1">{entry.time}</Text>
        </View>
        {entry.meta ? <Text className="mt-0.5 text-[12.5px] text-gray-1">{entry.meta}</Text> : null}
      </View>
    </View>
  );
}
