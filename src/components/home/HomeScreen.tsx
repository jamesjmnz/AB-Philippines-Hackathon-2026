import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { canAcknowledge, canDeclineRequest } from '@/domain';
import type { IncidentView } from '@/services/api';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, Dialog, Enter, Icon, LinkButton, Pill, Press, PulseRing, Ring, colors, design, tabBarHeight, type IconName } from '@/ui';

import { IntelligenceSheet } from '../ai/IntelligenceSheet';
import { clock, useSafetySession } from '../demo/safetySession';
import { useActor } from '../incident/useMe';
import { useRun } from '../incident/useRun';
import { IncidentMap, locationProtected, mapLabel } from '../map/IncidentMap';
import { routes } from '../nav';
import { firstName, isOpen, LEVEL_LABELS, presentIntelligenceLine, presentNetwork, presentReadiness, presentStatus, whenLabel, type Me } from '../present';
import { Text } from '@/ui/Text';

function greeting(name: string, hour: number): string {
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = firstName(name);
  return first.length > 0 ? `${part}, ${first}` : part;
}

/** Incoming request (design 173–232). */
function IncomingCard({ view, me }: { view: IncidentView; me: Me & { userName: string } }) {
  const actions = usePulseActions();
  const withMap = usePulse().mode === 'demo';
  const { busy, run } = useRun();
  const [declining, setDeclining] = useState(false);
  const reporter = view.state.incident?.reporter;
  const first = reporter ? firstName(reporter.userName) : 'the requester';
  const mine = view.state.recipients.find((r) => r.deviceId === me.deviceId);
  const acknowledged = mine?.acknowledged ?? false;
  const mayAck = canAcknowledge(view.state, me).ok && mine !== undefined && !acknowledged;
  const mayDecline = canDeclineRequest(view.state, me).ok && mine !== undefined && !mine.declined;
  const helping = view.state.tasks.some((t) => t.assignee?.deviceId === me.deviceId);
  const type = view.facts.find((f) => f.field === 'incidentType' && !f.protected)?.value ?? 'Assistance request';
  const created = view.state.incident?.createdAtMs;
  const rows = [
    { l: 'Reported location', v: locationProtected(view) ? 'Protected' : (mapLabel(view) ?? 'Location not stated') },
    { l: 'Created', v: created !== undefined ? whenLabel(created) : '—' },
    { l: 'Received', v: view.receivedViaName ? `Relayed through ${view.receivedViaName}` : `Directly from ${first}` },
    { l: 'Your access', v: LEVEL_LABELS[view.access] },
  ];
  return (
    <Enter kind="popIn" duration={400} ease="spring">
      <View testID={`incoming-${view.id}`} style={{ backgroundColor: '#FFFFFF', borderRadius: 22, padding: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View style={{ width: 8, height: 8 }}>
              <PulseRing size={8} color={colors.coral} durationMs={1600} />
              <View style={{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: colors.coral }} />
            </View>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#B9403C' }}>Incoming request</Text>
          </View>
          <Text style={{ fontSize: 12, fontWeight: '500', color: colors.gray1 }}>{view.shortId}</Text>
        </View>
        {withMap ? <IncidentMap view={view} radius={16} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={reporter?.userName ?? '?'} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>
              {helping ? `You’re helping ${first}.` : 'Someone nearby needs assistance.'}
            </Text>
            <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 2 }}>
              {type} reported by {first}.
            </Text>
          </View>
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: colors.hairline }}>
          {rows.map((r) => (
            <View key={r.l} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
              <Text style={{ fontSize: 13, color: colors.gray1 }}>{r.l}</Text>
              <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: colors.ink, textAlign: 'right' }}>{r.v}</Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            testID={`incoming-ack-${view.id}`}
            accessibilityRole="button"
            accessibilityLabel={acknowledged ? 'Seen' : 'Mark as seen'}
            accessibilityState={{ disabled: !mayAck || busy !== null }}
            disabled={!mayAck || busy !== null}
            onPress={() => void run('ack', () => actions.acknowledge(view.id))}
            style={{ flex: 1, minHeight: 46, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: acknowledged ? design.softer : design.soft }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: acknowledged ? colors.gray1 : colors.ink }}>{acknowledged ? 'Seen' : 'Mark as seen'}</Text>
          </Pressable>
          <Pill
            testID={`incoming-open-${view.id}`}
            label="Take a role"
            h={46}
            size={14.5}
            press={0.97}
            flex
            onPress={() => router.push(routes.incident(view.id))}
            accessibilityHint="Opens the request so you can choose a role"
          />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 18 }}>
          {mayDecline ? <LinkButton testID={`incoming-decline-${view.id}`} label="Can’t help" color={colors.coralText} size={13.5} h={20} onPress={() => setDeclining(true)} /> : null}
          <LinkButton testID={`incoming-view-${view.id}`} label="View incident" size={13.5} h={20} onPress={() => router.push(routes.incident(view.id))} />
        </View>
      </View>
      <Dialog
        visible={declining}
        title="Can’t help right now?"
        message="The request stays open and your open roles go to someone else."
        cancelLabel="Back"
        confirmLabel="Can’t help"
        destructive
        onCancel={() => setDeclining(false)}
        onConfirm={() => {
          setDeclining(false);
          void run('decline', () => actions.declineRequest(view.id));
        }}
      />
    </Enter>
  );
}

/**
 * Own open request (design 236–282). LIVE has no map position, so the card is a status row with the
 * reported place in words; the map is drawn only in Demo, where it is part of the simulation.
 */
function ActiveCard({ view, me }: { view: IncidentView; me: Me }) {
  const status = presentStatus(view.state, me);
  const withMap = usePulse().mode === 'demo';
  const place = locationProtected(view) ? 'Location protected' : mapLabel(view);
  return (
    <Enter kind="popIn" duration={400}>
      <Pressable
        testID={`active-${view.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Your request ${view.shortId}. ${status.title}. ${status.sub}`}
        onPress={() => router.push(routes.incident(view.id))}
        style={{ backgroundColor: '#FFFFFF', borderRadius: withMap ? 26 : 22, padding: 8 }}>
        {withMap ? <IncidentMap view={view} radius={20} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: withMap ? 12 : 8, paddingHorizontal: 8, paddingBottom: withMap ? 6 : 8 }}>
          <View style={{ width: 10, height: 10 }}>
            <PulseRing size={10} color={status.ring} durationMs={1800} />
            <View style={{ position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: status.ring }} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{status.title}</Text>
            <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 2 }}>
              {view.shortId} · {status.chip}
            </Text>
            {!withMap && place ? (
              <Text testID={`active-place-${view.id}`} numberOfLines={1} style={{ fontSize: 13, color: colors.gray2, marginTop: 2 }}>
                {place}
              </Text>
            ) : null}
          </View>
          <Icon name="chevron_right" size={22} color={colors.gray5} />
        </View>
      </Pressable>
    </Enter>
  );
}

type OverviewRow = { key: string; icon: IconName; label: string; sub: string; dot: string | null; onPress: () => void };

/** "Active · 04:07", ticking once a second while the simulated session runs. */
function useSessionLine(enabled: boolean): { active: boolean; sub: string } {
  const active = useSafetySession((s) => s.active);
  const startMs = useSafetySession((s) => s.startMs);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled || !active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled, active]);
  return { active, sub: active ? `Active · ${clock((Math.max(now, startMs) - startMs) / 1000)}` : 'Not active' };
}

/** Home (design 165–313). */
export function HomeScreen() {
  const snapshot = usePulse();
  const actor = useActor();
  const insets = useSafeAreaInsets();
  const [aiOpen, setAiOpen] = useState(false);
  const demo = snapshot.mode === 'demo';
  const session = useSessionLine(demo);

  const open = snapshot.incidents.filter(isOpen);
  const incoming = open.filter((i) => i.role === 'responder');
  const mine = open.filter((i) => i.role === 'reporter');
  const network = presentNetwork(snapshot);
  const trusted = snapshot.peers.filter((p) => p.trusted);
  const connected = trusted.filter((p) => p.reach === 'connected');
  const readiness = presentReadiness(snapshot);

  const roles = open.reduce((n, i) => {
    const reporterId = i.state.incident?.reporter.deviceId ?? null;
    return n + i.state.tasks.filter((t) => t.assignee !== null && t.assignee.deviceId !== reporterId && (t.status === 'accepted' || t.status === 'in_progress' || t.status === 'completion_reported')).length;
  }, 0);
  const pending = open.reduce((n, i) => n + i.pendingOutbox, 0);
  const firstActive = mine[0] ?? open[0];

  const overview: OverviewRow[] = [
    {
      key: 'carechain',
      icon: 'account_tree',
      label: 'CareChain',
      sub: open.length > 0 ? `${open.length} active · ${roles} role${roles === 1 ? '' : 's'} taken` : 'No active incidents',
      dot: open.length > 0 ? colors.coral : null,
      onPress: () => (firstActive ? router.push(routes.incident(firstActive.id)) : router.navigate(routes.activity)),
    },
    {
      key: 'network',
      icon: 'hub',
      label: 'Nearby network',
      sub: trusted.length === 0 ? 'No trusted device paired' : `${connected.length} connected · ${trusted.length - connected.length} unavailable${pending > 0 ? ` · ${pending} pending` : ''}`,
      dot: pending > 0 ? colors.amber : null,
      onPress: () => router.navigate(routes.network),
    },
    {
      key: 'intelligence',
      icon: 'auto_awesome',
      label: 'On-Device Intelligence',
      sub: presentIntelligenceLine(snapshot.capabilities),
      dot: null,
      onPress: () => setAiOpen(true),
    },
  ];
  if (demo) {
    overview.push({ key: 'session', icon: 'directions_walk', label: 'Safety Session', sub: session.sub, dot: session.active ? colors.green : null, onPress: () => router.push(routes.session) });
  }

  return (
    <View testID="home-screen" style={{ flex: 1, backgroundColor: colors.page, paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: tabBarHeight(insets.bottom) + 30 }}>
        <Enter kind="fadeUp" duration={350} style={{ paddingTop: 8, paddingHorizontal: 20, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingTop: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: colors.gray1 }}>{greeting(snapshot.me.name, new Date().getHours())}</Text>
              <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '700', letterSpacing: -0.4, lineHeight: 32, color: colors.ink, marginTop: 2 }}>
                Your safety, connected.
              </Text>
              <Text style={{ fontSize: 14, lineHeight: 20, color: colors.gray1, marginTop: 4 }}>Local intelligence. Trusted people. Even offline.</Text>
            </View>
            <Pressable testID="home-profile" accessibilityRole="button" accessibilityLabel="Profile and settings" onPress={() => router.navigate(routes.settings)} hitSlop={4} style={{ width: 40, height: 40 }}>
              <Avatar name={snapshot.me.name.length > 0 ? snapshot.me.name : '?'} size={40} self />
              {open.length > 0 ? (
                <View testID="home-badge" style={{ position: 'absolute', top: 0, right: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.coral, borderWidth: 2, borderColor: colors.page }} />
              ) : null}
            </Pressable>
          </View>

          {network.tone !== 'green' ? (
            <View
              testID="network-line"
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={`Network: ${network.text}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: colors.amberTint, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13 }}>
              <Icon name={network.icon} size={16} color={design.offlineText} />
              <Text style={{ flexShrink: 1, fontSize: 13, fontWeight: '600', color: design.offlineText }}>{network.text}</Text>
            </View>
          ) : null}

          {incoming.map((view) => (
            <IncomingCard key={view.id} view={view} me={actor} />
          ))}
          {incoming.length === 0 && connected.length > 0 ? (
            <View testID="responder-idle" style={{ backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green }} />
              <Text style={{ flex: 1, fontSize: 14, color: colors.gray3 }}>Requests from your trusted devices appear here when they reach this iPhone.</Text>
            </View>
          ) : null}
          {mine.map((view) => (
            <ActiveCard key={view.id} view={view} me={actor} />
          ))}

          <Press
            testID="request-assistance"
            accessibilityRole="button"
            accessibilityLabel="Request Assistance"
            accessibilityHint="Opens the SOS countdown"
            onPress={() => router.push(routes.sos)}
            press={0.98}
            style={{ minHeight: 56, borderRadius: 999, backgroundColor: colors.coral, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <Icon name="sos" size={22} color="#FFFFFF" filled />
            <Text style={{ fontSize: 17, fontWeight: '600', color: '#FFFFFF' }}>Request Assistance</Text>
          </Press>

          <View
            testID="readiness-card"
            accessible
            accessibilityLabel={`${readiness.title}. ${readiness.facts.map((f) => `${f.label}: ${f.ok ? 'done' : 'not yet'}`).join('. ')}`}
            style={{ backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Ring size={48} r={21} stroke={5} progress={readiness.progress}>
              <Icon name="shield" size={20} filled />
            </Ring>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text testID="readiness-title" style={{ fontSize: 17, fontWeight: '600', color: colors.ink }}>
                {readiness.title}
              </Text>
              <Text testID="readiness-line" style={{ fontSize: 13, lineHeight: 18, color: colors.gray1, marginTop: 2 }}>
                {readiness.line}
              </Text>
            </View>
          </View>

          <View>
            <Text accessibilityRole="header" style={{ fontSize: 13, fontWeight: '600', color: colors.gray1, paddingHorizontal: 4, paddingBottom: 8 }}>
              Overview
            </Text>
            <View style={{ backgroundColor: '#FFFFFF', borderRadius: 22, overflow: 'hidden' }}>
              {overview.map((o, i) => (
                <Pressable
                  key={o.key}
                  testID={`overview-${o.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${o.label}, ${o.sub}`}
                  onPress={o.onPress}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: '#FFFFFF', borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                  <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: colors.hairline, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={o.icon} size={20} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{o.label}</Text>
                    <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 2 }}>{o.sub}</Text>
                  </View>
                  {o.dot ? <View testID={`overview-dot-${o.key}`} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: o.dot }} /> : null}
                  <Icon name="chevron_right" size={20} color={colors.gray5} />
                </Pressable>
              ))}
            </View>
          </View>
        </Enter>
      </ScrollView>
      <IntelligenceSheet visible={aiOpen} onClose={() => setAiOpen(false)} />
    </View>
  );
}
