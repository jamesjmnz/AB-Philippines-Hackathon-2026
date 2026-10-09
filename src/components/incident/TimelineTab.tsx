import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Actor } from '@/domain';
import type { IncidentView } from '@/services/api';
import { usePulse } from '@/services/PulseProvider';
import { Icon, colors, design, tones, type IconName } from '@/ui';

import { displayName, EVENT_LOOK, firstName, presentSteps, shortDeviceId, STEP_LABELS, STEP_REQUIREMENTS, timeLabel } from '../present';
import { CardBox, MoreRow, SectionTitle } from './parts';
import { RelaySheet } from './RelaySheet';

type Row = { id: string; icon: IconName; fg: string; bg: string; label: string; time: string; meta: string; pending: boolean };

/** One update (design 521–527): 28pt disc, 2pt connector, 14.5/600 label, 12pt time, 12.5pt meta. */
function UpdateRow({ row, last }: { row: Row; last: boolean }) {
  return (
    <View accessible accessibilityLabel={`${row.label}, ${row.time}${row.meta ? `, ${row.meta}` : ''}`} style={{ flexDirection: 'row', gap: 12, opacity: row.pending ? 0.6 : 1 }}>
      <View style={{ width: 28, alignItems: 'center' }}>
        <View
          style={[
            { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: row.bg },
            row.pending ? { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.disabled } : null,
          ]}>
          <Icon name={row.icon} size={16} color={row.fg} />
        </View>
        {last ? null : <View style={{ width: 2, flex: 1, minHeight: 10, backgroundColor: colors.line, marginVertical: 3 }} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingTop: 4, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.ink }}>{row.label}</Text>
          <Text style={{ fontSize: 12, color: colors.gray1 }}>{row.time}</Text>
        </View>
        {row.meta ? <Text style={{ fontSize: 12.5, lineHeight: 17.5, color: colors.gray1, marginTop: 2 }}>{row.meta}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Timeline segment: every ledger entry this device holds, then the design's dashed "Pending" rows that
 * say what each later step still needs; "Relay history"; and the technical log when the setting is on.
 */
export function TimelineTab({ view, actor }: { view: IncidentView; actor: Actor }) {
  const { mode, settings } = usePulse();
  const [relay, setRelay] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const state = view.state;

  const rows: Row[] = state.timeline.map((e) => {
    const look = EVENT_LOOK[e.type];
    const tone = tones[look.tone];
    const who = displayName(actor, e.actor.deviceId, firstName(e.actor.userName));
    return {
      id: e.eventId,
      icon: look.icon,
      fg: look.solid ? '#FFFFFF' : tone.fg,
      bg: look.solid ? colors.green : tone.bg,
      label: look.label,
      time: timeLabel(e.wallClockMs),
      meta: look.meta ? `${who} · ${look.meta}` : who,
      pending: false,
    };
  });
  if (!state.closure) {
    for (const s of presentSteps(state)) {
      if (s.done) continue;
      rows.push({ id: `pending-${s.label}`, icon: 'more_horiz', fg: colors.gray4, bg: '#FFFFFF', label: s.label, time: 'Pending', meta: STEP_REQUIREMENTS[s.label as (typeof STEP_LABELS)[number]], pending: true });
    }
  }

  const log = [
    ...state.timeline.map((e, i) => `#${String(i + 1).padStart(2, '0')} ${timeLabel(e.wallClockMs)} ${e.type} src="${shortDeviceId(e.actor.deviceId)}"`),
    `pkt.count=${state.packets.length} queue=${view.pendingOutbox} events=${state.ledger.eventCount}`,
  ];

  return (
    <>
      <SectionTitle>Updates</SectionTitle>
      <View testID="timeline" style={{ backgroundColor: '#FFFFFF', borderRadius: 22, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 2 }}>
        {rows.length === 0 ? <Text style={{ fontSize: 14, color: colors.gray1, paddingBottom: 14 }}>No events on this device yet.</Text> : null}
        {rows.map((row, i) => (
          <UpdateRow key={row.id} row={row} last={i === rows.length - 1} />
        ))}
      </View>

      <SectionTitle>More</SectionTitle>
      <CardBox>
        <MoreRow first testID="open-relay" icon="route" label="Relay history" onPress={() => setRelay(true)} />
      </CardBox>

      {settings.showTechnicalDetails ? (
        <View testID="tech-log" style={{ backgroundColor: design.soft, borderRadius: 18, padding: 14, gap: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.gray2 }}>{mode === 'demo' ? 'DEMO · SIMULATED' : 'TECHNICAL DETAILS'}</Text>
          <Pressable
            testID="tech-log-toggle"
            accessibilityRole="button"
            accessibilityState={{ expanded: logOpen }}
            hitSlop={{ top: 12, bottom: 12 }}
            onPress={() => setLogOpen((o) => !o)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>Technical event log</Text>
            <Icon name={logOpen ? 'expand_less' : 'expand_more'} size={18} />
          </Pressable>
          {logOpen ? (
            <View testID="tech-log-lines" style={{ gap: 3 }}>
              {log.map((line) => (
                <Text key={line} style={{ fontFamily: 'Menlo', fontSize: 10.5, lineHeight: 15.2, color: colors.gray3 }}>
                  {line}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <RelaySheet view={view} actor={actor} visible={relay} onClose={() => setRelay(false)} />
    </>
  );
}
