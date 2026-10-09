import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Pill, Ring, Sheet, colors, useToast } from '@/ui';

import { routes } from '../nav';
import { BRAND } from '../present';
import { useSafetySession } from './safetySession';
import { Text } from '@/ui/Text';

const SECONDS = 10;

/**
 * SIMULATION ONLY (design 871–887). Reachable from Demo Lab and the Safety Session screen, drawn only
 * while the DEMO bundle is active, always under the SIMULATED bar. "I need assistance" and the
 * unanswered countdown create a request through the Demo app's own `sendSOS`; nothing live is touched.
 */
export function AnomalySheet() {
  const { mode } = usePulse();
  const open = useSafetySession((s) => s.anomalyOpen);
  const close = useSafetySession((s) => s.closeAnomaly);

  // Leaving Demo closes the simulation.
  useEffect(() => {
    if (mode !== 'demo' && open) close();
  }, [mode, open, close]);

  // Mounted only while open, so every opening starts a fresh 10-second countdown.
  return open && mode === 'demo' ? <AnomalyCountdown /> : null;
}

function AnomalyCountdown() {
  const actions = usePulseActions();
  const close = useSafetySession((s) => s.closeAnomaly);
  const toast = useToast((s) => s.show);
  const [count, setCount] = useState(SECONDS);
  const sending = useRef(false);

  const request = useCallback(
    async (expired: boolean) => {
      if (sending.current) return;
      sending.current = true;
      close();
      try {
        const result = await actions.sendSOS();
        if (result.ok) {
          router.push(routes.incident(result.value.incidentId));
          if (expired) toast('No response · simulated request saved', 'emergency', colors.coral);
        }
      } finally {
        sending.current = false;
      }
    },
    [actions, close, toast],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (count <= 1) void request(true);
      else setCount(count - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [count, request]);

  return (
    <Sheet testID="anomaly-sheet" visible onClose={() => undefined} dismissable={false} grabberGap={16} centered>
      <View style={{ backgroundColor: colors.hairline, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: colors.gray1 }}>SIMULATION</Text>
      </View>
      <View style={{ marginTop: 18 }}>
        <Ring size={96} r={42} stroke={7} progress={count / SECONDS} color={colors.amber} track={colors.amberTint} durationMs={1000} ease="linear">
          <Text accessibilityRole="timer" accessibilityLabel={`${count} seconds to respond`} style={{ fontSize: 34, fontWeight: '700', color: colors.ink, fontVariant: ['tabular-nums'] }}>
            {count}
          </Text>
        </Ring>
      </View>
      <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '700', letterSpacing: -0.4, color: colors.ink, marginTop: 18, textAlign: 'center' }}>
        Unusual movement detected
      </Text>
      <Text style={{ fontSize: 20, fontWeight: '600', color: colors.ink, marginTop: 6, textAlign: 'center' }}>Are you okay?</Text>
      <Text style={{ fontSize: 14, lineHeight: 21, color: colors.gray1, marginTop: 10, maxWidth: 300, textAlign: 'center' }}>
        If you don’t respond, {BRAND} will queue an unconfirmed request for your trusted circle. Simulated.
      </Text>
      <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 22 }}>
        <Pill
          testID="anomaly-ok"
          label="I’m okay"
          h={58}
          size={17}
          onPress={() => {
            close();
            toast('Glad you’re okay.', 'favorite');
          }}
        />
        <Pill testID="anomaly-help" label="I need assistance" tone="coral" h={58} size={17} weight="700" onPress={() => void request(false)} />
      </View>
    </Sheet>
  );
}
