import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Banner, Button, Icon, IconButton, ProgressRing, PulseRing, TextButton, colors, type IconName } from '@/ui';

import { routes } from '../nav';

type Phase = 'counting' | 'sending' | 'failed';

/**
 * Manual SOS. Both send paths call `sendSOS()` before anything else and navigate only after it
 * returns. Nothing here awaits AI, the microphone, a permission prompt or the radio.
 */
export function SOSScreen() {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const insets = useSafeAreaInsets();
  const total = Math.max(1, Math.round(snapshot.settings.sosCountdownSeconds));
  const [count, setCount] = useState(total);
  const [phase, setPhase] = useState<Phase>('counting');
  const inFlight = useRef(false);

  const send = useCallback(
    async (then: 'incident' | 'report') => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPhase('sending');
      const pending = actions.sendSOS();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      let result: Awaited<typeof pending>;
      try {
        result = await pending;
      } catch {
        result = { ok: false, code: 'unexpected', message: '' };
      }
      if (result.ok) {
        router.replace(then === 'report' ? routes.report(result.value.incidentId) : routes.incident(result.value.incidentId));
        return;
      }
      inFlight.current = false;
      setPhase('failed');
    },
    [actions],
  );

  useEffect(() => {
    if (phase !== 'counting') return undefined;
    const timer = setTimeout(() => {
      if (count <= 1) {
        setCount(0);
        void send('incident');
      } else {
        setCount(count - 1);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [count, phase, send]);

  const trusted = snapshot.peers.filter((p) => p.trusted);
  const connected = trusted.filter((p) => p.reach === 'connected');
  const rows: { icon: IconName; label: string; value: string }[] = [
    { icon: 'group', label: 'Trusted devices paired', value: String(trusted.length) },
    { icon: 'link', label: 'Connected right now', value: String(connected.length) },
    { icon: 'auto_awesome', label: 'Local AI', value: 'Not needed for SOS' },
  ];

  const sub =
    phase === 'counting'
      ? `Your request will be saved on this device and queued for your trusted devices in ${count} ${count === 1 ? 'second' : 'seconds'}. Works without local AI.`
      : phase === 'sending'
        ? 'Saving your request on this device…'
        : 'Countdown stopped. Your request has not been saved yet.';

  return (
    <View testID="sos-screen" className="flex-1 bg-card" style={{ paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 12, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row justify-end">
          <IconButton icon="close" label="Close without sending" onPress={() => router.back()} onCard />
        </View>
        <Text accessibilityRole="header" className="mt-1 text-[34px] font-extrabold tracking-[-1.2px] text-ink">
          Do you need help?
        </Text>
        <Text accessibilityLiveRegion="polite" className="mt-2 text-[15px] leading-[21px] text-gray-1">
          {sub}
        </Text>

        <View className="my-6 items-center justify-center">
          <View className="h-[170px] w-[170px] items-center justify-center">
            <PulseRing size={130} color={colors.coral} active={phase === 'counting'} durationMs={1400} />
            <ProgressRing size={170} stroke={8} progress={phase === 'counting' ? count / total : 0} color={colors.coral}>
              <View accessible accessibilityRole="timer" accessibilityLabel={phase === 'counting' ? `${count} seconds until the request is saved` : 'Countdown stopped'} className="items-center">
                <Text className="text-[56px] font-extrabold tracking-[-2px] text-coral" style={{ fontVariant: ['tabular-nums'] }}>
                  {phase === 'counting' ? count : '–'}
                </Text>
                <Text className="mt-1 text-[12px] font-semibold text-gray-1">{phase === 'counting' ? 'seconds' : phase === 'sending' ? 'saving' : 'stopped'}</Text>
              </View>
            </ProgressRing>
          </View>
        </View>

        <View className="overflow-hidden rounded-card bg-page">
          {rows.map((r, i) => (
            <View key={r.label} className={`flex-row items-center gap-3 px-4 py-3 ${i === 0 ? '' : 'border-t border-line'}`}>
              <Icon name={r.icon} size={20} />
              <Text className="flex-1 text-[14px] text-gray-2">{r.label}</Text>
              <Text className="text-right text-[14px] font-semibold text-ink">{r.value}</Text>
            </View>
          ))}
        </View>
        {trusted.length === 0 ? (
          <View className="mt-3">
            <Banner testID="sos-no-peer" text="No trusted device paired. The request will be saved on this device, and nobody will receive it until you pair one." />
          </View>
        ) : null}
        {phase === 'failed' ? (
          <View className="mt-3">
            <Banner testID="sos-failed" tone="coral" icon="error" text="The request could not be saved on this device. Nothing was sent. Try again, or call your local emergency number." />
          </View>
        ) : null}
      </ScrollView>

      <View className="gap-[10px] px-[22px] pt-2" style={{ paddingBottom: Math.max(insets.bottom, 12) + 6 }}>
        <Button testID="sos-send" label="Send SOS now" variant="urgent" size="lg" disabled={phase === 'sending'} onPress={() => void send('incident')} accessibilityHint="Saves the request on this device and queues it for your trusted devices" />
        <Button testID="sos-describe" label="Describe what happened" variant="secondary" size="lg" icon="auto_awesome" disabled={phase === 'sending'} onPress={() => void send('report')} accessibilityHint="Saves the request first, then opens the report screen" />
        <TextButton testID="sos-cancel" label="Cancel" onPress={() => router.back()} />
        <Text className="text-center text-[11px] leading-[15px] text-gray-4">
          {snapshot.mode === 'demo' ? 'Simulated · ' : ''}PULSE does not contact emergency services. Nobody is alerted until a trusted device receives this request.
        </Text>
        <Pressable
          testID="sos-call"
          accessibilityRole="link"
          accessibilityLabel="Call emergency number"
          accessibilityHint="Opens the phone dialer with 911. PULSE never calls on its own."
          onPress={() => void Linking.openURL('tel:911')}
          className="min-h-[44px] flex-row items-center justify-center gap-1.5">
          <Icon name="call" size={16} color={colors.coralText} />
          <Text className="text-[14px] font-semibold text-coral-text">Call emergency number</Text>
        </Pressable>
      </View>
    </View>
  );
}
