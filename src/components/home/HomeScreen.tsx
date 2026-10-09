import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { canAcknowledge } from '@/domain';
import type { IncidentView } from '@/services/api';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, Button, Chip, GroupedList, Icon, ListRow, MicroPill, PulseRing, Screen, SectionHeader, TextButton, colors, tones } from '@/ui';

import { useActor } from '../incident/useMe';
import { useRun } from '../incident/useRun';
import { routes } from '../nav';
import { firstName, incidentHeadline, incidentPlace, isOpen, presentNetwork, presentStatus, presentTextModel, type Me } from '../present';

function greeting(name: string, hour: number): string {
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = firstName(name);
  return first.length > 0 ? `${part}, ${first}` : part;
}

function IncomingCard({ view, me }: { view: IncidentView; me: Me & { userName: string } }) {
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const reporter = view.state.incident?.reporter;
  const status = presentStatus(view.state, me);
  const mine = view.state.recipients.find((r) => r.deviceId === me.deviceId);
  const mayAck = canAcknowledge(view.state, me).ok && mine !== undefined && !mine.acknowledged;
  const place = incidentPlace(view);
  const rows = [
    { l: 'Where', v: place ?? 'Not reported or not shared' },
    { l: 'Status', v: status.chip },
    ...(view.receivedViaName ? [{ l: 'Reached you through', v: view.receivedViaName }] : []),
  ];
  return (
    <View testID={`incoming-${view.id}`} className="gap-4 rounded-card bg-card p-5">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-[7px]">
          <View className="h-2 w-2 items-center justify-center">
            <PulseRing size={8} color={colors.coral} />
            <View className="h-2 w-2 rounded-full bg-coral" />
          </View>
          <Text className="text-[12px] font-bold text-coral-text">Incoming request</Text>
        </View>
        <Text className="text-[12px] font-medium text-gray-1">{view.shortId}</Text>
      </View>
      <View className="flex-row items-center gap-3">
        <Avatar name={reporter?.userName ?? '?'} size={44} />
        <View className="flex-1">
          <Text accessibilityRole="header" className="text-[17px] font-bold text-ink">
            {incidentHeadline(view, me)}
          </Text>
          <Text className="mt-0.5 text-[13px] text-gray-1">{status.title}</Text>
        </View>
      </View>
      <View className="border-t border-hairline">
        {rows.map((r) => (
          <View key={r.l} className="flex-row justify-between gap-3 border-b border-hairline py-[9px]">
            <Text className="text-[13.5px] text-gray-1">{r.l}</Text>
            <Text className="flex-1 text-right text-[13.5px] font-semibold text-ink">{r.v}</Text>
          </View>
        ))}
      </View>
      <View className="flex-row gap-[10px]">
        <View className="flex-1">
          <Button
            testID={`incoming-ack-${view.id}`}
            label={mine?.acknowledged ? 'Seen' : 'Mark as seen'}
            size="sm"
            variant="secondary"
            disabled={!mayAck || busy !== null}
            onPress={() => void run('ack', () => actions.acknowledge(view.id))}
          />
        </View>
        <View className="flex-1">
          <Button testID={`incoming-open-${view.id}`} label="Take a role" size="sm" onPress={() => router.push(routes.incident(view.id))} accessibilityHint="Opens the request so you can choose a role" />
        </View>
      </View>
      <TextButton label="View incident" tone="ink" onPress={() => router.push(routes.incident(view.id))} />
    </View>
  );
}

function ActiveCard({ view, me }: { view: IncidentView; me: Me }) {
  const status = presentStatus(view.state, me);
  const tone = tones[status.tone];
  return (
    <Pressable
      testID={`active-${view.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Your request ${view.shortId}. ${status.title}. ${status.sub}`}
      onPress={() => router.push(routes.incident(view.id))}
      className="flex-row items-center gap-3 rounded-[26px] bg-card p-4 active:opacity-80">
      <View className="h-[10px] w-[10px] rounded-full" style={{ backgroundColor: tone.fg }} />
      <View className="flex-1">
        <Text className="text-[15.5px] font-semibold text-ink">{status.title}</Text>
        <Text className="mt-0.5 text-[13px] text-gray-1">
          {view.shortId} · {status.chip}
        </Text>
      </View>
      <Icon name="chevron_right" size={22} color={colors.gray5} />
    </Pressable>
  );
}

export function LocalAICard() {
  const { capabilities } = usePulse();
  const model = presentTextModel(capabilities);
  return (
    <View testID="local-ai-card" className="gap-3 rounded-feature bg-card px-[18px] py-4">
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-[14px] bg-hairline">
          <Icon name="memory" size={22} />
        </View>
        <View className="flex-1">
          <Text className="text-[13px] font-semibold text-gray-1">Local AI</Text>
          <Text testID="local-ai-provider" className="text-[17px] font-bold text-ink">
            {capabilities ? capabilities.provider : 'Checking…'}
          </Text>
        </View>
        {capabilities?.source === 'simulated' ? <MicroPill label="Simulated" /> : null}
      </View>
      <View className="flex-row items-center justify-between gap-3 border-t border-hairline pt-3">
        <Text className="text-[13.5px] text-gray-1">Device</Text>
        <Text testID="local-ai-device" className="flex-1 text-right text-[13.5px] font-semibold text-ink">
          {capabilities ? `${capabilities.device.model} · iOS ${capabilities.device.osVersion}` : '—'}
        </Text>
      </View>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-[13.5px] text-gray-1">Text model</Text>
        <View testID="local-ai-text">
          <Chip label={model.label} tone={model.tone} />
        </View>
      </View>
      <Text className="text-[12.5px] leading-[17px] text-gray-1">Manual SOS does not depend on local AI. It is saved and queued without it.</Text>
    </View>
  );
}

export function HomeScreen() {
  const snapshot = usePulse();
  const actor = useActor();
  const open = snapshot.incidents.filter(isOpen);
  const incoming = open.filter((i) => i.role === 'responder');
  const mine = open.filter((i) => i.role === 'reporter');
  const network = presentNetwork(snapshot);
  const tone = tones[network.tone];
  const trusted = snapshot.peers.filter((p) => p.trusted);
  const connected = trusted.filter((p) => p.reach === 'connected');

  return (
    <Screen testID="home-screen" tabbed>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-[15px] font-medium text-gray-1">{greeting(snapshot.me.name, new Date().getHours())}</Text>
          <Text accessibilityRole="header" className="mt-1 text-[30px] font-bold leading-[33px] tracking-[-0.9px] text-ink">
            Your safety, connected.
          </Text>
          <Text className="mt-1.5 text-[15px] leading-[20px] text-gray-1">Local intelligence. Trusted people. Even offline.</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Profile and settings" onPress={() => router.navigate(routes.settings)} hitSlop={4}>
          <Avatar name={snapshot.me.name.length > 0 ? snapshot.me.name : '?'} size={40} self />
        </Pressable>
      </View>

      <View testID="network-line" accessible accessibilityLiveRegion="polite" accessibilityLabel={`Network: ${network.text}`} className="flex-row items-center gap-2 self-start rounded-full px-[13px] py-2" style={{ backgroundColor: tone.bg }}>
        <Icon name={network.icon} size={16} color={tone.fg} />
        <Text className="shrink text-[13px] font-semibold" style={{ color: tone.fg }}>
          {network.text}
        </Text>
      </View>

      {incoming.map((view) => (
        <IncomingCard key={view.id} view={view} me={actor} />
      ))}
      {incoming.length === 0 && connected.length > 0 ? (
        <View testID="responder-idle" className="flex-row items-center gap-3 rounded-card bg-card p-4">
          <View className="h-2 w-2 rounded-full bg-green" />
          <Text className="flex-1 text-[14px] leading-[19px] text-gray-3">Requests from your trusted devices appear here when they reach this iPhone.</Text>
        </View>
      ) : null}
      {mine.map((view) => (
        <ActiveCard key={view.id} view={view} me={actor} />
      ))}

      <Pressable
        testID="request-assistance"
        accessibilityRole="button"
        accessibilityLabel="Request Assistance"
        accessibilityHint="Opens the SOS countdown"
        onPress={() => router.push(routes.sos)}
        className="min-h-[64px] flex-row items-center justify-center gap-[10px] rounded-full bg-coral px-5 active:scale-[0.98]">
        <Icon name="sos" size={22} color="#FFFFFF" filled />
        <Text className="text-[18px] font-bold text-white">Request Assistance</Text>
      </Pressable>

      <LocalAICard />

      <View>
        <SectionHeader title="Overview" />
        <GroupedList>
          <ListRow
            first
            testID="overview-network"
            icon="hub"
            title="Trusted network"
            subtitle={trusted.length === 0 ? 'No trusted device paired' : `${trusted.length} trusted · ${connected.length} connected now`}
            onPress={() => router.navigate(routes.network)}
          />
          <ListRow
            icon="history"
            title="Activity"
            subtitle={snapshot.incidents.length === 0 ? 'No requests on this device' : `${snapshot.incidents.length} on this device · ${open.length} open`}
            onPress={() => router.navigate(routes.activity)}
          />
          <ListRow icon="group_add" title="Pair a device" subtitle="Compare a six-digit code on both phones" onPress={() => router.push(routes.pair)} />
        </GroupedList>
      </View>
    </Screen>
  );
}
