import '../testing/mocks';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import type { ProvenanceTag } from '@/domain';
import type { FactView, IncidentView } from '@/services/api';

import { IncidentScreen } from '../incident/IncidentScreen';
import { FactRow } from '../incident/IntelligenceTab';
import { PROVENANCE } from '../present';
import { createFakePulseApp, ME, viewOf, type FakePulseApp } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { MIKA, NOAH, sosAcknowledged, sosFloorConflict, sosInProgress, sosNoPeer, sosQueued, sosResolved, sosRoleTaken, sosWithOpenTask } from '../testing/scenarios';

const asMika = { deviceId: MIKA.deviceId, name: MIKA.userName, onboarded: true, hardwareBackedKeys: true };
const asNoah = { deviceId: NOAH.deviceId, name: NOAH.userName, onboarded: true, hardwareBackedKeys: true };

function open(view: IncidentView, me?: typeof asMika, segment?: 'intelligence' | 'coordination' | 'timeline' | 'capsule'): FakePulseApp {
  const app = createFakePulseApp({ incidents: [view], ...(me ? { me } : {}) });
  renderWithApp(<IncidentScreen incidentId={view.id} initialSegment={segment} />, app);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('provenance chips', () => {
  const EXPECTED: Record<ProvenanceTag, string> = {
    user_reported: 'user reported',
    ai_proposed: 'AI proposed',
    user_confirmed: 'user confirmed',
    responder_reported: 'responder reported',
    unresolved: 'unresolved',
    unknown: 'unknown',
  };

  it.each(Object.entries(EXPECTED) as [ProvenanceTag, string][])('%s is shown as "%s"', (tag, label) => {
    expect(PROVENANCE[tag].label).toBe(label);
    const fact: FactView = { field: 'floor', value: tag === 'unknown' || tag === 'unresolved' ? null : 'Third floor', tag, by: 'You', evidence: null, protected: false, candidates: [] };
    render(<FactRow fact={fact} first />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('shows unknown as unknown and a protected row with a lock instead of a value', () => {
    const fact: FactView = { field: 'symptom', value: null, tag: 'unknown', by: null, evidence: null, protected: true, candidates: [] };
    render(<FactRow fact={fact} first />);
    expect(screen.getByTestId('fact-lock-symptom')).toBeTruthy();
    expect(screen.getByText('Protected')).toBeTruthy();
    expect(screen.queryByText('unknown')).toBeNull();
  });

  it('derives the chips on a real incident from its claims', () => {
    open(viewOf(sosFloorConflict().state));
    expect(within(screen.getByTestId('fact-incidentType')).getByText('user reported')).toBeTruthy();
    expect(within(screen.getByTestId('fact-building')).getByText('user reported')).toBeTruthy();
    expect(within(screen.getByTestId('fact-floor')).getByText('unresolved')).toBeTruthy();
    expect(within(screen.getByTestId('fact-symptom')).getByText('unknown')).toBeTruthy();
    expect(screen.getByTestId('original-report')).toHaveTextContent(/3rd floor of Building B/);
  });
});

describe('corrected floor conflict', () => {
  it('shows both values and who said each; the reporter can resolve it', async () => {
    const view = viewOf(sosFloorConflict().state);
    const conflictId = view.state.contradictions[0]?.id ?? '';
    const app = open(view);

    const card = screen.getByTestId('conflict-floor');
    expect(within(card).getByText('Third floor')).toBeTruthy();
    expect(within(card).getByText('Fourth floor')).toBeTruthy();
    expect(within(screen.getByTestId('conflict-value-Third floor')).getByText('Said by You')).toBeTruthy();
    expect(within(screen.getByTestId('conflict-value-Fourth floor')).getByText('Said by Mika Santos')).toBeTruthy();
    expect(screen.queryByTestId('conflict-ask')).toBeNull();

    fireEvent.press(screen.getByTestId('conflict-pick-Fourth floor'));
    await waitFor(() => expect(app.actions.resolveConflict).toHaveBeenCalledWith(view.id, conflictId, 'Fourth floor'));
  });

  it('a responder sees both values but cannot resolve, only request clarification', async () => {
    const view = viewOf(sosFloorConflict().state, MIKA);
    const conflictId = view.state.contradictions[0]?.id ?? '';
    const app = open(view, asMika);

    const card = screen.getByTestId('conflict-floor');
    expect(within(card).getByText('Third floor')).toBeTruthy();
    expect(within(card).getByText('Fourth floor')).toBeTruthy();
    expect(screen.queryByTestId('conflict-pick-Third floor')).toBeNull();
    expect(screen.queryByTestId('conflict-pick-Fourth floor')).toBeNull();

    fireEvent.press(screen.getByTestId('conflict-ask'));
    await waitFor(() => expect(app.actions.requestConflictClarification).toHaveBeenCalledWith(view.id, conflictId));
    expect(app.actions.resolveConflict).not.toHaveBeenCalled();
  });
});

describe('coordination', () => {
  it('lets a responder mark as seen or decline, and take an open role', async () => {
    const { state, taskId } = sosWithOpenTask();
    const view = viewOf(state, NOAH);
    const app = open(view, asNoah, 'coordination');

    fireEvent.press(screen.getByTestId('ack'));
    await waitFor(() => expect(app.actions.acknowledge).toHaveBeenCalledWith(view.id));
    fireEvent.press(screen.getByTestId(`task-accept-${taskId}`));
    await waitFor(() => expect(app.actions.acceptTask).toHaveBeenCalledWith(view.id, taskId));
    // A responder who holds nothing may not resolve or cancel.
    expect(screen.queryByTestId('resolve')).toBeNull();
    expect(screen.queryByTestId('cancel-request')).toBeNull();
    expect(screen.queryByTestId(`task-confirm-${taskId}`)).toBeNull();
  });

  it('gives the assignee start, done and release, and nobody else', async () => {
    const { state, taskId } = sosRoleTaken();
    const mine = viewOf(state, MIKA);
    const app = open(mine, asMika, 'coordination');
    fireEvent.press(screen.getByTestId(`task-start-${taskId}`));
    await waitFor(() => expect(app.actions.startTask).toHaveBeenCalledWith(mine.id, taskId));
    expect(screen.getByTestId(`task-done-${taskId}`)).toBeTruthy();
    expect(screen.getByTestId(`task-release-${taskId}`)).toBeTruthy();
    expect(screen.queryByTestId(`task-accept-${taskId}`)).toBeNull();
    expect(screen.getByTestId('resolve')).toBeTruthy();
  });

  it('does not offer the reporter the responder buttons, and asks before resolving or cancelling', async () => {
    const { state, taskId } = sosInProgress();
    const view = viewOf(state);
    const app = open(view, undefined, 'coordination');

    expect(screen.queryByTestId('responder-actions')).toBeNull();
    expect(screen.queryByTestId(`task-accept-${taskId}`)).toBeNull();
    expect(screen.queryByTestId(`task-done-${taskId}`)).toBeNull();
    expect(screen.queryByTestId(`task-confirm-${taskId}`)).toBeNull();
    expect(within(screen.getByTestId(`task-${taskId}`)).getByText(/arrival not confirmed/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('resolve'));
    expect(app.actions.resolveIncident).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(app.actions.resolveIncident).toHaveBeenCalledWith(view.id));
  });

  it('adds an AI task suggestion only when a person adds it, flagged as AI suggested', async () => {
    const view = viewOf(sosAcknowledged().state);
    const app = open(view, undefined, 'coordination');
    app.actions.suggestTasks.mockResolvedValueOnce({ ok: true, value: [{ kind: 'confirm_location', title: 'Confirm which entrance is open' }], meta: { source: 'callstack-apple', latencyMs: 5 } });
    expect(app.actions.suggestTasks).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('ai-tasks-run'));
    await waitFor(() => expect(screen.getByText('Confirm which entrance is open')).toBeTruthy());
    expect(app.actions.offerTask).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('ai-task-add-confirm_location'));
    await waitFor(() => expect(app.actions.offerTask).toHaveBeenCalledWith(view.id, { kind: 'confirm_location', title: 'Confirm which entrance is open', aiSuggested: true }));
  });

  it('says so when AI task suggestions are unavailable', async () => {
    open(viewOf(sosAcknowledged().state), undefined, 'coordination');
    fireEvent.press(screen.getByTestId('ai-tasks-run'));
    await waitFor(() => expect(screen.getByTestId('ai-tasks-failed')).toHaveTextContent(/Local AI unavailable/));
  });

  it('shows per-recipient delivery from receipts only, and the no-peer state', () => {
    const first = renderWithApp(<IncidentScreen incidentId={sosAcknowledged().state.incidentId} initialSegment="coordination" />, createFakePulseApp({ incidents: [viewOf(sosAcknowledged().state)] }));
    expect(screen.getByTestId(`recipient-${MIKA.deviceId}`)).toHaveTextContent(/Seen/);
    expect(screen.getByTestId(`recipient-${MIKA.deviceId}`)).toHaveTextContent(/Delivered/);
    expect(screen.getByTestId(`recipient-${NOAH.deviceId}`)).toHaveTextContent(/Not seen yet/);
    expect(screen.getByTestId(`recipient-${NOAH.deviceId}`)).toHaveTextContent(/Queued/);
    first.unmount();

    open(viewOf(sosNoPeer().state), undefined, 'coordination');
    expect(screen.getByTestId('recipients-empty')).toHaveTextContent(/Nobody has received it/);
  });

  it('offers no actions on a resolved request', () => {
    open(viewOf(sosResolved().state), undefined, 'coordination');
    expect(screen.queryByTestId('resolve')).toBeNull();
    expect(screen.queryByTestId('cancel-request')).toBeNull();
    expect(screen.queryByTestId('request-more')).toBeNull();
    expect(screen.queryByTestId('ai-tasks')).toBeNull();
  });
});

describe('timeline', () => {
  it('lists every ledger entry and explains what each later step still needs', () => {
    const view = viewOf(sosQueued().state);
    open(view, undefined, 'timeline');
    const timeline = screen.getByTestId('timeline');
    expect(within(timeline).getByText('Request saved on this device')).toBeTruthy();
    expect(within(timeline).getByText('Delivered · not yet')).toBeTruthy();
    expect(within(timeline).getByText('Needs a delivery receipt from a trusted device.')).toBeTruthy();
    expect(within(timeline).getByText('Seen · not yet')).toBeTruthy();
    expect(within(timeline).getByText('Resolved · not yet')).toBeTruthy();
  });

  it('shows one row per timeline entry and no placeholders once closed', () => {
    const view = viewOf(sosResolved().state);
    open(view, undefined, 'timeline');
    expect(view.state.timeline.length).toBeGreaterThan(5);
    expect(screen.getAllByLabelText(/, \d{1,2}:\d{2} (AM|PM)/)).toHaveLength(view.state.timeline.length);
    expect(screen.queryByText(/not yet$/)).toBeNull();
  });
});

describe('capsule', () => {
  it('previews a level with the deterministic projection and sends an update with the edited policy', async () => {
    const view = viewOf(sosAcknowledged().state);
    const app = createFakePulseApp({ incidents: [view] });
    app.actions.previewDisclosure.mockImplementation((_id, level) =>
      level === 'relay' ? [] : view.facts.map((f) => ({ ...f, protected: f.field === 'symptom' && level !== 'authorized' })),
    );
    renderWithApp(<IncidentScreen incidentId={view.id} initialSegment="capsule" />, app);

    expect(screen.getByTestId('preview-who')).toHaveTextContent('Seen by: Noah Cruz');
    expect(screen.getByTestId('preview-symptom')).toHaveTextContent(/Protected/);
    fireEvent.press(screen.getByTestId('seg-relay'));
    expect(screen.getByTestId('preview-empty')).toHaveTextContent(/cannot read any detail/);
    expect(app.actions.previewDisclosure).toHaveBeenLastCalledWith(view.id, 'relay', expect.objectContaining({ shareSymptoms: view.state.disclosure.shareSymptoms }));

    expect(screen.getByTestId(`capsule-recipient-${MIKA.deviceId}`)).toHaveTextContent(/Capsule: Not prepared/);
    fireEvent.press(screen.getByTestId(`level-${NOAH.deviceId}`));
    fireEvent.press(screen.getByTestId('toggle-location'));
    fireEvent.press(screen.getByTestId('capsule-send'));
    await waitFor(() => expect(app.actions.updateCapsule).toHaveBeenCalledTimes(1));
    expect(app.actions.updateCapsule).toHaveBeenCalledWith(view.id, {
      shareDetailedLocation: !view.state.disclosure.shareDetailedLocation,
      shareSymptoms: view.state.disclosure.shareSymptoms,
      levels: { [MIKA.deviceId]: 'authorized', [NOAH.deviceId]: 'authorized' },
    });
  });

  it('shows a non-owner only their own access', () => {
    const view = viewOf(sosAcknowledged().state, NOAH, { access: 'trusted' });
    const app = open(view, asNoah, 'capsule');
    expect(screen.getByTestId('my-access')).toHaveTextContent('Your access: Can see summary');
    expect(screen.getByTestId('preview-who')).toHaveTextContent('This is what your device can read');
    expect(screen.queryByTestId('capsule-send')).toBeNull();
    expect(app.actions.previewDisclosure).not.toHaveBeenCalled();
  });
});

describe('incident screen', () => {
  it('switches between the four sections and handles a missing incident', () => {
    const view = viewOf(sosQueued().state);
    const app = open(view);
    expect(screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel)).toEqual(['Intelligence', 'Coordination', 'Timeline', 'Capsule']);
    expect(view.state.incident?.reporter.deviceId).toBe(ME.deviceId);
    expect(screen.getByText('PULSE-7F3A')).toBeTruthy();
    fireEvent.press(screen.getByTestId('seg-timeline'));
    expect(screen.getByTestId('timeline')).toBeTruthy();

    act(() => app.setSnapshot({ incidents: [] }));
    expect(screen.getByText('Request not found')).toBeTruthy();
  });
});
