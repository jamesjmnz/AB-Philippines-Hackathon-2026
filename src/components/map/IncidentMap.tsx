import type { IncidentView } from '@/services/api';
import { usePulse } from '@/services/PulseProvider';
import { avatarColors, CampusMap, initialsOf, type MapFills, type MapPin } from '@/ui';

import { firstName } from '../present';

/**
 * Binds the design's campus map (design `mapFor`, line 1133) to an incident.
 *
 * LIVE: there is no real map position, so the same card and drawing are shown under the design's
 * veil with no pins, and the chip repeats the location in the words that were reported.
 * DEMO: the simulated world is the design's campus, so pins and the highlighted building are drawn
 * exactly as designed.
 */
const HIGHLIGHT = '#F9D0CC';
const RESOLVED = '#D5ECD8';

type Place = { x: number; y: number; fill: keyof MapFills | null };

const PLACES: readonly { match: RegExp; place: Place }[] = [
  { match: /building\s*b/i, place: { x: 283, y: 58, fill: 'b' } },
  { match: /library/i, place: { x: 74, y: 58, fill: 'lib' } },
  { match: /student\s*cent/i, place: { x: 200, y: 152, fill: 'sc' } },
  { match: /parking/i, place: { x: 97, y: 152, fill: 'park' } },
];
const DEFAULT_PLACE: Place = { x: 156, y: 106, fill: null };

/** Where the design parks each simulated person before they move. */
const HOME: Record<string, readonly [number, number]> = { mika: [40, 94], noah: [46, 140], alex: [186, 30] };
const SLOTS: readonly (readonly [number, number])[] = [
  [40, 94],
  [46, 140],
  [186, 30],
];

function fact(view: IncidentView, field: 'building' | 'floor' | 'locationText') {
  return view.facts.find((f) => f.field === field) ?? null;
}

/** "Building B, second floor": the reported words, or null when nothing readable was stated. */
export function mapLabel(view: IncidentView): string | null {
  const building = fact(view, 'building');
  const floor = fact(view, 'floor');
  const text = fact(view, 'locationText');
  const parts: string[] = [];
  if (building && !building.protected && building.value) parts.push(building.value);
  if (floor && !floor.protected && floor.value) parts.push(parts.length > 0 ? floor.value.toLowerCase() : floor.value);
  if (parts.length === 0 && text && !text.protected && text.value) parts.push(text.value);
  return parts.length > 0 ? parts.join(', ') : null;
}

export function locationProtected(view: IncidentView): boolean {
  const building = fact(view, 'building');
  const text = fact(view, 'locationText');
  return (building?.protected ?? false) && (text?.protected ?? true);
}

export function IncidentMap({ view, radius = 20 }: { view: IncidentView; radius?: number }) {
  const { mode } = usePulse();
  const label = mapLabel(view);
  const hidden = locationProtected(view);

  if (hidden) return <CampusMap testID={`map-${view.id}`} radius={radius} veil="Location protected" />;

  if (mode !== 'demo') {
    return <CampusMap testID={`map-${view.id}`} radius={radius} veil="No map position" veilIcon="my_location" label={label ?? 'Location not stated'} />;
  }

  const state = view.state;
  const building = fact(view, 'building')?.value ?? '';
  const place = PLACES.find((p) => p.match.test(building))?.place ?? DEFAULT_PLACE;
  const cancelled = state.closure?.kind === 'cancelled';
  const resolved = state.closure?.kind === 'resolved';
  const fills: MapFills = {};
  if (place.fill && !cancelled) fills[place.fill] = resolved ? RESOLVED : HIGHLIGHT;

  const pins: MapPin[] = [];
  if (!cancelled) pins.push({ key: 'request', kind: 'request', x: place.x, y: place.y });
  if (!state.closure) {
    const reporterId = state.incident?.reporter.deviceId ?? null;
    state.recipients
      .filter((r) => r.deviceId !== reporterId && r.delivery === 'delivered' && !r.declined)
      .forEach((r, i) => {
        const task = state.tasks.find((t) => t.inPerson && t.assignee?.deviceId === r.deviceId);
        let pos = HOME[firstName(r.userName).toLowerCase()] ?? SLOTS[i % SLOTS.length] ?? SLOTS[0];
        if (task) {
          if (task.status === 'in_progress' || task.status === 'completion_reported' || task.status === 'completion_confirmed') pos = [place.x - 34, place.y + 20];
          else if (task.status === 'accepted') pos = [156, 124];
        }
        const c = avatarColors(r.userName);
        pins.push({ key: r.deviceId, kind: 'peer', x: pos?.[0] ?? 40, y: pos?.[1] ?? 94, initials: initialsOf(r.userName), bg: c.bg, fg: c.fg });
      });
  }

  return <CampusMap testID={`map-${view.id}`} radius={radius} fills={fills} pins={pins} label={label ?? 'Location not stated'} />;
}
