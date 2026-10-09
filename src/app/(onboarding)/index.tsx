import { Redirect } from 'expo-router';

import { routes } from '@/components/nav';
import { OnboardingScreen } from '@/components/onboarding/OnboardingScreen';
import { usePulse } from '@/services/PulseProvider';

export default function OnboardingRoute() {
  const { me } = usePulse();
  if (me.onboarded) return <Redirect href={routes.home} />;
  return <OnboardingScreen />;
}
