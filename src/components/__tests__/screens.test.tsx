import { mockRouter } from '../testing/mocks';

import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

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
    expect(screen.queryByTestId('diag-text')).toBeNull();

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
});
