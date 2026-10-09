import { mockRouter } from '../testing/mocks';

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { requestClarification, resolveConflict } from '@/domain';
import type { IncidentView, PulseSnapshot } from '@/services/api';
import { useToast } from '@/ui';

import { IncidentScreen } from '../incident/IncidentScreen';
import { createFakePulseApp, DEFAULT_SETTINGS, viewOf, type FakePulseApp } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { ALEX, MIKA, sosAcknowledged, sosFloorConflict, sosInProgress, sosQueued } from '../testing/scenarios';

type Segment = 'intelligence' | 'coordination' | 'timeline' | 'capsule';
const asMika = { deviceId: MIKA.deviceId, name: MIKA.userName, onboarded: true, hardwareBackedKeys: true };

function open(view: IncidentView, segment: Segment, patch: Partial<PulseSnapshot> = {}): FakePulseApp {
  const app = createFakePulseApp({ incidents: [view], ...patch });
  renderWithApp(<IncidentScreen incidentId={view.id} initialSegment={segment} />, app);
  return app;
}

/** A reporter's request with one open AI question about the floor. */
function withFloorQuestion() {
  const { world, state } = sosAcknowledged();
  return requestClarification(state, world.as(ALEX), { field: 'floor', prompt: 'Which floor are you on?', origin: 'ai' }).state;
}

function layoutMap(id: string) {
  fireEvent(screen.getByTestId(`map-${id}`), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 340, height: 180 } } });
}

beforeEach(() => {
  jest.clearAllMocks();
  act(() => useToast.setState({ toast: null }));
});

describe('segments hold the design’s sections', () => {
  it('Intelligence: conflict card, Details, How SAGIP understood this, Add observation, Incident details', () => {
    open(viewOf(sosFloorConflict().state), 'intelligence');
    expect(screen.getByTestId('status-card')).toBeTruthy();
    expect(screen.getByTestId('conflict-floor')).toHaveTextContent(/Two different floors reported/);
    expect(screen.getByText('Details')).toBeTruthy();
    expect(screen.getByTestId('facts-card')).toBeTruthy();
    expect(screen.getByText('How SAGIP understood this')).toBeTruthy();
    expect(screen.getByTestId('add-observation')).toBeTruthy();
    expect(screen.getByTestId('open-details')).toBeTruthy();
    expect(screen.queryByText(/PULSE understood/)).toBeNull();
    // Nothing from the other three segments.
    for (const id of ['tasks-card', 'resolve', 'contact', 'cancel-request', 'timeline', 'open-relay', 'capsule-card', 'preview-who']) expect(screen.queryByTestId(id)).toBeNull();
  });

  it('Intelligence: the clarification card', () => {
    open(viewOf(withFloorQuestion()), 'intelligence');
    expect(screen.getByTestId('clarification-card')).toHaveTextContent(/Suggested by AI · Missing context/);
    expect(screen.getByTestId('clarification-card')).toHaveTextContent(/One more detail could help\./);
    expect(screen.getByTestId('clarification-card')).toHaveTextContent(/Which floor are you on\?/);
  });

  it('Intelligence: a resolved conflict leaves the note and no conflict card', () => {
    const { world, state } = sosFloorConflict();
    const conflictId = state.contradictions[0]?.id ?? '';
    const resolved = resolveConflict(state, world.as(ALEX), { conflictId, value: 'Fourth floor' }).state;
    open(viewOf(resolved), 'intelligence');
    expect(screen.queryByTestId('conflict-floor')).toBeNull();
    expect(screen.getByTestId('resolved-note')).toHaveTextContent('Floor confirmed by you: Fourth floor. The other statement is kept in the history.');
  });

  it('Coordination: Who’s helping, Confirm resolution, Contact, Cancel request', () => {
    open(viewOf(sosInProgress().state), 'coordination');
    expect(screen.getByText('Who’s helping')).toBeTruthy();
    expect(screen.getByTestId('tasks-card')).toBeTruthy();
    expect(screen.getByTestId('resolve')).toHaveTextContent('Confirm resolution');
    expect(screen.getByTestId('contact')).toHaveTextContent('Contact Mika');
    expect(screen.getByTestId('cancel-request')).toHaveTextContent('Cancel request');
    for (const id of ['facts-card', 'more-card', 'timeline', 'open-relay', 'capsule-card']) expect(screen.queryByTestId(id)).toBeNull();
  });

  it('Timeline: all updates and Relay history; the technical log only when the setting is on', () => {
    const view = viewOf(sosFloorConflict().state);
    const app = open(view, 'timeline');
    expect(screen.getByText('Updates')).toBeTruthy();
    expect(within(screen.getByTestId('timeline')).getAllByLabelText(/, \d{1,2}:\d{2} (AM|PM)/)).toHaveLength(view.state.timeline.length);
    expect(screen.getByTestId('open-relay')).toHaveTextContent('Relay history');
    expect(screen.queryByTestId('tech-log')).toBeNull();
    for (const id of ['facts-card', 'tasks-card', 'resolve', 'capsule-card']) expect(screen.queryByTestId(id)).toBeNull();

    act(() => app.setSnapshot({ settings: { ...DEFAULT_SETTINGS, showTechnicalDetails: true } }));
    const log = screen.getByTestId('tech-log');
    expect(log).toHaveTextContent(/TECHNICAL DETAILS/);
    expect(log).not.toHaveTextContent(/SIMULATED/);
    expect(screen.queryByTestId('tech-log-lines')).toBeNull();
    fireEvent.press(screen.getByTestId('tech-log-toggle'));
    const lines = screen.getByTestId('tech-log-lines');
    expect(lines).toHaveTextContent(/#01 .* INCIDENT_CREATED src="dev-alex"/);
    expect(lines).toHaveTextContent(new RegExp(`pkt\\.count=${view.state.packets.length} queue=0 events=${view.state.ledger.eventCount}`));
    // Event types and ids only: no words from any report.
    expect(lines).not.toHaveTextContent(/stairs|floor|Building/i);

    act(() => app.setSnapshot({ mode: 'demo' }));
    expect(screen.getByTestId('tech-log')).toHaveTextContent(/DEMO · SIMULATED/);
  });

  it('Capsule: the Privacy page content', () => {
    open(viewOf(sosAcknowledged().state), 'capsule');
    expect(screen.getByText('Privacy')).toBeTruthy();
    expect(screen.getByText('Share what’s needed. Protect what isn’t.')).toBeTruthy();
    expect(screen.getByTestId('capsule-card')).toHaveTextContent(/Rescue Capsule/);
    expect(screen.getByTestId('capsule-card')).not.toHaveTextContent(/simulated/i);
    expect(screen.getByTestId('capsule-state')).toHaveTextContent('Not prepared');
    expect(screen.getByText('Recipients')).toBeTruthy();
    expect(screen.getByTestId('capsule-send')).toHaveTextContent('Confirm capsule preparation');
    expect(screen.queryByText('Back to incident')).toBeNull();
    for (const id of ['facts-card', 'tasks-card', 'timeline']) expect(screen.queryByTestId(id)).toBeNull();
  });

  it('Capsule: says encryption is simulated only in Demo', () => {
    open(viewOf(sosAcknowledged().state), 'capsule', { mode: 'demo' });
    expect(screen.getByTestId('capsule-card')).toHaveTextContent(/Encryption simulated · receipts confirm delivery/);
  });
});

describe('facts', () => {
  it('are read from view.facts, not from state.claims', () => {
    const base = viewOf(sosQueued().state);
    expect(base.state.claims.building.value).toBeNull();
    const view: IncidentView = { ...base, facts: base.facts.map((f) => (f.field === 'building' ? { ...f, value: 'Annex 9', tag: 'user_confirmed' as const, by: 'You' } : f)) };
    open(view, 'intelligence');
    expect(screen.getByTestId('fact-building')).toHaveTextContent(/Annex 9/);
    expect(within(screen.getByTestId('fact-building')).getByText('user confirmed')).toBeTruthy();
    expect(screen.getByTestId('map-label')).toHaveTextContent('Annex 9');
    fireEvent.press(screen.getByTestId('open-details'));
    expect(screen.getByTestId('details-building')).toHaveTextContent(/Annex 9/);
  });

  it('hides protected facts behind a count instead of listing them', () => {
    const base = viewOf(sosFloorConflict().state, MIKA, { access: 'trusted' });
    const view: IncidentView = { ...base, originalReport: null, facts: base.facts.map((f) => (f.field === 'symptom' || f.field === 'floor' ? { ...f, value: null, protected: true } : f)) };
    open(view, 'intelligence', { me: asMika });
    expect(screen.queryByTestId('fact-symptom')).toBeNull();
    expect(screen.queryByTestId('fact-floor')).toBeNull();
    expect(screen.getByTestId('fact-building')).toBeTruthy();
    expect(screen.getByTestId('facts-protected-note')).toHaveTextContent('2 fields not shared with this device at your access level');
    fireEvent.press(screen.getByTestId('toggle-evidence'));
    expect(screen.getByTestId('original-report')).toHaveTextContent('Not readable on this device.');
    expect(screen.queryByText(/3rd floor of Building B/)).toBeNull();
  });

  it.each(['intelligence', 'coordination', 'timeline', 'capsule'] as const)('never show a severity row (%s)', (segment) => {
    open(viewOf(sosFloorConflict().state), segment);
    expect(screen.queryByText(/severity/i)).toBeNull();
    expect(screen.queryByText(/diagnos/i)).toBeNull();
  });
});

describe('map card inside the status card', () => {
  const withBuilding = (view: IncidentView): IncidentView => ({ ...view, facts: view.facts.map((f) => (f.field === 'building' ? { ...f, value: 'Building B', tag: 'user_reported' as const } : f)) });

  it('Live: same card under the veil, no pins, the reported words on the chip', () => {
    const view = withBuilding(viewOf(sosAcknowledged().state));
    open(view, 'intelligence');
    layoutMap(view.id);
    expect(within(screen.getByTestId('status-card')).getByTestId('map-veil')).toBeTruthy();
    expect(screen.getByTestId('map-label')).toHaveTextContent('Building B');
    expect(screen.queryByTestId('map-pin-request')).toBeNull();
    expect(screen.queryByTestId(`map-pin-${MIKA.deviceId}`)).toBeNull();
  });

  it('Demo: pins as designed and no veil', () => {
    const view = withBuilding(viewOf(sosAcknowledged().state));
    open(view, 'intelligence', { mode: 'demo' });
    layoutMap(view.id);
    expect(screen.queryByTestId('map-veil')).toBeNull();
    expect(screen.getByTestId('map-pin-request')).toBeTruthy();
    // Only a recipient with a delivery receipt gets a pin.
    expect(screen.getByTestId(`map-pin-${MIKA.deviceId}`)).toBeTruthy();
    expect(screen.getByTestId('map-label')).toHaveTextContent('Building B');
  });
});

describe('clarification card', () => {
  it('answers with a quick floor chip', async () => {
    const view = viewOf(withFloorQuestion());
    const app = open(view, 'intelligence');
    fireEvent.press(screen.getByTestId('clarification-quick-Second floor'));
    await waitFor(() => expect(app.actions.answerClarification).toHaveBeenCalledWith(view.id, 'floor', 'Second floor'));
  });

  it('reveals the input only after "Type answer", then adds the typed answer', async () => {
    const view = viewOf(withFloorQuestion());
    const app = open(view, 'intelligence');
    expect(screen.queryByTestId('clarification-answer')).toBeNull();
    fireEvent.press(screen.getByTestId('clarification-type'));
    fireEvent.changeText(screen.getByTestId('clarification-answer'), ' Fourth floor ');
    fireEvent.press(screen.getByTestId('clarification-submit'));
    await waitFor(() => expect(app.actions.answerClarification).toHaveBeenCalledWith(view.id, 'floor', 'Fourth floor'));
  });

  it('skips, and says the SOS is saved rather than sent', async () => {
    const view = viewOf(withFloorQuestion());
    const app = open(view, 'intelligence');
    expect(screen.getByText('Your SOS is already saved. Answering is optional.')).toBeTruthy();
    expect(screen.queryByText(/already been sent/)).toBeNull();
    fireEvent.press(screen.getByTestId('clarification-skip'));
    await waitFor(() => expect(app.actions.skipClarification).toHaveBeenCalledWith(view.id, 'floor'));
  });

  it('gives a responder no way to answer', () => {
    open(viewOf(withFloorQuestion(), MIKA), 'intelligence', { me: asMika });
    expect(screen.getByTestId('clarification-card')).toHaveTextContent(/Waiting for the requester/);
    expect(screen.queryByTestId('clarification-type')).toBeNull();
    expect(screen.queryByTestId('clarification-skip')).toBeNull();
  });
});

describe('observation', () => {
  it('is typed inline under the row and submitted as the person’s own statement', async () => {
    const view = viewOf(sosAcknowledged().state, MIKA);
    const app = open(view, 'intelligence', { me: asMika });
    expect(screen.queryByTestId('observation-input')).toBeNull();
    fireEvent.press(screen.getByTestId('add-observation'));
    // The design's canned "Use example" is a Demo-only convenience.
    expect(screen.queryByTestId('observation-example')).toBeNull();
    fireEvent.press(screen.getByTestId('observation-submit'));
    expect(app.actions.addObservation).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('observation-input'), ' She is by the east stairs. ');
    fireEvent.press(screen.getByTestId('observation-submit'));
    await waitFor(() => expect(app.actions.addObservation).toHaveBeenCalledWith(view.id, 'She is by the east stairs.'));
    await waitFor(() => expect(screen.queryByTestId('observation-input')).toBeNull());
  });

  it('offers the example only in Demo', () => {
    open(viewOf(sosAcknowledged().state, MIKA), 'intelligence', { me: asMika, mode: 'demo' });
    fireEvent.press(screen.getByTestId('add-observation'));
    expect(screen.getByTestId('observation-example')).toBeTruthy();
  });

  it('lets the requester open the report screen while no report exists', () => {
    const view = viewOf(sosQueued().state);
    open(view, 'intelligence');
    fireEvent.press(screen.getByTestId('describe'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/incident/${view.id}/report`);
  });
});

describe('sheets', () => {
  it('Details: id and time, original report, structured record from the facts, source, AI and reporter', () => {
    const view = viewOf(sosFloorConflict().state);
    open(view, 'intelligence');
    expect(screen.queryByTestId('details-sheet')).toBeNull();
    fireEvent.press(screen.getByTestId('open-details'));
    const sheet = screen.getByTestId('details-sheet');
    expect(within(sheet).getByText(/^PULSE-7F3A · /)).toBeTruthy();
    expect(screen.getByTestId('details-report')).toHaveTextContent(/3rd floor of Building B/);
    expect(within(sheet).getByText('Structured record')).toBeTruthy();
    expect(screen.getByTestId('details-building')).toHaveTextContent(/Building B/);
    expect(screen.getByTestId('details-symptom')).toHaveTextContent(/Unknown/);
    expect(screen.getByTestId('details-source')).toHaveTextContent(/Manual SOS/);
    expect(screen.getByTestId('details-ai')).toHaveTextContent(/Not used/);
    expect(screen.getByTestId('details-reporter')).toHaveTextContent(/Alex Rivera/);
    expect(within(sheet).queryByText(/severity/i)).toBeNull();
    fireEvent.press(screen.getByTestId('details-done'));
    expect(screen.queryByTestId('details-sheet')).toBeNull();
  });

  it('Relay: the chain, per-recipient receipts, hops, and a retry only while something is waiting', () => {
    const view = viewOf(sosAcknowledged().state, undefined, { pendingOutbox: 1 });
    const app = open(view, 'timeline');
    fireEvent.press(screen.getByTestId('open-relay'));
    const sheet = screen.getByTestId('relay-sheet');
    expect(within(sheet).getByText('Relay path')).toBeTruthy();
    expect(within(sheet).getByText('PULSE-7F3A · Store-and-forward over nearby devices')).toBeTruthy();
    expect(within(sheet).getByText('Delivery receipt received')).toBeTruthy();
    expect(within(sheet).getByText('Request saved on this device')).toBeTruthy();
    fireEvent.press(screen.getByTestId('retry-delivery'));
    expect(app.actions.retryDelivery).toHaveBeenCalledWith(view.id);
    fireEvent.press(screen.getByTestId('relay-done'));
    expect(screen.queryByTestId('relay-sheet')).toBeNull();
  });

  it('Relay: no retry button when nothing is waiting', () => {
    open(viewOf(sosAcknowledged().state), 'timeline');
    fireEvent.press(screen.getByTestId('open-relay'));
    expect(screen.queryByTestId('retry-delivery')).toBeNull();
  });

  it('says an update is too large to send, without calling it waiting, queued or retryable', () => {
    const view = viewOf(sosAcknowledged().state, undefined, { pendingOutbox: 1, sendFailure: 'packet_too_large' });
    const app = open(view, 'timeline');
    const card = screen.getByTestId('status-card');
    expect(screen.getByTestId('send-too-large')).toHaveTextContent('The latest update is too large to send. It has not gone out and is still on this device. Trying again will not send it.');
    // The ledger status is untouched; only the waiting line gives way to the notice.
    expect(screen.getByTestId('status-title')).toHaveTextContent('Seen by Mika');
    expect(within(card).queryByText(/waiting on this device to be delivered/)).toBeNull();
    expect(within(card).queryByText(/queued|sent\b|delivered\./i)).toBeNull();

    fireEvent.press(screen.getByTestId('open-relay'));
    expect(screen.queryByTestId('retry-delivery')).toBeNull();
    expect(screen.getByTestId('relay-too-large')).toHaveTextContent(/too large to send/);
    expect(app.actions.retryDelivery).not.toHaveBeenCalled();
  });

  it('shows no size notice when nothing is blocked', () => {
    open(viewOf(sosAcknowledged().state, undefined, { pendingOutbox: 1, sendFailure: null }), 'timeline');
    expect(screen.queryByTestId('send-too-large')).toBeNull();
    expect(screen.getByTestId('status-card')).toHaveTextContent(/1 update is waiting on this device to be delivered/);
    fireEvent.press(screen.getByTestId('open-relay'));
    expect(screen.getByTestId('retry-delivery')).toBeTruthy();
    expect(screen.queryByTestId('relay-too-large')).toBeNull();
  });
});

describe('contact', () => {
  it('Live: says SAGIP has no number and places no call', () => {
    open(viewOf(sosInProgress().state), 'coordination');
    fireEvent.press(screen.getByTestId('contact'));
    expect(screen.getByTestId('toast')).toHaveTextContent('SAGIP has no number for Mika. Use your phone to reach them.');
  });

  it('Demo: says it is simulated', () => {
    open(viewOf(sosInProgress().state), 'coordination', { mode: 'demo' });
    fireEvent.press(screen.getByTestId('contact'));
    expect(screen.getByTestId('toast')).toHaveTextContent('Simulated, no call placed');
  });

  it('a responder contacts the requester; before anyone holds a role the requester’s label is generic', () => {
    const first = renderWithApp(<IncidentScreen incidentId={sosAcknowledged().state.incidentId} initialSegment="coordination" />, createFakePulseApp({ incidents: [viewOf(sosAcknowledged().state, MIKA)], me: asMika }));
    expect(screen.getByTestId('contact')).toHaveTextContent('Contact Alex');
    first.unmount();
    open(viewOf(sosAcknowledged().state), 'coordination');
    expect(screen.getByTestId('contact')).toHaveTextContent('Contact trusted responder');
  });

  it('asks before "Can’t help"', async () => {
    const view = viewOf(sosAcknowledged().state, MIKA);
    const app = open(view, 'coordination', { me: asMika });
    fireEvent.press(screen.getByTestId('cant-help'));
    expect(app.actions.declineRequest).not.toHaveBeenCalled();
    expect(screen.getByText('Can’t help right now?')).toBeTruthy();
    fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(app.actions.declineRequest).toHaveBeenCalledWith(view.id));
  });
});
