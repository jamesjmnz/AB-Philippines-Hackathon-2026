import '../testing/mocks';

import { fireEvent, screen, within } from '@testing-library/react-native';

import type { IncidentView, UpdateView } from '@/services/api';

import { IncidentScreen } from '../incident/IncidentScreen';
import { presentUpdate, UPDATE_LABELS } from '../present';
import { createFakePulseApp, viewOf } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { MIKA, sosAcknowledged, sosFloorConflict, sosSecondSource, sosSelfCorrection } from '../testing/scenarios';

const asMika = { deviceId: MIKA.deviceId, name: MIKA.userName, onboarded: true, hardwareBackedKeys: true };

function open(view: IncidentView, me?: typeof asMika) {
  renderWithApp(<IncidentScreen incidentId={view.id} />, createFakePulseApp({ incidents: [view], ...(me ? { me } : {}) }));
}

function only(view: IncidentView): UpdateView {
  const update = view.updates[0];
  if (!update || view.updates.length !== 1) throw new Error('expected exactly one update');
  return update;
}

const update = (n: number, patch: Partial<UpdateView> = {}): UpdateView => ({
  reportId: `rpt-${n}`,
  by: `Person ${n}`,
  kind: 'observation',
  overall: 'new_information',
  basis: 'rules',
  needsVerification: false,
  fields: [{ field: 'locationText', class: 'new_information' }],
  ...patch,
});

beforeEach(() => jest.clearAllMocks());

describe('incident updates', () => {
  it('renders nothing when there is no later statement', () => {
    open(viewOf(sosAcknowledged().state));
    expect(screen.getByTestId('facts-card')).toBeTruthy();
    expect(screen.queryByTestId('updates-card')).toBeNull();
    expect(screen.queryByText('Updates')).toBeNull();
  });

  it('shows a reporter’s own correction as an update, neutral, with no check asked and no conflict raised', () => {
    const view = viewOf(sosSelfCorrection().state);
    const u = only(view);
    expect(u).toMatchObject({ by: 'You', overall: 'correction', basis: 'rules', needsVerification: false });
    open(view);

    const row = screen.getByTestId(`update-${u.reportId}`);
    expect(row).toHaveTextContent(/You · Floor/);
    expect(row).toHaveTextContent(/Updated own earlier statement/);
    expect(row).toHaveTextContent(/From the wording rules/);
    expect(row.props.accessibilityLabel).toBe('You: Updated own earlier statement. Floor. From the wording rules');
    expect(screen.queryByTestId(`update-flag-${u.reportId}`)).toBeNull();
    expect(screen.queryByTestId('conflict-floor')).toBeNull();
    // The card names how the statement reads and never repeats its words.
    expect(within(screen.getByTestId('updates-card')).queryByText(/moved from/i)).toBeNull();
  });

  it('shows a responder’s differing floor in amber for the reporter, as a difference and not as an error', () => {
    const view = viewOf(sosFloorConflict().state);
    const u = only(view);
    expect(u).toMatchObject({ by: 'Mika Santos', overall: 'possible_contradiction', needsVerification: true });
    open(view);

    const row = screen.getByTestId(`update-${u.reportId}`);
    expect(row).toHaveTextContent(/Mika Santos · Floor/);
    expect(row).toHaveTextContent(/Differs from what was reported/);
    expect(screen.getByTestId(`update-flag-${u.reportId}`)).toHaveTextContent('Needs your check');
    expect(row.props.accessibilityLabel).toBe('Mika Santos: Differs from what was reported. Floor. Needs your check. From the wording rules');
    expect(presentUpdate(u, 'reporter').tone).toBe('amber');
    const card = screen.getByTestId('updates-card');
    expect(within(card).queryByText(/wrong|incorrect|mistake|error|false|resolved|severity/i)).toBeNull();
    // It sits below the conflict card, which is where the two statements are shown and settled.
    expect(screen.getByTestId('conflict-floor')).toBeTruthy();
  });

  it('tells a responder that the check is the requester’s to make', () => {
    const view = viewOf(sosFloorConflict().state, MIKA);
    const u = only(view);
    open(view, asMika);
    expect(screen.getByTestId(`update-${u.reportId}`)).toHaveTextContent(/You · Floor/);
    expect(screen.getByTestId(`update-flag-${u.reportId}`)).toHaveTextContent('Requester to check');
    expect(presentUpdate(u, 'responder').tone).toBe('amber');
  });

  it('marks a second source that the rules matched in green', () => {
    const view = viewOf(sosSecondSource().state);
    const u = only(view);
    expect(u).toMatchObject({ by: 'Mika Santos', overall: 'confirmation', basis: 'rules', needsVerification: false });
    open(view);
    expect(screen.getByTestId(`update-${u.reportId}`)).toHaveTextContent(/Same as reported/);
    expect(screen.getByTestId(`update-flag-${u.reportId}`)).toHaveTextContent('Second source');
    expect(presentUpdate(u, 'reporter').tone).toBe('green');
  });

  it('labels a model reading as not a fact and never shows it in green', () => {
    const base = viewOf(sosSecondSource().state);
    const u = { ...only(base), basis: 'model' as const };
    open({ ...base, updates: [u] });
    expect(screen.getByTestId(`update-basis-${u.reportId}`)).toHaveTextContent('On-device AI reading · not a fact');
    expect(screen.getByTestId(`update-${u.reportId}`).props.accessibilityLabel).toMatch(/On-device AI reading · not a fact$/);
    expect(screen.queryByTestId(`update-flag-${u.reportId}`)).toBeNull();
    expect(presentUpdate(u, 'reporter')).toMatchObject({ tone: 'neutral', flag: null, fromModel: true });
    // A model reading that still needs a person stays amber.
    expect(presentUpdate({ ...u, overall: 'possible_contradiction', needsVerification: true }, 'reporter')).toMatchObject({ tone: 'amber', flag: 'Needs your check' });
  });

  it('never uses coral, whatever the class', () => {
    for (const overall of Object.keys(UPDATE_LABELS) as UpdateView['overall'][]) {
      for (const needsVerification of [true, false]) {
        for (const basis of ['rules', 'model'] as const) {
          expect(['neutral', 'amber', 'green']).toContain(presentUpdate(update(1, { overall, needsVerification, basis }), 'reporter').tone);
        }
      }
    }
    expect(presentUpdate(update(1, { overall: 'not_assessed', fields: [] }), 'responder')).toMatchObject({ label: 'Not compared', fields: '', accessibilityLabel: 'Person 1: Not compared. From the wording rules' });
  });

  it('lists the newest first and keeps earlier ones behind one tap', () => {
    const base = viewOf(sosAcknowledged().state);
    open({ ...base, updates: [1, 2, 3, 4, 5, 6, 7].map((n) => update(n)) });
    const card = screen.getByTestId('updates-card');
    expect(within(card).getAllByLabelText(/^Person \d: /).map((row) => row.props.testID)).toEqual(['update-rpt-7', 'update-rpt-6', 'update-rpt-5', 'update-rpt-4', 'update-rpt-3']);
    expect(screen.getByTestId('updates-show-all')).toHaveTextContent('Show 2 earlier');
    expect(screen.queryByTestId('update-rpt-2')).toBeNull();
    fireEvent.press(screen.getByTestId('updates-show-all'));
    expect(screen.getByTestId('update-rpt-2')).toBeTruthy();
    expect(screen.getByTestId('update-rpt-1')).toBeTruthy();
    expect(screen.queryByTestId('updates-show-all')).toBeNull();
  });
});
