import { mockRouter } from '../testing/mocks';

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { ActivityScreen } from '../activity/ActivityScreen';
import { useAppMode } from '../appMode';
import { useSafetySession } from '../demo/safetySession';
import { DemoLabScreen } from '../settings/DemoLabScreen';
import { LocalAIDiagnosticsScreen } from '../settings/LocalAIDiagnosticsScreen';
import { SettingsScreen } from '../settings/SettingsScreen';
import { capabilities, createFakePulseApp, DEFAULT_SETTINGS, peer, viewOf } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { MIKA, sosCancelled, sosFloorConflict, sosQueued, sosResolved, sosRoleTaken } from '../testing/scenarios';

const demoState = {
  viewingAs: 'alex' as const,
  aiReady: true,
  links: { mika: true, noah: false },
  runningScenario: null,
  scenarios: ['normal', 'intelligence', 'multi', 'privacy', 'recovery', 'complete'].map((key, i) => ({ key, title: i === 5 ? 'Complete PULSE Experience' : `Scenario ${i + 1}`, description: 'Simulated' })),
};

beforeEach(() => {
  jest.clearAllMocks();
  act(() => {
    useAppMode.setState({ mode: 'live' });
    useSafetySession.getState().reset();
  });
});

describe('activity', () => {
  it('shows the empty state with no incidents', () => {
    renderWithApp(<ActivityScreen />, createFakePulseApp());
    expect(screen.getByTestId('activity-empty')).toHaveTextContent(/No incidents found/);
    expect(screen.getByTestId('activity-empty')).toHaveTextContent(/kept on this device/);
    // Deleting moved to Settings → Privacy, as in the design.
    expect(screen.queryByTestId('delete-all')).toBeNull();
  });

  it('filters with the design’s five filters, searches and opens an incident', () => {
    const open = viewOf(sosQueued().state);
    const closed = { ...viewOf(sosResolved().state), id: 'inc-closed', shortId: 'PULSE-0002' };
    const cancelled = { ...viewOf(sosCancelled().state), id: 'inc-cancelled', shortId: 'PULSE-0003' };
    const taken = { ...viewOf(sosRoleTaken().state), id: 'inc-taken', shortId: 'PULSE-0004' };
    renderWithApp(<ActivityScreen />, createFakePulseApp({ incidents: [open, closed, cancelled, taken] }));

    expect(['all', 'active', 'awaiting', 'resolved', 'cancelled'].map((k) => screen.getByTestId(`filter-${k}`).props.accessibilityLabel)).toEqual(['All', 'Active', 'Awaiting Response', 'Resolved', 'Cancelled']);
    expect(screen.getByTestId(`incident-${open.id}`)).toHaveTextContent(/Queued/);
    expect(screen.getByTestId(`incident-${open.id}`)).toHaveTextContent(/Location not stated/);
    expect(screen.getByTestId('incident-inc-closed')).toHaveTextContent(/Resolved/);
    expect(screen.getByTestId('incident-inc-taken')).toHaveTextContent(/You → Mika Santos/);
    expect(screen.getByTestId('incident-inc-taken')).toHaveTextContent(/1 role taken/);

    fireEvent.press(screen.getByTestId('filter-active'));
    expect(screen.getByTestId(`incident-${open.id}`)).toBeTruthy();
    expect(screen.getByTestId('incident-inc-taken')).toBeTruthy();
    expect(screen.queryByTestId('incident-inc-closed')).toBeNull();
    expect(screen.queryByTestId('incident-inc-cancelled')).toBeNull();
    fireEvent.press(screen.getByTestId('filter-awaiting'));
    expect(screen.getByTestId(`incident-${open.id}`)).toBeTruthy();
    expect(screen.queryByTestId('incident-inc-taken')).toBeNull();
    fireEvent.press(screen.getByTestId('filter-resolved'));
    expect(screen.getByTestId('incident-inc-closed')).toBeTruthy();
    expect(screen.queryByTestId(`incident-${open.id}`)).toBeNull();
    fireEvent.press(screen.getByTestId('filter-cancelled'));
    expect(screen.getByTestId('incident-inc-cancelled')).toBeTruthy();
    expect(screen.queryByTestId('incident-inc-closed')).toBeNull();

    fireEvent.press(screen.getByTestId('filter-all'));
    fireEvent.changeText(screen.getByTestId('activity-search'), 'pulse-0002');
    expect(screen.queryByTestId(`incident-${open.id}`)).toBeNull();
    fireEvent.press(screen.getByTestId('incident-inc-closed'));
    expect(mockRouter.push).toHaveBeenCalledWith('/incident/inc-closed');
    fireEvent.changeText(screen.getByTestId('activity-search'), 'nothing matches this');
    expect(screen.getByTestId('activity-empty')).toHaveTextContent(/Try a different search or filter/);
  });

  it('never words a queued request as sent, alerted or on the way', () => {
    renderWithApp(<ActivityScreen />, createFakePulseApp({ incidents: [viewOf(sosQueued().state)] }));
    expect(screen.queryByText(/\bSent\b|alerted|notified|on the way/i)).toBeNull();
  });
});

describe('settings', () => {
  it('shows the device, real AI state and writes settings from the design’s rows', () => {
    const app = createFakePulseApp({ me: { deviceId: 'device-0123456789abcdef', name: 'Alex Rivera', onboarded: true, hardwareBackedKeys: true }, peers: [peer(MIKA)] });
    renderWithApp(<SettingsScreen />, app);
    expect(screen.getByTestId('device-id')).toHaveTextContent('iPhone 16 Pro · Device ID devi…cdef');
    expect(screen.getByTestId('profile-pill')).toHaveTextContent('This iPhone');
    expect(screen.getByTestId('row-name')).toHaveTextContent(/Alex Rivera/);
    expect(screen.getByTestId('open-intelligence')).toHaveTextContent(/Ready on-device/);
    expect(screen.getByTestId('row-keys')).toHaveTextContent(/Secure Enclave/);
    expect(screen.getByTestId('row-trusted-devices')).toHaveTextContent(/1/);
    expect(screen.getByTestId('settings-footer')).toHaveTextContent(/SAGIP prototype · Not an emergency service/);
    expect(screen.queryByText(/PULSE|battery|Emergency information|fall detection/i)).toBeNull();
    // Simulation-only rows stay out of Live.
    expect(screen.queryByTestId('row-session')).toBeNull();
    expect(screen.queryByTestId('reset-mock')).toBeNull();
    expect(screen.queryByTestId('seg-mika')).toBeNull();

    fireEvent.press(screen.getByTestId('toggle-discovery'));
    expect(app.actions.setDiscovery).toHaveBeenCalledWith(false);
    fireEvent.press(screen.getByTestId('toggle-relay'));
    expect(app.actions.updateSettings).toHaveBeenCalledWith({ relayEnabled: false });
    fireEvent.press(screen.getByTestId('toggle-technical'));
    expect(app.actions.updateSettings).toHaveBeenCalledWith({ showTechnicalDetails: true });
    fireEvent.press(screen.getByTestId('seg-10'));
    expect(app.actions.updateSettings).toHaveBeenCalledWith({ sosCountdownSeconds: 10 });
    fireEvent.press(screen.getByTestId('seg-fil-PH'));
    expect(app.actions.updateSettings).toHaveBeenCalledWith({ reportLocale: 'fil-PH' });
    fireEvent.press(screen.getByTestId('open-demo-lab'));
    expect(mockRouter.push).toHaveBeenCalledWith('/demo-lab');
    fireEvent.press(screen.getByTestId('row-trusted-devices'));
    expect(mockRouter.push).toHaveBeenCalledWith('/pair');
    fireEvent.press(screen.getByTestId('row-trusted-contacts'));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/network');
  });

  it('opens the per-capability sheet from "Model availability"', () => {
    renderWithApp(<SettingsScreen />, createFakePulseApp({ capabilities: capabilities('unavailable') }));
    expect(screen.getByTestId('open-intelligence')).toHaveTextContent(/Unavailable/);
    expect(screen.queryByTestId('intelligence-sheet')).toBeNull();
    fireEvent.press(screen.getByTestId('open-intelligence'));
    expect(screen.getByTestId('intelligence-provider')).toHaveTextContent(/Callstack Apple/);
    expect(screen.getByTestId('intelligence-text')).toHaveTextContent(/Unavailable/);
    expect(screen.getByTestId('intelligence-transcription')).toHaveTextContent(/Unsupported locale/);
    expect(screen.getByTestId('intelligence-sos-note')).toHaveTextContent(/Manual SOS works without it/);
  });

  it('deletes only after a confirmation that says other devices keep their copies', () => {
    const app = createFakePulseApp({ incidents: [viewOf(sosQueued().state)] });
    renderWithApp(<SettingsScreen />, app);
    fireEvent.press(screen.getByTestId('delete-all'));
    expect(app.actions.deleteAllIncidents).not.toHaveBeenCalled();
    expect(screen.getByText(/Copies already delivered to other devices are not deleted/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(app.actions.deleteAllIncidents).toHaveBeenCalledTimes(1);
  });

  it('offers no delete row when there is nothing to delete', () => {
    renderWithApp(<SettingsScreen />, createFakePulseApp());
    expect(screen.queryByTestId('delete-all')).toBeNull();
  });

  it('warns in Live when profile, pairings and settings are held in memory only', () => {
    const app = createFakePulseApp({ storage: { settingsPersistent: false } });
    renderWithApp(<SettingsScreen />, app);
    expect(screen.getByTestId('settings-memory-only')).toHaveTextContent(
      'Your profile, paired devices and settings are held in memory only on this device. They will be lost when the app closes.',
    );
    act(() => app.setSnapshot({ storage: { settingsPersistent: true } }));
    expect(screen.queryByTestId('settings-memory-only')).toBeNull();
  });

  it('shows no memory-only notice when storage is not reported, and never in Demo', () => {
    const live = renderWithApp(<SettingsScreen />, createFakePulseApp());
    expect(screen.queryByTestId('settings-memory-only')).toBeNull();
    live.unmount();
    renderWithApp(<SettingsScreen />, createFakePulseApp({ mode: 'demo', demo: demoState, capabilities: capabilities('ready', 'simulated'), storage: { settingsPersistent: false } }));
    expect(screen.queryByTestId('settings-memory-only')).toBeNull();
    expect(screen.queryByText(/held in memory only/)).toBeNull();
  });

  it('adds the simulated rows only in Demo', () => {
    const app = createFakePulseApp({ mode: 'demo', demo: demoState, capabilities: capabilities('ready', 'simulated') });
    renderWithApp(<SettingsScreen />, app);
    expect(screen.getByTestId('profile-pill')).toHaveTextContent('Simulated');
    expect(screen.getByTestId('open-intelligence')).toHaveTextContent(/Simulation/);
    expect(screen.getByTestId('settings-footer')).toHaveTextContent(/All data, AI output and networking are simulated/);
    fireEvent.press(screen.getByTestId('seg-mika'));
    expect(app.actions.demo.viewAs).toHaveBeenCalledWith('mika');
    fireEvent.press(screen.getByTestId('toggle-link-mika'));
    expect(app.actions.demo.setLink).toHaveBeenCalledWith('mika', false);
    fireEvent.press(screen.getByTestId('row-session'));
    expect(mockRouter.push).toHaveBeenCalledWith('/demo-lab/session');
    fireEvent.press(screen.getByTestId('reset-mock'));
    expect(app.actions.demo.reset).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(app.actions.demo.reset).toHaveBeenCalledTimes(1);
  });
});

describe('demo lab', () => {
  it('switches the single live/demo mode store and hides scenario controls in live mode', () => {
    renderWithApp(<DemoLabScreen />, createFakePulseApp());
    expect(screen.getByText('SAGIP Demo Lab')).toBeTruthy();
    expect(screen.getByTestId('demo-off')).toBeTruthy();
    expect(screen.queryByTestId('demo-reset')).toBeNull();
    expect(screen.queryByTestId('trigger-anomaly')).toBeNull();
    expect(screen.queryByTestId('trigger-session')).toBeNull();
    fireEvent.press(screen.getByTestId('open-local-ai'));
    expect(mockRouter.push).toHaveBeenCalledWith('/demo-lab/local-ai');
    fireEvent.press(screen.getByTestId('seg-demo'));
    expect(useAppMode.getState().mode).toBe('demo');
    fireEvent.press(screen.getByTestId('seg-live'));
    expect(useAppMode.getState().mode).toBe('live');
  });

  it('drives the simulated devices, links, AI toggle, six scenarios, triggers and reset', () => {
    const app = createFakePulseApp({ mode: 'demo', demo: demoState, settings: DEFAULT_SETTINGS });
    renderWithApp(<DemoLabScreen />, app);

    expect(screen.getByText('Alex · iPhone 17 Pro Max')).toBeTruthy();
    expect(screen.getByTestId('view-as-alex')).toHaveProp('accessibilityState', { selected: true });
    fireEvent.press(screen.getByTestId('view-as-mika'));
    expect(app.actions.demo.viewAs).toHaveBeenCalledWith('mika');
    fireEvent.press(screen.getByTestId('link-noah'));
    expect(app.actions.demo.setLink).toHaveBeenCalledWith('noah', true);
    fireEvent.press(screen.getByTestId('link-mika'));
    expect(app.actions.demo.setLink).toHaveBeenCalledWith('mika', false);
    fireEvent.press(screen.getByTestId('ai-ready'));
    expect(app.actions.demo.setAIReady).toHaveBeenCalledWith(false);
    fireEvent.press(screen.getByTestId('demo-technical'));
    expect(app.actions.updateSettings).toHaveBeenCalledWith({ showTechnicalDetails: true });

    expect(screen.getAllByLabelText(/^Run scenario \d:/)).toHaveLength(6);
    expect(screen.getByText('Complete SAGIP Experience')).toBeTruthy();
    fireEvent.press(screen.getByTestId('scenario-privacy'));
    expect(app.actions.demo.runScenario).toHaveBeenCalledWith('privacy');

    fireEvent.press(screen.getByTestId('trigger-session'));
    expect(mockRouter.push).toHaveBeenCalledWith('/demo-lab/session');
    fireEvent.press(screen.getByTestId('trigger-anomaly'));
    expect(useSafetySession.getState().anomalyOpen).toBe(true);

    fireEvent.press(screen.getByTestId('demo-reset'));
    expect(app.actions.demo.reset).toHaveBeenCalledTimes(1);
    expect(useSafetySession.getState().anomalyOpen).toBe(false);
  });
});

describe('local AI diagnostics', () => {
  it('re-runs extraction on a stored report through the contract and shows latency and source', async () => {
    const view = viewOf(sosFloorConflict().state);
    const reportId = view.state.reports.find((r) => r.kind === 'report')?.id ?? '';
    const app = createFakePulseApp({ incidents: [view] });
    app.actions.analyzeReport.mockResolvedValueOnce({
      ok: true,
      value: { fields: { building: { value: 'Building B', evidence: 'Building B' } }, dropped: [], unknown: ['floor'] },
      meta: { source: 'callstack-apple', latencyMs: 873 },
    });
    renderWithApp(<LocalAIDiagnosticsScreen />, app);

    expect(screen.getByTestId('diag-provider')).toHaveTextContent('Callstack Apple · @react-native-ai/apple 0.12.0');
    expect(screen.getByTestId('capability-speech')).toHaveTextContent(/Ready offline/);

    fireEvent.press(screen.getByTestId('diag-run'));
    await waitFor(() => expect(screen.getByTestId('diag-result-meta')).toHaveTextContent('Proposal · 873 ms · callstack-apple'));
    expect(app.actions.analyzeReport).toHaveBeenCalledWith(view.id, reportId);
    // Diagnostics never create or change an incident in live mode.
    expect(app.actions.sendSOS).not.toHaveBeenCalled();
    expect(app.actions.addReport).not.toHaveBeenCalled();
    expect(app.actions.attachProposal).not.toHaveBeenCalled();
  });

  it('shows the failure state and says SOS does not depend on the model', async () => {
    const view = viewOf(sosFloorConflict().state, MIKA);
    const app = createFakePulseApp({ incidents: [view], capabilities: capabilities('model_assets_missing') });
    renderWithApp(<LocalAIDiagnosticsScreen />, app);
    expect(screen.getByTestId('diag-unavailable')).toHaveTextContent(/Manual SOS does not depend on it/);
    fireEvent.press(screen.getByTestId('diag-run'));
    await waitFor(() => expect(screen.getByTestId('diag-result-meta')).toHaveTextContent(/Failed: unavailable · 0 ms · callstack-apple/));
  });

  it('Live: extracts from typed text through diagnoseExtraction and creates, records and sends nothing', async () => {
    const app = createFakePulseApp();
    app.actions.diagnoseExtraction.mockResolvedValueOnce({
      ok: true,
      value: { fields: { building: { value: 'Building B', evidence: 'in Building B' } }, dropped: ['symptom'], unknown: ['floor', 'locationText'] },
      meta: { source: 'callstack-apple', latencyMs: 412 },
    });
    renderWithApp(<LocalAIDiagnosticsScreen />, app);

    expect(screen.getByTestId('diag-text-note')).toHaveTextContent('Runs the model on the text above. Nothing is saved or sent, and no request is created.');
    fireEvent.press(screen.getByTestId('diag-run-text'));
    expect(app.actions.diagnoseExtraction).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('diag-text'), '  I am stuck in Building B  ');
    fireEvent.press(screen.getByTestId('diag-run-text'));
    await waitFor(() => expect(screen.getByTestId('diag-result-meta')).toHaveTextContent('Proposal · 412 ms · callstack-apple'));
    expect(app.actions.diagnoseExtraction).toHaveBeenCalledWith('I am stuck in Building B');

    expect(screen.getByTestId('diag-field-building')).toHaveTextContent(/Building: Building B/);
    expect(screen.getByTestId('diag-field-building')).toHaveTextContent(/“in Building B”/);
    expect(screen.getByTestId('diag-unknown')).toHaveTextContent('Unknown: Floor, Location, as described');
    expect(screen.getByTestId('diag-dropped')).toHaveTextContent('Dropped (no evidence in report): What was described');
    expect(screen.getByTestId('diag-result-note')).toHaveTextContent('A proposal, not a fact. Nothing was saved or sent.');
    expect(screen.queryByText('SIMULATED')).toBeNull();
    for (const name of ['sendSOS', 'addReport', 'analyzeReport', 'attachProposal'] as const) expect(app.actions[name]).not.toHaveBeenCalled();
  });

  it('Live: names a refusal and an unavailable model with the app’s own wording', async () => {
    const app = createFakePulseApp();
    app.actions.diagnoseExtraction.mockResolvedValueOnce({ ok: false, state: 'guardrail_refusal', message: 'refused', meta: { source: 'callstack-apple', latencyMs: 95 } });
    renderWithApp(<LocalAIDiagnosticsScreen />, app);
    fireEvent.changeText(screen.getByTestId('diag-text'), 'Some words');
    fireEvent.press(screen.getByTestId('diag-run-text'));
    await waitFor(() => expect(screen.getByTestId('diag-result-state')).toHaveTextContent('Refused by the model. No proposal was produced.'));
    expect(screen.getByTestId('diag-result-meta')).toHaveTextContent('Failed: guardrail_refusal · 95 ms · callstack-apple');
    expect(screen.queryByTestId('diag-unknown')).toBeNull();

    // The fake's default answer is "unavailable".
    fireEvent.press(screen.getByTestId('diag-run-text'));
    await waitFor(() => expect(screen.getByTestId('diag-result-state')).toHaveTextContent('Unavailable. No proposal was produced.'));
    expect(screen.getByTestId('diag-result-note')).toHaveTextContent('Nothing was saved or sent.');
  });

  it('Demo: labels the result SIMULATED, shows no latency as a measurement and creates no simulated request', async () => {
    const app = createFakePulseApp({ mode: 'demo', demo: demoState, capabilities: capabilities('ready', 'simulated') });
    app.actions.diagnoseExtraction.mockResolvedValueOnce({
      ok: true,
      value: { fields: { floor: { value: '3rd floor', evidence: '3rd floor' } }, dropped: [], unknown: [] },
      meta: { source: 'simulated', latencyMs: 640 },
    });
    renderWithApp(<LocalAIDiagnosticsScreen />, app);
    fireEvent.changeText(screen.getByTestId('diag-text'), 'On the 3rd floor');
    fireEvent.press(screen.getByTestId('diag-run-text'));
    await waitFor(() => expect(screen.getByTestId('diag-result-meta')).toHaveTextContent('Proposal · simulated, not measured'));
    expect(within(screen.getByTestId('diag-result')).getByText('SIMULATED')).toBeTruthy();
    expect(screen.queryByText(/640|\bms\b/)).toBeNull();
    expect(screen.getByTestId('diag-unknown')).toHaveTextContent('Unknown: none');
    expect(app.actions.diagnoseExtraction).toHaveBeenCalledWith('On the 3rd floor');
    for (const name of ['sendSOS', 'addReport', 'analyzeReport'] as const) expect(app.actions[name]).not.toHaveBeenCalled();
  });

  it('Demo: a simulated result from a stored report carries no latency either', async () => {
    const view = viewOf(sosFloorConflict().state);
    const app = createFakePulseApp({ mode: 'demo', demo: demoState, capabilities: capabilities('ready', 'simulated'), incidents: [view] });
    app.actions.analyzeReport.mockResolvedValueOnce({ ok: false, state: 'unavailable', message: 'simulated model off', meta: { source: 'simulated', latencyMs: 3 } });
    renderWithApp(<LocalAIDiagnosticsScreen />, app);
    fireEvent.press(screen.getByTestId('diag-run'));
    await waitFor(() => expect(screen.getByTestId('diag-result-meta')).toHaveTextContent('Failed: unavailable · simulated, not measured'));
    expect(screen.queryByText(/\bms\b/)).toBeNull();
  });
});
