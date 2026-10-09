import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IncidentView, PeerView, PulseSnapshot } from '@/services/api';
import { usePulse, usePulseActions } from '@/services/PulseProvider';
import { Avatar, Dialog, Enter, Icon, PacketDot, Pill, SegmentedControl, Sheet, colors, tabBarHeight, type IconName, Rule } from '@/ui';

import { useActor } from '../incident/useMe';
import { useRun } from '../incident/useRun';
import { routes } from '../nav';
import { agoLabel, BRAND, DISCOVERY_LABEL, firstName, isOpen, presentNetwork, presentReach, presentStatus, shortDeviceId, type Me } from '../present';

const SEGMENTS = [
  { key: 'nearby', label: 'Nearby' },
  { key: 'trusted', label: 'Trusted' },
] as const;

type Look = { fg: string; bg: string };
const INK: Look = { fg: colors.ink, bg: colors.hairline };
const GREEN: Look = { fg: colors.greenText, bg: colors.greenTint };
const AMBER: Look = { fg: colors.amberText, bg: colors.amberTint };
const CORAL: Look = { fg: colors.coralText, bg: colors.coralTint };
const GRAY: Look = { fg: colors.gray1, bg: colors.hairline };

type Link = { dashed: boolean; live: boolean; label: string; packet: boolean };
type Node = { key: string; name: string; self: boolean; device: string; up: boolean; status: string; look: Look; link: Link | null };

const REACH_FG: Record<PeerView['reach'], string> = { connected: colors.greenText, discovered: colors.amberText, unreachable: colors.gray1 };

/**
 * The relay chain (design `rp`, line 1286), from measured state only: this device, then its trusted
 * peers with the link each one really has; or, for a request received here, the path it arrived by.
 */
function relayChain(snapshot: PulseSnapshot, inc: IncidentView | null): Node[] {
  const meDevice = snapshot.capabilities?.device.model ?? 'This iPhone';
  if (inc && inc.role === 'responder') {
    const reporter = inc.state.incident?.reporter;
    const reporterPeer = snapshot.peers.find((p) => p.deviceId === reporter?.deviceId) ?? null;
    const direct = reporterPeer?.reach === 'connected';
    const nodes: Node[] = [
      {
        key: 'reporter',
        name: reporter?.userName ?? 'Requester',
        self: false,
        device: 'Requester',
        up: reporterPeer ? reporterPeer.reach !== 'unreachable' : true,
        status: reporterPeer ? presentReach(reporterPeer).label : 'Source',
        look: reporterPeer?.reach === 'connected' ? GREEN : INK,
        link: null,
      },
    ];
    if (inc.receivedViaName) {
      nodes.push({ key: 'via', name: inc.receivedViaName, self: false, device: 'Passed it along', up: true, status: 'Relay', look: INK, link: { dashed: true, live: true, label: 'Forwarded incident', packet: false } });
    }
    nodes.push({
      key: 'me',
      name: 'You',
      self: true,
      device: meDevice,
      up: true,
      status: 'Received · this device',
      look: GREEN,
      link: inc.receivedViaName ? { dashed: true, live: true, label: 'Forwarded incident', packet: false } : { dashed: false, live: direct, label: direct ? 'Direct local connection' : 'Not connected', packet: false },
    });
    return nodes;
  }

  const nodes: Node[] = [{ key: 'me', name: 'You', self: true, device: meDevice, up: true, status: 'Source · this device', look: INK, link: null }];
  for (const peer of snapshot.peers.filter((p) => p.trusted).slice(0, 3)) {
    const recipient = inc?.state.recipients.find((r) => r.deviceId === peer.deviceId) ?? null;
    const relayed = inc?.state.packets.some((p) => p.recipientDeviceId === peer.deviceId && p.viaDeviceId !== null) ?? false;
    const live = peer.reach === 'connected';
    let status: string;
    let look: Look;
    if (recipient?.delivery === 'delivered') {
      status = 'Packet delivered';
      look = GREEN;
    } else if (recipient?.delivery === 'send_attempted') {
      status = 'Sending';
      look = AMBER;
    } else if (recipient?.delivery === 'queued' && !live) {
      status = 'Awaiting reconnection';
      look = AMBER;
    } else if (live) {
      status = 'Trusted and connected';
      look = GREEN;
    } else if (peer.reach === 'discovered') {
      status = 'Nearby · not connected';
      look = INK;
    } else {
      status = 'Not reachable';
      look = CORAL;
    }
    nodes.push({
      key: peer.deviceId,
      name: firstName(peer.name),
      self: false,
      device: 'Trusted device',
      up: peer.reach !== 'unreachable',
      status,
      look,
      link: {
        dashed: relayed,
        live: relayed || live,
        label: relayed ? 'Forwarded incident' : live ? 'Direct local connection' : 'Not connected',
        packet: recipient?.delivery === 'send_attempted',
      },
    });
  }
  return nodes;
}

function RelayCard({ me }: { me: Me }) {
  const snapshot = usePulse();
  const open = snapshot.incidents.filter(isOpen);
  const inc = open.find((i) => i.role === 'reporter') ?? open[0] ?? null;
  const nodes = relayChain(snapshot, inc);
  const trusted = snapshot.peers.filter((p) => p.trusted);
  const connected = trusted.filter((p) => p.reach === 'connected').length;
  const demo = snapshot.mode === 'demo';
  const pill = demo ? { text: 'SIMULATED', look: GRAY } : connected === 0 ? { text: 'NO REACHABLE PEER', look: CORAL } : { text: `${connected} CONNECTED`, look: GRAY };
  return (
    <View testID="relay-card" style={{ backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>Relay Path</Text>
          <Text testID="relay-sub" style={{ fontSize: 13, color: colors.gray1, marginTop: 2 }}>
            {inc ? `${inc.shortId} · ${presentStatus(inc.state, me).chip}` : 'No active incident'}
          </Text>
        </View>
        <View testID="relay-pill" style={{ backgroundColor: pill.look.bg, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 8 }}>
          <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: pill.look.fg }}>
            {pill.text}
          </Text>
        </View>
      </View>
      <View style={{ marginTop: 16 }}>
        {nodes.map((n) => (
          <View key={n.key} testID={`relay-node-${n.key}`}>
            {n.link ? (
              <View testID={`relay-link-${n.key}`} style={{ flexDirection: 'row', alignItems: 'stretch', gap: 14, height: 44 }}>
                <View style={{ width: 46, alignItems: 'center' }}>
                  <Rule vertical dashed={n.link.dashed} color={n.link.live ? colors.ink : colors.disabled} />
                  {n.link.packet ? <PacketDot travel={44} left={19} /> : null}
                </View>
                <View style={{ flex: 1, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="south" size={14} color={colors.gray1} />
                  <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: colors.gray1 }}>
                    {n.link.label}
                  </Text>
                </View>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, opacity: n.up ? 1 : 0.55 }}>
              <Avatar name={n.name === 'You' ? snapshot.me.name || '?' : n.name} size={46} self={n.self} presence={n.up ? 'online' : 'offline'} dotSize={12} dotInset={0} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{n.name}</Text>
                <Text style={{ fontSize: 12, color: colors.gray1 }}>{n.device}</Text>
              </View>
              <View style={{ backgroundColor: n.look.bg, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 }}>
                <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: '600', color: n.look.fg }}>
                  {n.status}
                </Text>
              </View>
            </View>
          </View>
        ))}
        {trusted.length === 0 && !(inc && inc.role === 'responder') ? (
          <Text testID="relay-empty" style={{ fontSize: 13, lineHeight: 18.2, color: colors.gray1, marginTop: 14 }}>
            No trusted device paired. Requests are saved on this device and reach nobody.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function PeerRow({ peer, first, onPress, nowMs }: { peer: PeerView; first: boolean; onPress: () => void; nowMs: number }) {
  const reach = presentReach(peer);
  return (
    <Pressable
      testID={`peer-${peer.deviceId}`}
      accessibilityRole="button"
      accessibilityLabel={`${peer.name}, ${peer.trusted ? 'trusted' : 'not paired'}, ${reach.label}`}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#FFFFFF', borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline, opacity: peer.reach === 'unreachable' ? 0.7 : 1 }}>
      <Avatar name={peer.name} size={40} presence={reach.online ? 'online' : 'offline'} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{peer.name}</Text>
        <Text style={{ fontSize: 12.5, color: colors.gray1, marginTop: 1 }}>{peer.trusted ? 'Trusted · code confirmed' : 'Not paired'}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 12.5, fontWeight: '600', color: REACH_FG[peer.reach] }}>{reach.label}</Text>
        <Text style={{ fontSize: 11.5, color: colors.gray4, marginTop: 1 }}>{peer.reach === 'connected' ? 'Link open' : agoLabel(peer.lastSeenMs, nowMs)}</Text>
      </View>
    </Pressable>
  );
}

/** Demo only (design 352–355). Only the simulation actions the service contract really has. */
function SimulationControls() {
  const { demo } = usePulse();
  const actions = usePulseActions();
  const [open, setOpen] = useState(false);
  if (!demo) return null;
  const items: { key: string; label: string; icon: IconName; run: () => void }[] = [
    { key: 'mika-off', label: 'Disconnect Mika', icon: 'link_off', run: () => actions.demo.setLink('mika', false) },
    { key: 'mika-on', label: 'Reconnect Mika', icon: 'link', run: () => actions.demo.setLink('mika', true) },
    { key: 'noah', label: demo.links.noah ? 'Disconnect Noah' : 'Reconnect Noah', icon: demo.links.noah ? 'link_off' : 'link', run: () => actions.demo.setLink('noah', !demo.links.noah) },
    { key: 'ai', label: demo.aiReady ? 'Local AI off' : 'Local AI on', icon: 'memory', run: () => actions.demo.setAIReady(!demo.aiReady) },
    { key: 'reset', label: 'Reset scenario', icon: 'restart_alt', run: () => actions.demo.reset() },
  ];
  return (
    <View testID="sim-controls" style={{ backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 14, paddingHorizontal: 16 }}>
      <Pressable
        testID="sim-toggle"
        accessibilityRole="button"
        accessibilityLabel="Simulation controls"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        hitSlop={{ top: 12, bottom: 12 }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="science" size={19} />
        <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink }}>Simulation controls</Text>
        <View style={{ backgroundColor: colors.hairline, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 7 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.4, color: colors.gray1 }}>DEMO</Text>
        </View>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={20} />
      </Pressable>
      {open ? (
        <Enter kind="fadeUp" duration={250} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {items.map((a) => (
            <View key={a.key} style={{ flexBasis: '48%', flexGrow: 1 }}>
              <Pill testID={`sim-${a.key}`} label={a.label} tone="softer" h={40} size={13} radius={12} icon={a.icon} iconSize={16} px={6} onPress={a.run} />
            </View>
          ))}
        </Enter>
      ) : null}
    </View>
  );
}

/** Network (design 315–358) and the peer sheet (849–869). */
export function NetworkScreen() {
  const snapshot = usePulse();
  const actions = usePulseActions();
  const actor = useActor();
  const insets = useSafeAreaInsets();
  const { busy, run } = useRun();
  const [segment, setSegment] = useState<'nearby' | 'trusted'>('nearby');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const { discovery, error } = snapshot.network;
  const summary = presentNetwork(snapshot);
  // The summary already names a denied permission or an error; "off" and "starting" it may not.
  const stateLine = (discovery === 'off' || discovery === 'starting') && !/discovery/i.test(summary.text) ? DISCOVERY_LABEL[discovery] : summary.text;
  const nearby = snapshot.peers.filter((p) => p.reach !== 'unreachable');
  const trusted = snapshot.peers.filter((p) => p.trusted);
  const list = segment === 'nearby' ? nearby : trusted;
  const selected = snapshot.peers.find((p) => p.deviceId === selectedId) ?? null;
  const closeSheet = () => {
    setSelectedId(null);
    setRename(null);
  };

  const banner =
    discovery === 'permission_denied'
      ? { testID: 'permission-denied', text: `${BRAND} is not allowed to use the local network, so it cannot find or reach nearby iPhones. Requests are still saved on this device.`, action: 'Open iOS Settings', actionID: 'open-settings', run: () => void Linking.openSettings() }
      : discovery === 'error'
        ? { testID: 'discovery-error', text: error && error.length > 0 ? `Discovery stopped: ${error}` : 'Discovery stopped. Try turning it off and on.', action: 'Try again', actionID: 'discovery-retry', run: () => void actions.setDiscovery(true) }
        : discovery === 'off'
          ? { testID: 'discovery-off', text: 'Discovery is off, so nearby devices cannot be seen or reached. Requests are still saved on this device.', action: 'Turn on discovery', actionID: 'discovery-on', run: () => void actions.setDiscovery(true) }
          : null;

  const demoKey = selected && snapshot.demo ? (firstName(selected.name).toLowerCase() === 'mika' ? 'mika' : firstName(selected.name).toLowerCase() === 'noah' ? 'noah' : null) : null;
  const selectedReach = selected ? presentReach(selected) : null;
  const selectedLook: Look = selected?.reach === 'connected' ? GREEN : GRAY;

  return (
    <View testID="network-screen" style={{ flex: 1, backgroundColor: colors.page, paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: tabBarHeight(insets.bottom) + 30 }}>
        <Enter kind="fadeUp" duration={350} style={{ paddingTop: 8, paddingHorizontal: 20, gap: 18 }}>
          <View style={{ paddingTop: 6 }}>
            <Text accessibilityRole="header" style={{ fontSize: 30, fontWeight: '700', letterSpacing: -0.9, color: colors.ink }}>
              Your Network
            </Text>
            <Text testID="discovery-state" accessibilityLiveRegion="polite" style={{ fontSize: 15, color: colors.gray1, marginTop: 4 }}>
              {stateLine}
            </Text>
          </View>

          {banner ? (
            <View testID={banner.testID} accessibilityRole="alert" style={{ backgroundColor: colors.amberTint, borderRadius: 16, padding: 14, gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Icon name="info" size={18} color={'#7A4E0B'} />
                <Text style={{ flex: 1, fontSize: 13, lineHeight: 18.85, color: '#7A4E0B' }}>{banner.text}</Text>
              </View>
              <Pill testID={banner.actionID} label={banner.action} tone="white" h={40} size={13.5} onPress={banner.run} />
            </View>
          ) : null}

          <RelayCard me={actor} />

          <SegmentedControl options={SEGMENTS} value={segment} onChange={setSegment} accessibilityLabel="Which devices to list" />

          <View style={{ backgroundColor: '#FFFFFF', borderRadius: 22, overflow: 'hidden' }}>
            {list.length === 0 ? (
              <View testID={`peers-empty-${segment}`} style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 }}>
                <Icon name={segment === 'nearby' ? 'radar' : 'group'} size={36} color={colors.gray1} />
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink, marginTop: 10, textAlign: 'center' }}>{segment === 'nearby' ? 'No nearby device found' : 'No trusted device paired'}</Text>
                <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 4, textAlign: 'center' }}>
                  {segment === 'nearby'
                    ? discovery === 'on'
                      ? `Open ${BRAND} on another iPhone on the same Wi‑Fi or close by.`
                      : 'Discovery is not running, so nearby devices cannot be seen.'
                    : 'Until you pair one, a request is saved on this device and nobody receives it.'}
                </Text>
                {segment === 'trusted' ? (
                  <View style={{ alignSelf: 'stretch', marginTop: 16 }}>
                    <Pill testID="pair-device" label="Pair a device" h={46} size={14.5} press={0.97} onPress={() => router.push(routes.pair)} />
                  </View>
                ) : null}
              </View>
            ) : (
              list.map((p, i) => <PeerRow key={p.deviceId} peer={p} first={i === 0} nowMs={nowMs} onPress={() => setSelectedId(p.deviceId)} />)
            )}
          </View>

          <SimulationControls />
        </Enter>
      </ScrollView>

      <Sheet testID="peer-sheet" visible={selected !== null} onClose={closeSheet}>
        {selected && selectedReach ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Avatar name={selected.name} size={62} />
              <View style={{ flex: 1 }}>
                <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: '800', letterSpacing: -0.6, color: colors.ink }}>
                  {selected.name}
                </Text>
                <View style={{ alignSelf: 'flex-start', backgroundColor: selectedLook.bg, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9, marginTop: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: selectedLook.fg }}>{selectedReach.label}</Text>
                </View>
              </View>
            </View>
            <View style={{ marginTop: 16 }}>
              {[
                { l: 'Trust', v: selected.trusted ? 'Paired · code confirmed on both phones' : 'Not paired' },
                { l: 'Device ID', v: shortDeviceId(selected.deviceId) },
                { l: 'Connection', v: selectedReach.label },
                { l: 'Last seen', v: selected.reach === 'connected' ? 'Link open now' : agoLabel(selected.lastSeenMs, nowMs) },
              ].map((r) => (
                <View key={r.l} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
                  <Text style={{ fontSize: 14.5, color: colors.gray1 }}>{r.l}</Text>
                  <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.ink, textAlign: 'right' }}>{r.v}</Text>
                </View>
              ))}
            </View>
            {rename !== null ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                <TextInput
                  testID="rename-input"
                  accessibilityLabel="Name on this device"
                  value={rename}
                  onChangeText={setRename}
                  maxLength={80}
                  autoFocus
                  placeholder="Name on this device"
                  placeholderTextColor={colors.gray4}
                  style={{ flex: 1, minWidth: 0, minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: colors.lineInput, backgroundColor: '#FAFAFB', paddingHorizontal: 14, fontSize: 16, color: colors.ink }}
                />
                <Pill
                  testID="rename-save"
                  label="Save name"
                  h={44}
                  size={15}
                  px={18}
                  disabled={rename.trim().length === 0}
                  onPress={() => {
                    void actions.renamePeer(selected.deviceId, rename.trim());
                    setRename(null);
                  }}
                />
              </View>
            ) : null}
            <View style={{ gap: 10, marginTop: 20 }}>
              {!selected.trusted ? (
                <Pill
                  testID="peer-pair"
                  label="Pair this device"
                  h={54}
                  size={16}
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
              {demoKey && snapshot.demo ? (
                <Pill
                  testID="peer-sim-link"
                  label={snapshot.demo.links[demoKey] ? 'Simulate disconnect' : 'Simulate reconnection'}
                  h={54}
                  size={16}
                  onPress={() => {
                    actions.demo.setLink(demoKey, !(snapshot.demo?.links[demoKey] ?? false));
                    closeSheet();
                  }}
                />
              ) : null}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pill testID="peer-rename" label="Rename" tone="soft" h={50} size={14} flex onPress={() => setRename(selected.name)} />
                {selected.trusted ? <Pill testID="peer-remove" label="Remove" tone="soft" h={50} size={14} flex onPress={() => setRemoving(true)} /> : null}
              </View>
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
    </View>
  );
}
