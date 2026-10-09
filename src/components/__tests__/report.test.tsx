import { mockRouter } from '../testing/mocks';

import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { IncidentProposal } from '@/ai';

import { ReportScreen } from '../report/ReportScreen';
import { capabilities, createFakePulseApp, viewOf } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { MIKA, sosQueued, sosResolved } from '../testing/scenarios';

const TEXT = 'I slipped on the stairs in Building B and need someone to walk with me.';

const PROPOSAL: IncidentProposal = {
  fields: {
    incidentType: { value: 'Slip on stairs', evidence: 'slipped on the stairs' },
    building: { value: 'Building B', evidence: 'in Building B' },
  },
  dropped: ['symptom'],
  unknown: ['floor', 'locationText', 'assistanceRequested'],
};

function setup(textState: Parameters<typeof capabilities>[0] = 'ready') {
  const view = viewOf(sosQueued().state);
  const app = createFakePulseApp({ incidents: [view], capabilities: capabilities(textState) });
  renderWithApp(<ReportScreen incidentId={view.id} />, app);
  return { app, id: view.id };
}

beforeEach(() => jest.clearAllMocks());

describe('report screen', () => {
  it('attaches the report and says so plainly when local AI is unavailable', async () => {
    const { app, id } = setup('unavailable');
    expect(screen.getByTestId('ai-basic')).toBeTruthy();
    expect(screen.getByTestId('saved-banner')).toHaveTextContent(/PULSE-7F3A is already saved on this device/);
    expect(screen.getByText('Send as text report')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('report-input'), TEXT);
    fireEvent.press(screen.getByTestId('report-submit'));

    await waitFor(() => expect(screen.getByTestId('ai-unavailable')).toBeTruthy());
    expect(screen.getByTestId('ai-unavailable')).toHaveTextContent('Local AI unavailable — sending original report.');
    expect(screen.getByTestId('ai-unavailable-reason')).toHaveTextContent('Unavailable');
    expect(app.actions.addReport).toHaveBeenCalledTimes(1);
    expect(app.actions.addReport).toHaveBeenCalledWith(id, TEXT, 'typed');
    // The report was stored before the model was asked, and nothing was invented afterwards.
    expect(app.actions.addReport.mock.invocationCallOrder[0]).toBeLessThan(app.actions.analyzeReport.mock.invocationCallOrder[0] ?? 0);
    expect(app.actions.attachProposal).not.toHaveBeenCalled();
    expect(app.actions.confirmFact).not.toHaveBeenCalled();
    expect(screen.getByText(`“${TEXT}”`)).toBeTruthy();

    fireEvent.press(screen.getByTestId('view-incident'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith(`/incident/${id}`);
  });

  it('shows the typed failure state, for example an unsupported locale', async () => {
    const { app } = setup();
    app.actions.analyzeReport.mockResolvedValueOnce({ ok: false, state: 'unsupported_locale', message: 'x', meta: { source: 'callstack-apple', latencyMs: 3 } });
    fireEvent.changeText(screen.getByTestId('report-input'), TEXT);
    fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => expect(screen.getByTestId('ai-unavailable-reason')).toHaveTextContent('Unsupported locale'));
    expect(app.actions.addReport).toHaveBeenCalledTimes(1);
  });

  it('runs four real steps, records the proposal as soon as the analysis succeeds, and shows it with evidence', async () => {
    const { app, id } = setup();
    app.actions.analyzeReport.mockResolvedValueOnce({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 412 } });
    fireEvent.changeText(screen.getByTestId('report-input'), TEXT);
    fireEvent.press(screen.getByTestId('report-submit'));

    // The design's processing ring: a percentage of awaited steps, not a timer.
    expect(screen.getByText('Understanding locally')).toBeTruthy();
    expect(screen.getByTestId('processing-percent')).toHaveTextContent(/^\d+%$/);
    expect(screen.getByLabelText(/^Saving your report on this device: (in progress|done)$/)).toBeTruthy();

    await waitFor(() => expect(screen.getByText('Incident understood')).toBeTruthy());
    expect(screen.getByText('Analysis complete')).toBeTruthy();
    expect(screen.getByTestId('ai-warning')).toHaveTextContent(/AI interpretation may be inaccurate/);
    expect(screen.getByTestId('result-meta')).toHaveTextContent(/Ran on this device in 412 ms/);
    expect(screen.getByTestId('proposal-incidentType')).toHaveTextContent('Slip on stairs');
    expect(screen.getByTestId('proposal-building')).toHaveTextContent(/Building B · floor unknown/);
    expect(screen.getByTestId('proposal-floor')).toHaveTextContent(/Unknown/);
    expect(screen.getByTestId('proposal-floor')).toHaveTextContent(/unknown/);
    expect(screen.queryByText(/severity/i)).toBeNull();

    // Recorded once, as a proposal: attached before anything is confirmed, and nothing is confirmed yet.
    expect(app.actions.addReport.mock.invocationCallOrder[0]).toBeLessThan(app.actions.analyzeReport.mock.invocationCallOrder[0] ?? 0);
    expect(app.actions.attachProposal).toHaveBeenCalledTimes(1);
    expect(app.actions.attachProposal).toHaveBeenCalledWith(id, 'rpt-test-0001', PROPOSAL);
    expect(app.actions.confirmFact).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('toggle-evidence'));
    expect(screen.getByText(`How SAGIP understood this`)).toBeTruthy();
    expect(screen.getByTestId('evidence-building')).toHaveTextContent(/Building B/);
    expect(screen.getByTestId('evidence-building')).toHaveTextContent(/“in Building B”/);
    expect(screen.getByTestId('evidence-building')).toHaveTextContent(/AI proposed/);
    expect(screen.getByTestId('evidence-floor')).toHaveTextContent(/Not mentioned in the report/);
    expect(screen.getByTestId('evidence-dropped')).toHaveTextContent(/what was described/);

    fireEvent.press(screen.getByTestId('confirm-all'));
    await waitFor(() => expect(app.actions.confirmFact).toHaveBeenCalledWith(id, 'building', 'Building B'));
    await waitFor(() => expect(app.actions.confirmFact).toHaveBeenCalledWith(id, 'incidentType', 'Slip on stairs'));
    expect(app.actions.confirmFact).toHaveBeenCalledTimes(2);
    expect(app.actions.attachProposal).toHaveBeenCalledTimes(1);
    expect(app.actions.attachProposal.mock.invocationCallOrder[0]).toBeLessThan(app.actions.confirmFact.mock.invocationCallOrder[0] ?? 0);
    await waitFor(() => expect(screen.getByTestId('evidence-building')).toHaveTextContent(/user confirmed/));
    expect(screen.getByTestId('confirmed-banner')).toBeTruthy();

    fireEvent.press(screen.getByTestId('view-incident'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith(`/incident/${id}`);
  });

  it('still records the proposal when the screen is left before that finished', async () => {
    const { app, id } = setup();
    app.actions.analyzeReport.mockResolvedValueOnce({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 1 } });
    // The first attempt fails; the person then swipes back.
    app.actions.attachProposal.mockResolvedValueOnce({ ok: false, code: 'storage', message: '' });
    fireEvent.changeText(screen.getByTestId('report-input'), TEXT);
    fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => expect(screen.getByText('Incident understood')).toBeTruthy());
    expect(app.actions.attachProposal).toHaveBeenCalledTimes(1);

    screen.unmount();
    expect(app.actions.attachProposal).toHaveBeenCalledTimes(2);
    expect(app.actions.attachProposal).toHaveBeenLastCalledWith(id, 'rpt-test-0001', PROPOSAL);
  });

  it('does not record the proposal twice when leaving after it was recorded', async () => {
    const { app } = setup();
    app.actions.analyzeReport.mockResolvedValueOnce({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 1 } });
    fireEvent.changeText(screen.getByTestId('report-input'), TEXT);
    fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => expect(screen.getByText('Incident understood')).toBeTruthy());
    screen.unmount();
    expect(app.actions.attachProposal).toHaveBeenCalledTimes(1);
  });

  it('confirms the edited value, not the model value, and sends later edits as updates', async () => {
    const { app, id } = setup();
    app.actions.analyzeReport.mockResolvedValueOnce({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 1 } });
    fireEvent.changeText(screen.getByTestId('report-input'), TEXT);
    fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => expect(screen.getByTestId('edit-toggle')).toBeTruthy());

    fireEvent.press(screen.getByTestId('edit-toggle'));
    expect(screen.queryByLabelText(/severity/i)).toBeNull();
    fireEvent.changeText(screen.getByTestId('edit-building'), 'Building C');
    fireEvent.press(screen.getByTestId('confirm-all'));
    await waitFor(() => expect(app.actions.confirmFact).toHaveBeenCalledWith(id, 'building', 'Building C'));
    expect(app.actions.confirmFact).not.toHaveBeenCalledWith(id, 'building', 'Building B');

    await waitFor(() => expect(screen.getByTestId('send-updated')).toBeDisabled());
    fireEvent.press(screen.getByTestId('edit-toggle'));
    fireEvent.changeText(screen.getByTestId('edit-floor'), 'Second floor');
    fireEvent.press(screen.getByTestId('send-updated'));
    await waitFor(() => expect(app.actions.confirmFact).toHaveBeenCalledWith(id, 'floor', 'Second floor'));
    expect(app.actions.confirmFact).toHaveBeenCalledTimes(3);
  });

  it('offers one optional clarification that can be typed, picked or skipped', async () => {
    const { app, id } = setup();
    app.actions.analyzeReport.mockResolvedValueOnce({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 1 } });
    app.actions.suggestClarification.mockResolvedValueOnce({ ok: true, value: { field: 'floor', question: 'Which floor are you on?' }, meta: { source: 'callstack-apple', latencyMs: 1 } });
    fireEvent.changeText(screen.getByTestId('report-input'), TEXT);
    fireEvent.press(screen.getByTestId('report-submit'));

    await waitFor(() => expect(screen.getByTestId('clarification-card')).toHaveTextContent(/Which floor are you on\?/));
    expect(screen.getByText('One more detail could help.')).toBeTruthy();
    expect(screen.getByText('Your SOS is already saved. Answering is optional.')).toBeTruthy();
    expect(screen.queryByTestId('clarification-answer')).toBeNull();
    fireEvent.press(screen.getByTestId('clarification-type'));
    fireEvent.changeText(screen.getByTestId('clarification-answer'), 'Fourth floor');
    fireEvent.press(screen.getByTestId('clarification-submit'));
    await waitFor(() => expect(app.actions.answerClarification).toHaveBeenCalledWith(id, 'floor', 'Fourth floor'));
    await waitFor(() => expect(screen.queryByTestId('clarification-card')).toBeNull());
    expect(screen.getByTestId('clarification-note')).toHaveTextContent('Floor confirmed by you.');
    expect(screen.getByTestId('proposal-building')).toHaveTextContent(/Building B · Fourth floor/);
  });

  it('keeps a skipped clarification as unknown', async () => {
    const { app, id } = setup();
    app.actions.analyzeReport.mockResolvedValueOnce({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 1 } });
    app.actions.suggestClarification.mockResolvedValueOnce({ ok: true, value: { field: 'floor', question: 'Which floor are you on?' }, meta: { source: 'callstack-apple', latencyMs: 1 } });
    fireEvent.changeText(screen.getByTestId('report-input'), TEXT);
    fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => expect(screen.getByTestId('clarification-skip')).toBeTruthy());
    fireEvent.press(screen.getByTestId('clarification-skip'));
    await waitFor(() => expect(app.actions.skipClarification).toHaveBeenCalledWith(id, 'floor'));
    await waitFor(() => expect(screen.getByTestId('clarification-note')).toHaveTextContent('Floor kept as unknown. You can add it later.'));
    expect(app.actions.answerClarification).not.toHaveBeenCalled();
  });

  it('keeps the request safe and says so when the report itself cannot be stored', async () => {
    const { app } = setup();
    app.actions.addReport.mockResolvedValueOnce({ ok: false, code: 'storage', message: '' });
    fireEvent.changeText(screen.getByTestId('report-input'), TEXT);
    fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => expect(screen.getByTestId('report-not-saved')).toBeTruthy());
    expect(app.actions.analyzeReport).not.toHaveBeenCalled();
  });

  it('does not touch the microphone or transcription until record is tapped', () => {
    const { app } = setup();
    expect(screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel)).toEqual(['Voice report', 'Type']);
    fireEvent.press(screen.getByTestId('seg-voice'));
    expect(screen.getByText('Tap to record a voice report')).toBeTruthy();
    expect(screen.getByText(/Voice is best-effort/)).toBeTruthy();
    expect(screen.getByLabelText('Record')).toBeTruthy();
    expect(app.actions.transcribe).not.toHaveBeenCalled();
  });

  it('labels simulation only in Demo: sample report, simulated badge, never in Live', () => {
    const live = setup();
    expect(screen.queryByTestId('use-sample')).toBeNull();
    expect(screen.getByTestId('ai-badge')).toHaveTextContent('Callstack Apple — iPhone 16 Pro');
    expect(screen.queryByText(/simulated/i)).toBeNull();
    expect(live.app.actions.addReport).not.toHaveBeenCalled();
    screen.unmount();

    const view = viewOf(sosQueued().state);
    renderWithApp(<ReportScreen incidentId={view.id} />, createFakePulseApp({ mode: 'demo', incidents: [view], capabilities: capabilities('ready', 'simulated') }));
    expect(screen.getByTestId('ai-badge')).toHaveTextContent('Simulated Local AI — iPhone 16 Pro');
    fireEvent.press(screen.getByTestId('use-sample'));
    expect(screen.getByTestId('report-input')).toHaveProp('value', expect.stringContaining('Building B'));
  });

  it('refuses a report from a responder or on a closed request', () => {
    const responder = viewOf(sosQueued().state, MIKA);
    const app = createFakePulseApp({ me: { deviceId: MIKA.deviceId, name: MIKA.userName, onboarded: true, hardwareBackedKeys: true }, incidents: [responder] });
    const first = renderWithApp(<ReportScreen incidentId={responder.id} />, app);
    expect(screen.getByText('Report unavailable')).toBeTruthy();
    expect(screen.queryByTestId('report-input')).toBeNull();
    first.unmount();

    const closed = viewOf(sosResolved().state);
    renderWithApp(<ReportScreen incidentId={closed.id} />, createFakePulseApp({ incidents: [closed] }));
    expect(screen.getByText(/This request is closed/)).toBeTruthy();
  });
});
