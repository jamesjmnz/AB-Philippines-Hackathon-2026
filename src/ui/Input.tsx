import { View } from 'react-native';

import { colors } from './theme';
import { Text, TextInput } from './Text';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  label: string;
  /** Renders the label above the field. The label is always used for VoiceOver. */
  showLabel?: boolean;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  onSubmitEditing?: () => void;
  testID?: string;
};

/** Design text field: 13pt radius, hairline border, 16pt text so iOS never zooms or clips. */
export function TextField({ value, onChangeText, label, showLabel, placeholder, multiline, autoFocus, maxLength, onSubmitEditing, testID }: Props) {
  return (
    <View className="gap-1.5">
      {showLabel ? <Text className="text-[12px] font-semibold text-gray-1">{label}</Text> : null}
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.gray4}
        multiline={multiline}
        autoFocus={autoFocus}
        maxLength={maxLength}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={multiline ? 'default' : 'done'}
        textAlignVertical={multiline ? 'top' : 'center'}
        className={`rounded-input border border-line-input bg-fill-input px-[14px] text-[16px] text-ink ${multiline ? 'min-h-[120px] py-3' : 'min-h-[46px] py-2'}`}
      />
    </View>
  );
}
