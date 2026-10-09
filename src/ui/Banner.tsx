import { Text, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { tones, type Tone } from './theme';

type Props = { text: string; tone?: Tone; icon?: IconName; testID?: string };

export function Banner({ text, tone = 'amber', icon = 'info', testID }: Props) {
  const t = tones[tone];
  return (
    <View testID={testID} accessibilityRole="alert" className="flex-row gap-2 rounded-2xl px-[14px] py-3" style={{ backgroundColor: t.bg }}>
      <Icon name={icon} size={18} color={t.fg} filled />
      <Text className="flex-1 text-[13px] leading-[18px]" style={{ color: t.fg }}>
        {text}
      </Text>
    </View>
  );
}
