import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { PeerView } from '@/services/api';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, Banner, Button, Chip, Dialog, GroupedList, Icon, Screen, SegmentedControl, Sheet, TextField, colors, tones } from '@/ui';

import { useRun } from '../incident/useRun';
import { routes } from '../nav';
import { agoLabel, DISCOVERY_LABEL, presentNetwork, presentReach, shortDeviceId } from '../present';

const SEGMENTS = [
  { key: 'nearby', label: 'Nearby' },
  { key: 'trusted', label: 'Trusted' },
] as const;

type RelayPath = { from: string; via: string; to: string; shortId: string };

/** A relay path is shown only when the ledger or the transport actually recorded one. */
function useRelayPaths(): RelayPath[] {
  const { incidents, peers, me } = usePulse();
  const paths: RelayPath[] = [];
  for (const view of incidents) {
    if (view.state.closure) continue;
    const reporter = view.state.incident?.reporter;
    if (view.role === 'responder' && view.receivedViaName && reporter) {
      paths.push({ from: reporter.userName, via: view.receivedViaName, to: 'You', shortId: view.shortId });
    }
    if (view.role === 'reporter') {
      for (const packet of view.state.packets) {
        if (!packet.viaDeviceId) continue;
        const via = peers.find((p) => p.deviceId === packet.viaDeviceId)?.name ?? shortDeviceId(packet.viaDeviceId);
        const to = view.state.recipients.find((r) => r.deviceId === packet.recipientDeviceId)?.userName ?? shortDeviceId(packet.recipientDeviceId);
        if (!paths.some((p) => p.shortId === view.shortId && p.via === via && p.to === to)) paths.push({ from: me.name.length > 0 ? 'You' : 'This device', via, to, shortId: view.shortId });
      }
    }
  }
  return paths;
}

function PeerRow({ peer, first, onPress, nowMs }: { peer: PeerView; first: boolean; onPress: () => void; nowMs: number }) {
  const reach = presentReach(peer);
  return (
    <Pressable
      testID={`peer-${peer.deviceId}`}
      accessibilityRole="button"
      accessibilityLabel={`${peer.name}, ${peer.trusted ? 'trusted' : 'not paired'}, ${reach.label}`}
      onPress={onPress}
      className={`min-h-[60px] flex-row items-center gap-3 px-4 py-3 ${first ? '' : 'border-t border-hairline'} ${peer.reach === 'unreachable' ? 'opacity-70' : ''}`}>
      <Avatar name={peer.name} size={40} presence={reach.online ? 'online' : 'offline'} />
      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-ink">{peer.name}</Text>
        <Text className="mt-[1px] text-[12.5px] text-gray-1">{peer.trusted ? 'Trusted · code confirmed' : 'Not paired'}</Text>
      </View>
      <View className="items-end">
        <Text className="text-[12.5px] font-semibold" style={{ color: tones[reach.tone].fg }}>
          {reach.label}
        </Text>
        <Text className="mt-[1px] text-[11.5px] text-gray-4">{peer.reach === 'connected' ? 'Link open' : agoLabel(peer.lastSeenMs, nowMs)}</Text>
      </View>
    </Pressable>
  );
}

export function NetworkScreen() {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const { busy, run } = useRun();
  const [segment, setSegment] = useState<'nearby' | 'trusted'>('nearby');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const paths = useRelayPaths();
  const [nowMs] = useState(() => Date.now());

  const { discovery, error } = snapshot.network;
  const summary = presentNetwork(snapshot);
  const nearby = snapshot.peers.filter((p) => p.reach !== 'unreachable');
  const trusted = snapshot.peers.filter((p) => p.trusted);
  const list = segment === 'nearby' ? nearby : trusted;
  const selected = snapshot.peers.find((p) => p.deviceId === selectedId) ?? null;
  const closeSheet = () => {
    setSelectedId(null);
    setRename(null);
  };

  return (
    <Screen testID="network-screen" tabbed title="Your Network" subtitle={summary.text}>
      <View testID="discovery-card" className="gap-3 rounded-card bg-card p-[18px]">
        <View className="flex-row items-start justify-between gap-[10px]">
          <View className="flex-1">
            <Text className="text-[17px] font-bold text-ink">Nearby discovery</Text>
            <Text testID="discovery-state" accessibilityLiveRegion="polite" className="mt-0.5 text-[13px] text-gray-1">
              {DISCOVERY_LABEL[discovery]}
            </Text>
          </View>
          <Chip label={discovery === 'on' ? 'On' : discovery === 'starting' ? 'Starting' : discovery === 'off' ? 'Off' : 'Blocked'} tone={discovery === 'on' ? 'green' : discovery === 'starting' ? 'gray' : 'amber'} />
        </View>
        {discovery === 'permission_denied' ? (
          <>
            <Banner testID="permission-denied" text="PULSE is not allowed to use the local network, so it cannot find or reach nearby iPhones. Requests are still saved on this device." />
            <Button label="Open iOS Settings" size="sm" variant="secondary" onPress={() => void Linking.openSettings()} />
          </>
        ) : null}
        {discovery === 'error' ? <Banner testID="discovery-error" text={error && error.length > 0 ? `Discovery stopped: ${error}` : 'Discovery stopped. Try turning it off and on.'} /> : null}
        {discovery === 'off' ? <Button testID="discovery-on" label="Turn on discovery" size="sm" onPress={() => void actions.setDiscovery(true)} /> : null}
        {discovery === 'error' ? <Button label="Try again" size="sm" variant="secondary" onPress={() => void actions.setDiscovery(true)} /> : null}
        <Text className="text-[12.5px] leading-[17px] text-gray-1">Uses Wi‑Fi and peer‑to‑peer links between iPhones. No internet or account is involved.</Text>
      </View>

      {paths.length > 0 ? (
        <View testID="relay-card" className="gap-3 rounded-card bg-card p-[18px]">
          <View>
            <Text className="text-[17px] font-bold text-ink">Relay Path</Text>
            <Text className="mt-0.5 text-[13px] text-gray-1">Recorded for open requests. A relay passes sealed data and cannot read it.</Text>
          </View>
          {paths.map((p) => (
            <View key={`${p.shortId}-${p.via}-${p.to}`} className="gap-1 rounded-2xl bg-page p-3">
              <Text className="text-[12px] font-semibold text-gray-1">{p.shortId}</Text>
              <View className="flex-row flex-wrap items-center gap-1.5">
                <Text className="text-[14.5px] font-semibold text-ink">{p.from}</Text>
                <Icon name="forward" size={16} color={colors.gray1} />
                <Text className="text-[14.5px] font-semibold text-ink">{p.via}</Text>
                <Icon name="forward" size={16} color={colors.gray1} />
                <Text className="text-[14.5px] font-semibold text-ink">{p.to}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <SegmentedControl options={SEGMENTS} value={segment} onChange={setSegment} accessibilityLabel="Which devices to list" />

      <GroupedList>
        {list.length === 0 ? (
          <View testID={`peers-empty-${segment}`} className="items-center gap-1 px-5 py-8">
            <Icon name={segment === 'nearby' ? 'radar' : 'group'} size={32} color={colors.gray4} />
            <Text className="mt-1 text-center text-[16px] font-semibold text-ink">{segment === 'nearby' ? 'No nearby device found' : 'No trusted device paired'}</Text>
            <Text className="text-center text-[13px] leading-[18px] text-gray-1">
              {segment === 'nearby'
                ? discovery === 'on'
                  ? 'Open PULSE on another iPhone on the same Wi‑Fi or close by.'
                  : 'Discovery is not running, so nearby devices cannot be seen.'
                : 'Until you pair one, a request is saved on this device and nobody receives it.'}
            </Text>
          </View>
        ) : (
          list.map((p, i) => <PeerRow key={p.deviceId} peer={p} first={i === 0} nowMs={nowMs} onPress={() => setSelectedId(p.deviceId)} />)
        )}
      </GroupedList>

      <Button testID="pair-device" label="Pair a device" icon="group_add" size="md" onPress={() => router.push(routes.pair)} />

      <Sheet visible={selected !== null} onClose={closeSheet}>
        {selected ? (
          <>
            <View className="flex-row items-center gap-[14px]">
              <Avatar name={selected.name} size={62} />
              <View className="flex-1">
                <Text accessibilityRole="header" className="text-[24px] font-extrabold tracking-[-0.6px] text-ink">
                  {selected.name}
                </Text>
                <View className="mt-1.5">
                  <Chip label={presentReach(selected).label} tone={presentReach(selected).tone} />
                </View>
              </View>
            </View>
            <View>
              {[
                { l: 'Trust', v: selected.trusted ? 'Paired · code confirmed on both phones' : 'Not paired' },
                { l: 'Device ID', v: shortDeviceId(selected.deviceId) },
                { l: 'Last seen', v: selected.reach === 'connected' ? 'Link open now' : agoLabel(selected.lastSeenMs, nowMs) },
              ].map((r) => (
                <View key={r.l} className="flex-row justify-between gap-3 border-b border-hairline py-3">
                  <Text className="text-[14.5px] text-gray-1">{r.l}</Text>
                  <Text className="flex-1 text-right text-[14.5px] font-semibold text-ink">{r.v}</Text>
                </View>
              ))}
            </View>
            {rename !== null ? (
              <View className="gap-2">
                <TextField testID="rename-input" label="Name on this device" showLabel value={rename} onChangeText={setRename} maxLength={80} autoFocus />
                <Button
                  testID="rename-save"
                  label="Save name"
                  size="md"
                  disabled={rename.trim().length === 0}
                  onPress={() => {
                    void actions.renamePeer(selected.deviceId, rename.trim());
                    setRename(null);
                  }}
                />
              </View>
            ) : null}
            {!selected.trusted ? (
              <Button
                testID="peer-pair"
                label="Pair this device"
                size="md"
                disabled={busy !== null || selected.reach === 'unreachable'}
                onPress={async () => {
                  const r = await run('pair', () => actions.startPairing(selected.deviceId));
                  if (r.ok) {
                    closeSheet();
                    router.push(routes.pair);
                  }
                }}
              />
            ) : null}
            <View className="flex-row gap-[10px]">
              <View className="flex-1">
                <Button testID="peer-rename" label="Rename" size="md" variant="secondary" onPress={() => setRename(selected.name)} />
              </View>
              {selected.trusted ? (
                <View className="flex-1">
                  <Button testID="peer-remove" label="Remove" size="md" variant="secondary" onPress={() => setRemoving(true)} />
                </View>
              ) : null}
            </View>
          </>
        ) : null}
      </Sheet>

      <Dialog
        visible={removing && selected !== null}
        title={`Remove ${selected?.name ?? 'device'}?`}
        message="This device will no longer be sent your requests, and you will stop receiving theirs. You can pair again later."
        cancelLabel="Keep"
        confirmLabel="Remove"
        destructive
        onCancel={() => setRemoving(false)}
        onConfirm={() => {
          if (selected) void actions.removePeer(selected.deviceId);
          setRemoving(false);
          closeSheet();
        }}
      />
    </Screen>
  );
}
