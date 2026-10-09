import { requireOptionalNativeModule } from 'expo';
import type { BlurView as ExpoBlurView } from 'expo-blur';
import { StyleSheet } from 'react-native';

/**
 * `expo-blur` needs its native view in the installed build. A development build made before the
 * package was added does not have it, and rendering `BlurView` there would crash, so the module is
 * probed first and loaded only when present.
 */
function loadBlurView(): typeof ExpoBlurView | null {
  if (requireOptionalNativeModule('ExpoBlur') === null) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-blur') as typeof import('expo-blur')).BlurView;
  } catch {
    return null;
  }
}

const BlurView = loadBlurView();

/** Whether a backdrop blur can be drawn in this build. Callers stay opaque when it cannot. */
export const backdropBlurAvailable = BlurView !== null;

/** Fills its parent with a backdrop blur (the design's `backdrop-filter`). Renders nothing without the native view. */
export function Backdrop({ intensity = 40 }: { intensity?: number }) {
  if (!BlurView) return null;
  return <BlurView pointerEvents="none" tint="light" intensity={intensity} style={StyleSheet.absoluteFill} />;
}
