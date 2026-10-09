import '../testing/mocks';

import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { FactView, IncidentView } from '@/services/api';
import { CampusMap } from '@/ui';

import { IncidentMap, mapLabel } from '../map/IncidentMap';
import { createFakePulseApp, viewOf } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { MIKA, sosAcknowledged, sosCancelled, sosInProgress, sosQueued, sosResolved } from '../testing/scenarios';

function withFacts(view: IncidentView, patch: Partial<Record<FactView['field'], Partial<FactView>>>): IncidentView {
  return { ...view, facts: view.facts.map((f) => ({ ...f, ...(patch[f.field] ?? {}) })) };
}

const atBuildingB = (view: IncidentView) => withFacts(view, { building: { value: 'Building B', tag: 'user_reported' }, floor: { value: 'Second floor', tag: 'user_reported' } });

/** The building fills handed to the drawing, to check which building is highlighted. */
function fills(): string[] {
  return Object.values(screen.UNSAFE_getByType(CampusMap).props.fills ?? {});
}

describe('campus map card', () => {
  it('is the design drawing: 17:9, the given radius, map paper, the near_me button', () => {
    render(<CampusMap radius={16} label="Building B" />);
    const style = StyleSheet.flatten(screen.getByTestId('campus-map').props.style);
    expect(style).toMatchObject({ width: '100%', aspectRatio: 17 / 9, borderRadius: 16, overflow: 'hidden', backgroundColor: '#F8F4EC' });
    const drawn = JSON.stringify(screen.toJSON());
    for (const name of ['Library', 'Building B', 'Parking', 'Student Ctr', 'Rizal Park', 'Rizal Ave', 'Campus Dr']) {
      expect(drawn).toContain(`"content":"${name}"`);
    }
    expect(screen.getByTestId('map-label')).toHaveTextContent('Building B');
    expect(screen.queryByTestId('map-veil')).toBeNull();
  });

  it('LIVE: the same card under the veil, no pins, and the chip repeats the reported words', () => {
    const view = atBuildingB(viewOf(sosAcknowledged().state));
    renderWithApp(<IncidentMap view={view} />, createFakePulseApp({ mode: 'live', incidents: [view] }));
    expect(screen.getByTestId(`map-${view.id}`)).toBeTruthy();
    expect(screen.getByTestId('map-veil')).toHaveTextContent('No map position');
    expect(screen.getByTestId('map-label')).toHaveTextContent('Building B, second floor');
    expect(screen.queryByTestId('map-pin-request')).toBeNull();
    expect(screen.queryByTestId(`map-pin-${MIKA.deviceId}`)).toBeNull();
    // No building is highlighted, because nothing is known about where on a map this is.
    expect(fills().some((f) => f.includes('#F9D0CC'))).toBe(false);
  });

  it('LIVE: says the location was not stated rather than inventing one', () => {
    const view = viewOf(sosQueued().state);
    renderWithApp(<IncidentMap view={view} />, createFakePulseApp({ incidents: [view] }));
    expect(mapLabel(view)).toBeNull();
    expect(screen.getByTestId('map-label')).toHaveTextContent('Location not stated');
    expect(screen.queryByTestId('map-pin-request')).toBeNull();
  });

  it('DEMO: pins as designed, no veil, the reported building highlighted', () => {
    const view = atBuildingB(viewOf(sosAcknowledged().state));
    renderWithApp(<IncidentMap view={view} />, createFakePulseApp({ mode: 'demo', incidents: [view] }));
    expect(screen.queryByTestId('map-veil')).toBeNull();
    expect(screen.getByTestId('map-pin-request')).toBeTruthy();
    // Mika holds a delivery receipt; Noah does not, so only Mika is drawn.
    expect(screen.getByTestId(`map-pin-${MIKA.deviceId}`)).toHaveTextContent('MS');
    expect(screen.getAllByTestId(/^map-pin-/)).toHaveLength(2);
    expect(screen.getByTestId('map-label')).toHaveTextContent('Building B, second floor');
    expect(fills().some((f) => f.includes('#F9D0CC'))).toBe(true);
  });

  it('DEMO: a responder who is on the way is still drawn, a closed request has no responders, a cancelled one no pin', () => {
    const moving = atBuildingB(viewOf(sosInProgress().state));
    const first = renderWithApp(<IncidentMap view={moving} />, createFakePulseApp({ mode: 'demo', incidents: [moving] }));
    expect(screen.getByTestId(`map-pin-${MIKA.deviceId}`)).toBeTruthy();
    first.unmount();

    const resolved = atBuildingB(viewOf(sosResolved().state));
    const second = renderWithApp(<IncidentMap view={resolved} />, createFakePulseApp({ mode: 'demo', incidents: [resolved] }));
    expect(screen.getByTestId('map-pin-request')).toBeTruthy();
    expect(screen.queryByTestId(`map-pin-${MIKA.deviceId}`)).toBeNull();
    expect(fills().some((f) => f.includes('#D5ECD8'))).toBe(true);
    second.unmount();

    const cancelled = atBuildingB(viewOf(sosCancelled().state));
    renderWithApp(<IncidentMap view={cancelled} />, createFakePulseApp({ mode: 'demo', incidents: [cancelled] }));
    expect(screen.queryByTestId('map-pin-request')).toBeNull();
  });

  it.each(['live', 'demo'] as const)('%s: a location this device may not read is veiled as protected, with no chip and no pins', (mode) => {
    const base = viewOf(sosAcknowledged().state, MIKA, { access: 'relay' });
    const view = withFacts(base, { building: { value: null, protected: true }, floor: { value: null, protected: true }, locationText: { value: null, protected: true } });
    renderWithApp(<IncidentMap view={view} />, createFakePulseApp({ mode, incidents: [view] }));
    expect(screen.getByTestId('map-veil')).toHaveTextContent('Location protected');
    expect(screen.queryByTestId('map-label')).toBeNull();
    expect(screen.queryByTestId('map-pin-request')).toBeNull();
  });
});
