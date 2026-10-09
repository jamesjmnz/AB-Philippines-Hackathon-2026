import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AppRoot } from '@/components/AppRoot';
import { colors } from '@/ui/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
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
        </Stack>
      </AppRoot>
    </>
  );
}
