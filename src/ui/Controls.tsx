import { Pressable, Text, View } from 'react-native';

type SegProps<T extends string> = {
  options: readonly { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  accessibilityLabel: string;
};

export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: SegProps<T>) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} className="flex-row rounded-xl bg-fill-seg p-[3px]">
      {options.map((o) => {
        const selected = o.key === value;
        return (
          <Pressable
            key={o.key}
            testID={`seg-${o.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.key)}
            className={`min-h-[36px] flex-1 items-center justify-center rounded-[9px] px-1 ${selected ? 'bg-card' : ''}`}>
            <Text numberOfLines={1} className={`text-[13px] font-semibold ${selected ? 'text-ink' : 'text-gray-1'}`}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type ToggleProps = { value: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; testID?: string };

/** Design toggle: black track when on (not iOS green). */
export function Toggle({ value, onChange, label, disabled, testID }: ToggleProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      hitSlop={8}
      className={`h-[31px] w-[51px] justify-center rounded-full px-[2px] ${value ? 'bg-ink' : 'bg-line-track'} ${disabled ? 'opacity-40' : ''}`}>
      <View className={`h-[27px] w-[27px] rounded-full bg-white ${value ? 'self-end' : 'self-start'}`} />
    </Pressable>
  );
}

type ChoiceChipProps = { label: string; selected?: boolean; onPress: () => void; testID?: string };

export function ChoiceChip({ label, selected, onPress, testID }: ChoiceChipProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      className={`min-h-[40px] justify-center rounded-full border px-4 ${selected ? 'border-ink bg-ink' : 'border-line-input bg-card'}`}>
      <Text className={`text-[14px] font-semibold ${selected ? 'text-white' : 'text-ink'}`}>{label}</Text>
    </Pressable>
  );
}
