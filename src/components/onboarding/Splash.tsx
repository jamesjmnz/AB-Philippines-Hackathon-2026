import { Text } from 'react-native';

import { Breathe, Enter, LogoMark, colors } from '@/ui';

import { BRAND } from '../present';

/**
 * Splash (design 37–45): white, centred column with 16pt gaps, the 92pt logo tile breathing
 * (scale 1 → 1.06 over 2.4s), the wordmark at 34pt extrabold and the tagline at 15pt grey.
 * Also shown while the app's local services start.
 */
export function Splash({ testID = 'splash-screen', message }: { testID?: string; message?: string }) {
  return (
    <Enter testID={testID} kind="fadeIn" duration={500} style={{ flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 24 }}>
      <Breathe>
        <LogoMark box={92} radius={28} glyph={54} stroke={3} halo dot />
      </Breathe>
      <Text accessibilityRole="header" style={{ fontSize: 34, fontWeight: '800', letterSpacing: -1, color: colors.ink, marginTop: 6 }}>
        {BRAND}
      </Text>
      <Text style={{ fontSize: 15, color: colors.gray1, textAlign: 'center' }}>Intelligence that stays with you.</Text>
      {message ? (
        <Text testID="starting-message" accessibilityLiveRegion="polite" style={{ fontSize: 13, lineHeight: 18.2, color: colors.gray2, textAlign: 'center' }}>
          {message}
        </Text>
      ) : null}
    </Enter>
  );
}
