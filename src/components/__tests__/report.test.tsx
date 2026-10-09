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
    expect(screen.getByTestId('saved-banner')).toHaveTextContent(/already saved on this device/);

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

  it('shows each proposed field with its evidence and an "AI proposed" chip, then attaches and confirms on request', async () => {
    const { app, id } = setup();
    app.actions.analyzeReport.mockResolvedValueOnce({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 412 } });
    fireEvent.changeText(screen.getByTestId('report-input'), TEXT);
    fireEvent.press(screen.getByTestId('report-submit'));

    await waitFor(() => expect(screen.getByTestId('proposal-building')).toBeTruthy());
    expect(screen.getByTestId('ai-warning')).toHaveTextContent(/AI interpretation may be inaccurate/);
    expect(screen.getByTestId('proposal-building')).toHaveTextContent(/Building B/);
    expect(screen.getByTestId('proposal-building')).toHaveTextContent(/“in Building B”/);
    expect(screen.getByTestId('proposal-building')).toHaveTextContent(/AI proposed/);
    expect(screen.getByText(/Ran on this device in 412 ms/)).toBeTruthy();
    // Nothing is written to the ledger until a person confirms.
    expect(app.actions.attachProposal).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('confirm-building'));
    await waitFor(() => expect(app.actions.confirmFact).toHaveBeenCalledWith(id, 'building', 'Building B'));
    expect(app.actions.attachProposal).toHaveBeenCalledWith(id, 'rpt-test-0001', PROPOSAL);
    expect(app.actions.attachProposal.mock.invocationCallOrder[0]).toBeLessThan(app.actions.confirmFact.mock.invocationCallOrder[0] ?? 0);
    await waitFor(() => expect(screen.getByTestId('proposal-building')).toHaveTextContent(/user confirmed/));

    fireEvent.press(screen.getByTestId('confirm-all'));
    await waitFor(() => expect(app.actions.confirmFact).toHaveBeenCalledWith(id, 'incidentType', 'Slip on stairs'));
    expect(app.actions.attachProposal).toHaveBeenCalledTimes(1);
    expect(app.actions.confirmFact).toHaveBeenCalledTimes(2);
  });

  it('confirms the edited value, not the model value', async () => {
    const { app, id } = setup();
    app.actions.analyzeReport.mockResolvedValueOnce({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 1 } });
    fireEvent.changeText(screen.getByTestId('report-input'), TEXT);
    fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => expect(screen.getByTestId('edit-toggle')).toBeTruthy());

    fireEvent.press(screen.getByTestId('edit-toggle'));
    fireEvent.changeText(screen.getByTestId('edit-building'), 'Building C');
    fireEvent.press(screen.getByTestId('confirm-building'));
    await waitFor(() => expect(app.actions.confirmFact).toHaveBeenCalledWith(id, 'building', 'Building C'));
  });

  it('offers one optional clarification that can be answered or skipped', async () => {
    const { app, id } = setup();
    app.actions.analyzeReport.mockResolvedValueOnce({ ok: true, value: PROPOSAL, meta: { source: 'callstack-apple', latencyMs: 1 } });
    app.actions.suggestClarification.mockResolvedValueOnce({ ok: true, value: { field: 'floor', question: 'Which floor are you on?' }, meta: { source: 'callstack-apple', latencyMs: 1 } });
    fireEvent.changeText(screen.getByTestId('report-input'), TEXT);
    fireEvent.press(screen.getByTestId('report-submit'));

    await waitFor(() => expect(screen.getByTestId('clarification-card')).toHaveTextContent(/Which floor are you on\?/));
    fireEvent.changeText(screen.getByTestId('clarification-answer'), 'Fourth floor');
    fireEvent.press(screen.getByTestId('clarification-submit'));
    await waitFor(() => expect(app.actions.answerClarification).toHaveBeenCalledWith(id, 'floor', 'Fourth floor'));
    await waitFor(() => expect(screen.queryByTestId('clarification-card')).toBeNull());
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
    fireEvent.press(screen.getByTestId('seg-voice'));
    expect(screen.getByText(/Voice is best-effort/)).toBeTruthy();
    expect(screen.getByLabelText('Record')).toBeTruthy();
    expect(app.actions.transcribe).not.toHaveBeenCalled();
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
