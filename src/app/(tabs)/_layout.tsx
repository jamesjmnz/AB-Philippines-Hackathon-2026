import { Redirect, router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { routes } from '@/components/nav';
import { PulseTabBar } from '@/components/PulseTabBar';
import { usePulse } from '@/services/PulseProvider';
import { colors } from '@/ui/theme';

export default function TabsLayout() {
  const { me } = usePulse();
  if (!me.onboarded) return <Redirect href={routes.onboarding} />;
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.page } }}
      tabBar={({ state, navigation }) => (
        <PulseTabBar active={state.routes[state.index]?.name ?? 'index'} onSelect={(key) => navigation.navigate(key)} onSOS={() => router.push(routes.sos)} />
      )}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="network" options={{ title: 'Network' }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
