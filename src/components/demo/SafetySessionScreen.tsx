import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePulse } from '@/services/PulseProvider';
import { Enter, Icon, IconButton, Pill, PulseRing, Ring, Toggle, colors, padBottom, useToast, type IconName } from '@/ui';

import { routes } from '../nav';
import { BRAND, timeLabel } from '../present';
import { clock, SESSION_CHECKIN_SECONDS, useSafetySession } from './safetySession';
import { Text } from '@/ui/Text';

type RowDef = { icon: IconName; label: string; value?: string; toggle?: boolean };

/**
 * SIMULATION ONLY (design 626–659). Driven by local state and a one-second timer; it reads no sensor
 * and calls no service. Outside Demo mode it renders an explanation and nothing else.
 */
export function SafetySessionScreen() {
  const snapshot = usePulse();
  const insets = useSafeAreaInsets();
  const toast = useToast((s) => s.show);
  const session = useSafetySession();
  const [now, setNow] = useState(() => Date.now());
  const back = () => (router.canGoBack() ? router.back() : router.replace(routes.home));
  const isDemo = snapshot.mode === 'demo';
  const active = isDemo && session.active;

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (!isDemo) {
    return (
      <View testID="session-unavailable" style={{ flex: 1, backgroundColor: colors.page, paddingTop: insets.top }}>
        <View style={{ paddingTop: 8, paddingHorizontal: 20, alignItems: 'flex-start' }}>
          <IconButton icon="arrow_back" label="Back" size={42} onPress={back} />
        </View>
        <View style={{ paddingTop: 16, paddingHorizontal: 20, gap: 16 }}>
          <View>
            <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '700', letterSpacing: -0.4, color: colors.ink }}>
              Safety Session is a simulation
            </Text>
            <Text style={{ fontSize: 15, color: colors.gray1, marginTop: 4 }}>Switch to Demo in {BRAND} Demo Lab.</Text>
          </View>
          <Pill testID="session-open-lab" label={`Open ${BRAND} Demo Lab`} h={58} size={17} press={0.98} onPress={() => router.replace(routes.demoLab)} />
        </View>
      </View>
    );
  }

  const elapsed = active ? Math.max(0, Math.floor((now - session.startMs) / 1000)) : 0;
  const timer = clock(elapsed);
  const nextIn = 15 - Math.floor((elapsed % SESSION_CHECKIN_SECONDS) / 60);
  const reachable = snapshot.peers.filter((p) => p.trusted && p.reach === 'connected').length;
  const stFg = active ? colors.greenText : colors.gray1;
  const rows: RowDef[] = [
    { icon: 'timer', label: 'Session duration', value: active ? timer : '—' },
    { icon: 'group', label: 'Trusted responders', value: `${reachable} reachable` },
    { icon: 'task_alt', label: 'Last check-in', value: active ? timeLabel(session.startMs) : '—' },
    { icon: 'schedule', label: 'Next scheduled check-in', value: active ? `In ${nextIn} min` : 'Every 15 min' },
    { icon: 'location_on', label: 'Location sharing', toggle: true },
    { icon: 'vibration', label: 'Motion analysis', value: 'Simulated' },
  ];

  return (
    <Enter testID="session-screen" kind="slideIn" duration={350} ease="spring" style={{ flex: 1, backgroundColor: colors.page, paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: padBottom(insets.bottom, 44) }}>
        <View style={{ paddingTop: 8, paddingHorizontal: 20, alignItems: 'flex-start' }}>
          <IconButton icon="arrow_back" label="Back" size={42} onPress={back} />
        </View>
        <View style={{ paddingTop: 16, paddingHorizontal: 20, gap: 16 }}>
          <View>
            <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '700', letterSpacing: -0.4, color: colors.ink }}>
              Safety Session
            </Text>
            <Text style={{ fontSize: 15, color: colors.gray1, marginTop: 4 }}>Stay connected while you’re on the move.</Text>
          </View>

          <View style={{ backgroundColor: '#FFFFFF', borderRadius: 28, paddingVertical: 26, paddingHorizontal: 20, alignItems: 'center', gap: 14 }}>
            <View style={{ width: 200, height: 200 }}>
              <PulseRing size={156} color={colors.green} active={active} durationMs={2600} style={{ left: 22, top: 22 }} />
              <Ring size={200} r={88} stroke={12} fill="#FFFFFF" progress={active ? (elapsed % SESSION_CHECKIN_SECONDS) / SESSION_CHECKIN_SECONDS : 0} durationMs={1000} ease="linear">
                <Text testID="session-timer" accessibilityRole="timer" style={{ fontSize: 44, fontWeight: '700', letterSpacing: -0.6, color: colors.ink, fontVariant: ['tabular-nums'] }}>
                  {timer}
                </Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.gray1, marginTop: 2 }}>{active ? `Next check-in in ${nextIn} min` : 'Not started'}</Text>
              </Ring>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: active ? colors.greenTint : colors.hairline, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: stFg }} />
              <Text testID="session-status" style={{ fontSize: 13, fontWeight: '600', color: stFg }}>
                {active ? 'Monitoring · simulated' : 'Inactive'}
              </Text>
            </View>
          </View>

          <View style={{ backgroundColor: '#FFFFFF', borderRadius: 22, overflow: 'hidden' }}>
            {rows.map((r, i) => (
              <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8, paddingHorizontal: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                <Icon name={r.icon} size={20} />
                <Text style={{ flex: 1, fontSize: 15, fontWeight: '500', color: colors.ink }}>{r.label}</Text>
                {r.value !== undefined ? <Text style={{ fontSize: 14, color: colors.gray1, fontVariant: ['tabular-nums'] }}>{r.value}</Text> : null}
                {r.toggle ? <Toggle testID="session-location" label={r.label} value={session.shareLocation} onChange={() => session.toggleShareLocation()} /> : null}
              </View>
            ))}
          </View>

          {active ? (
            <View style={{ gap: 10 }}>
              <Pill testID="session-simulate" label="Simulate unusual movement" tone="soft" h={56} size={16} icon="vibration" iconSize={20} onPress={() => session.openAnomaly()} />
              <Pill
                testID="session-end"
                label="End Session"
                h={56}
                size={17}
                onPress={() => {
                  session.end();
                  toast('Session ended', 'check_circle');
                }}
              />
            </View>
          ) : (
            <Pill
              testID="session-start"
              label="Start Safety Session"
              h={58}
              size={17}
              press={0.98}
              onPress={() => {
                session.start();
                toast('Safety session started', 'directions_walk');
              }}
            />
          )}

          <Text style={{ fontSize: 12, lineHeight: 18, color: colors.gray1, paddingHorizontal: 4 }}>Simulation only. This prototype does not read motion sensors or monitor you continuously.</Text>
        </View>
      </ScrollView>
    </Enter>
  );
}
