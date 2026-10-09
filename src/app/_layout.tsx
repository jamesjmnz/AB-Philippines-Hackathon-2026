import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AppRoot } from '@/components/AppRoot';
import { useAppMode } from '@/components/appMode';
import { colors } from '@/ui/theme';

export default function RootLayout() {
  // Demo draws the ink SIMULATED bar under the status bar, so its text has to be light there.
  const demo = useAppMode((s) => s.mode) === 'demo';
  return (
    <>
      <StatusBar style={demo ? 'light' : 'dark'} />
      <AppRoot>
        {/* Every screen is a card inside this stack, so the SIMULATED bar above it stays visible in Demo. */}
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(onboarding)" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="sos" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
          <Stack.Screen name="incident/[id]/index" />
          <Stack.Screen name="incident/[id]/report" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="pair" />
          <Stack.Screen name="demo-lab/index" />
          <Stack.Screen name="demo-lab/local-ai" />
          <Stack.Screen name="demo-lab/session" />
        </Stack>
      </AppRoot>
    </>
  );
}
