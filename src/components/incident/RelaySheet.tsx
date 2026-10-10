import { Fragment } from 'react';
import { View } from 'react-native';

import type { Actor, EventType } from '@/domain';
import type { IncidentView } from '@/services/api';
import { usePulseActions } from '@/services/PulseProvider';
import { Avatar, Banner, Icon, Pill, Sheet, colors } from '@/ui';

import { displayName, EVENT_LOOK, firstName, presentDelivery, timeLabel } from '../present';
import { Text } from '@/ui/Text';

const HOP_TYPES: readonly EventType[] = ['INCIDENT_CREATED', 'PACKET_SENT_ATTEMPT', 'PACKET_RECEIVED_BY_PEER', 'CAPSULE_PREPARED', 'CAPSULE_QUEUED'];
const AMBER_TYPES: readonly EventType[] = ['PACKET_SENT_ATTEMPT', 'CAPSULE_QUEUED'];

function HopRow({ icon, iconColor, label, note, right, testID }: { icon: Parameters<typeof Icon>[0]['name']; iconColor: string; label: string; note: string; right: string; testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
      <Icon name={icon} size={20} color={iconColor} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{label}</Text>
        <Text style={{ fontSize: 13, color: colors.gray1, marginTop: 2 }}>{note}</Text>
      </View>
      <Text style={{ fontSize: 12, color: colors.gray1 }}>{right}</Text>
    </View>
  );
}

/**
 * Relay path sheet (design 827–847): the chain of 52pt avatars, then hop rows. Per-recipient delivery
 * (from receipts only) and seen state are listed here in the hop-row style.
 */
export function RelaySheet({ view, actor, visible, onClose }: { view: IncidentView; actor: Actor; visible: boolean; onClose: () => void }) {
  const actions = usePulseActions();
  const state = view.state;
  const reporter = state.incident?.reporter ?? null;
  const hops = state.timeline.filter((e) => HOP_TYPES.includes(e.type));
  return (
    <Sheet testID="relay-sheet" visible={visible} onClose={onClose}>
      <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '700', letterSpacing: -0.4, color: colors.ink }}>
        Relay path
      </Text>
      <Text style={{ fontSize: 14, color: colors.gray1, marginTop: 4 }}>{view.shortId} · Store-and-forward over nearby devices</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', marginTop: 24, marginBottom: 8 }}>
        {reporter ? (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Avatar name={reporter.userName} size={52} self={reporter.deviceId === actor.deviceId} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.ink }}>{displayName(actor, reporter.deviceId, firstName(reporter.userName))}</Text>
          </View>
        ) : null}
        {state.recipients.map((r) => {
          const delivered = r.delivery === 'delivered';
          const relayed = state.packets.some((p) => p.recipientDeviceId === r.deviceId && p.viaDeviceId !== null);
          return (
            <Fragment key={r.deviceId}>
              <View style={{ width: 44, borderTopWidth: 2, borderStyle: relayed ? 'dashed' : 'solid', borderTopColor: delivered ? colors.ink : colors.disabled, marginHorizontal: 6, marginBottom: 18 }} />
              <View style={{ alignItems: 'center', gap: 6, opacity: delivered ? 1 : 0.5 }}>
                <Avatar name={r.userName} size={52} self={r.deviceId === actor.deviceId} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.ink }}>{displayName(actor, r.deviceId, firstName(r.userName))}</Text>
              </View>
            </Fragment>
          );
        })}
      </View>
      <View style={{ marginTop: 14 }}>
        {state.recipients.length === 0 ? (
          <Text testID="recipients-empty" style={{ fontSize: 14, lineHeight: 20, color: colors.gray1, paddingVertical: 12 }}>
            No trusted device paired when this was created. Nobody has received it.
          </Text>
        ) : (
          state.recipients.map((r) => {
            const d = presentDelivery(r.delivery);
            return (
              <HopRow
                key={r.deviceId}
                testID={`recipient-${r.deviceId}`}
                icon={r.delivery === 'delivered' ? 'done_all' : 'schedule'}
                iconColor={r.delivery === 'delivered' ? colors.ink : colors.amberText}
                label={displayName(actor, r.deviceId, r.userName)}
                note={r.declined ? 'Can’t help' : r.acknowledged ? 'Seen' : 'Not seen yet'}
                right={d.label}
              />
            );
          })
        )}
        {hops.map((e) => {
          const look = EVENT_LOOK[e.type];
          const who = displayName(actor, e.actor.deviceId, firstName(e.actor.userName));
          return (
            <HopRow
              key={e.eventId}
              testID={`hop-${e.eventId}`}
              icon={look.icon}
              iconColor={AMBER_TYPES.includes(e.type) ? colors.amberText : colors.ink}
              label={look.label}
              note={look.meta ? `${who} · ${look.meta}` : who}
              right={timeLabel(e.wallClockMs)}
            />
          );
        })}
      </View>
      <View style={{ gap: 10, marginTop: 20 }}>
        {view.sendFailure === 'packet_too_large' ? (
          // No retry is offered here: sending again cannot get an oversized update out.
          <Banner testID="relay-too-large" icon="warning" text="The latest update is too large to send and has not gone out. Trying again will not send it." />
        ) : view.pendingOutbox > 0 ? <Pill testID="retry-delivery" label="Try delivery again" tone="soft" h={50} size={14} icon="replay" iconSize={16} onPress={() => void actions.retryDelivery(view.id)} /> : null}
        <Pill testID="relay-done" label="Done" h={54} size={16} onPress={onClose} />
      </View>
    </Sheet>
  );
}
