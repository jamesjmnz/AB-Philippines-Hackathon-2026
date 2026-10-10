import type { Ref } from 'react';
import { Text as NativeText, TextInput as NativeTextInput, type TextInputProps, type TextProps } from 'react-native';

/**
 * The app typeface. The weights are loaded once in the root layout; iOS then picks the face from
 * `fontWeight`, so call sites keep using weights and never name a face.
 */
export const fontFamily = 'Plus Jakarta Sans';

const base = { fontFamily } as const;

/** `Text` from React Native in the app typeface. A `fontFamily` in `style` still wins (monospace details). */
export function Text({ style, ref, ...rest }: TextProps & { ref?: Ref<NativeText> }) {
  return <NativeText ref={ref} {...rest} style={[base, style]} />;
}

/** `TextInput` from React Native in the app typeface. */
export function TextInput({ style, ref, ...rest }: TextInputProps & { ref?: Ref<NativeTextInput> }) {
  return <NativeTextInput ref={ref} {...rest} style={[base, style]} />;
}
