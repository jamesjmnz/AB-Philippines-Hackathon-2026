import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Banner, Icon, IconButton, LinkButton, Pill, PulseRing, Ring, colors, design, padBottom, type IconName } from '@/ui';

import { routes } from '../nav';
import { BRAND } from '../present';
import { Text } from '@/ui/Text';

type Phase = 'counting' | 'sending' | 'failed';

/**
 * Manual SOS (design 677–702). Both send paths call `sendSOS()` before anything else and navigate
 * only after it returns. Nothing here awaits AI, the microphone, a permission prompt or the radio.
 *
 * Layout is the design's full-height white sheet: padding 22 at the sides, 40 at the bottom, a 40pt
 * close button, the 170pt countdown ring, the context card and the three stacked buttons.
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
  // The design's three context rows, bound to measured state (no stored location exists).
  const rows: { icon: IconName; label: string; value: string }[] = [
    { icon: 'group', label: 'Trusted devices', value: `${trusted.length} paired` },
    { icon: 'cell_tower', label: 'Connected right now', value: String(connected.length) },
    { icon: 'auto_awesome', label: 'Local AI', value: 'Not needed for SOS' },
  ];

  const sub =
    phase === 'counting'
      ? `Your request will be saved on this device and queued for your trusted devices in ${count} ${count === 1 ? 'second' : 'seconds'}. Works without local AI.`
      : phase === 'sending'
        ? 'Saving your request on this device…'
        : 'Countdown stopped. Your request has not been saved yet.';
  const counting = phase === 'counting';

  return (
    <View testID="sos-screen" style={{ flex: 1, backgroundColor: '#FFFFFF', paddingTop: insets.top }}>
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 22, paddingBottom: padBottom(insets.bottom) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 8 }}>
          <IconButton testID="sos-close" icon="close" label="Close without sending" onPress={() => router.back()} onCard size={40} />
        </View>
        <Text accessibilityRole="header" style={{ fontSize: 34, fontWeight: '700', letterSpacing: -0.6, color: colors.ink, marginTop: 4 }}>
          Do you need help?
        </Text>
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 15, lineHeight: 21, color: colors.gray1, marginTop: 8 }}>
          {sub}
        </Text>

        <View style={{ alignItems: 'center', marginTop: 26, marginBottom: 22 }}>
          <View style={{ width: 170, height: 170 }}>
            <PulseRing size={130} color={colors.coral} active={counting} durationMs={1600} style={{ left: 20, top: 20 }} />
            <Ring size={170} r={74} stroke={10} progress={counting ? count / total : 0} color={colors.coral} track={design.coralRingTrack} fill="#FFFFFF" durationMs={1000} ease="linear">
              <View accessible accessibilityRole="timer" accessibilityLabel={counting ? `${count} seconds until the request is saved` : 'Countdown stopped'} style={{ alignItems: 'center' }}>
                <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 56, lineHeight: 56, fontWeight: '700', letterSpacing: -0.6, color: colors.coral, fontVariant: ['tabular-nums'] }}>
                  {counting ? count : '–'}
                </Text>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.gray1, marginTop: 4 }}>{counting ? 'seconds' : phase === 'sending' ? 'saving' : 'stopped'}</Text>
              </View>
            </Ring>
          </View>
        </View>

        <View style={{ backgroundColor: colors.page, borderRadius: 22, overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.fillSeg }}>
              <Icon name={r.icon} size={20} />
              <Text style={{ flex: 1, fontSize: 14, color: colors.gray2 }}>{r.label}</Text>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink, textAlign: 'right' }}>{r.value}</Text>
            </View>
          ))}
        </View>
        {trusted.length === 0 ? (
          <View style={{ marginTop: 12 }}>
            <Banner testID="sos-no-peer" roomy text="No trusted device paired. The request will be saved on this device, and nobody will receive it until you pair one." />
          </View>
        ) : null}
        {phase === 'failed' ? (
          <View style={{ marginTop: 12 }}>
            <Banner testID="sos-failed" tone="coral" icon="error" weight="500" text="The request could not be saved on this device. Nothing was sent. Try again, or call your local emergency number." />
          </View>
        ) : null}

        <View style={{ flex: 1, minHeight: 16 }} />

        <View style={{ gap: 10 }}>
          <Pill
            testID="sos-send"
            label="Send SOS now"
            tone="coral"
            h={60}
            size={18}
            weight="700"
            glow
            press={0.98}
            disabled={phase === 'sending'}
            onPress={() => void send('incident')}
            accessibilityHint="Saves the request on this device and queues it for your trusted devices"
          />
          <Pill
            testID="sos-describe"
            label="Describe what happened"
            tone="soft"
            h={56}
            size={16}
            icon="auto_awesome"
            iconSize={20}
            disabled={phase === 'sending'}
            onPress={() => void send('report')}
            accessibilityHint="Saves the request first, then opens the report screen"
          />
          <LinkButton testID="sos-cancel" label="Cancel" color={colors.gray1} size={16} h={46} onPress={() => router.back()} />
        </View>
        <Text style={{ fontSize: 11, color: colors.gray4, textAlign: 'center', marginTop: 4 }}>
          {snapshot.mode === 'demo' ? 'Simulated · ' : ''}
          {BRAND} does not contact emergency services. Nobody is alerted until a trusted device receives this request.
        </Text>
        <Pressable
          testID="sos-call"
          accessibilityRole="link"
          accessibilityLabel="Call emergency number"
          accessibilityHint={`Opens the phone dialer with 911. ${BRAND} never calls on its own.`}
          onPress={() => void Linking.openURL('tel:911')}
          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="call" size={14} color={colors.coralText} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.coralText }}>Call emergency number</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
