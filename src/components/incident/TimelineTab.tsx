import { Text, View } from 'react-native';

import type { Actor } from '@/domain';
import type { IncidentView } from '@/services/api';
import { TimelineItem, type TimelineEntry } from '@/ui';

import { displayName, EVENT_LOOK, firstName, presentSteps, STEP_REQUIREMENTS, STEP_LABELS, timeLabel } from '../present';

/** Every ledger entry this device holds, then placeholders that say what each later step still needs. */
export function TimelineTab({ view, actor }: { view: IncidentView; actor: Actor }) {
  const entries: TimelineEntry[] = view.state.timeline.map((e) => {
    const look = EVENT_LOOK[e.type];
    const who = displayName(actor, e.actor.deviceId, firstName(e.actor.userName));
    return {
      id: e.eventId,
      icon: look.icon,
      tone: look.tone,
      solid: look.solid,
      label: look.label,
      time: timeLabel(e.wallClockMs),
      meta: look.meta ? `${who} · ${look.meta}` : who,
    };
  });

  const pending: TimelineEntry[] = view.state.closure
    ? []
    : presentSteps(view.state)
        .filter((s) => !s.done)
        .map((s) => ({
          id: `pending-${s.label}`,
          icon: 'more_horiz',
          tone: 'gray',
          label: `${s.label} · not yet`,
          time: '',
          meta: STEP_REQUIREMENTS[s.label as (typeof STEP_LABELS)[number]],
          pending: true,
        }));

  const all = [...entries, ...pending];
  return (
    <View testID="timeline" className="rounded-card bg-card px-4 pb-[2px] pt-4">
      {all.length === 0 ? <Text className="pb-4 text-[14px] text-gray-1">No events on this device yet.</Text> : null}
      {all.map((entry, i) => (
        <TimelineItem key={entry.id} entry={entry} last={i === all.length - 1} />
      ))}
      <Text className="pb-3 text-[11.5px] leading-[16px] text-gray-4">Times are this device’s clock when each event was written. Order comes from the ledger, not from the times.</Text>
    </View>
  );
}
