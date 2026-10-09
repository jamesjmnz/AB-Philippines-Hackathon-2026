import { mockRouter } from '../testing/mocks';

import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ActivityScreen } from '../activity/ActivityScreen';
import { useAppMode } from '../appMode';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import { DemoLabScreen } from '../settings/DemoLabScreen';
import { LocalAIDiagnosticsScreen } from '../settings/LocalAIDiagnosticsScreen';
import { SettingsScreen } from '../settings/SettingsScreen';
import { capabilities, createFakePulseApp, DEFAULT_SETTINGS, viewOf } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { MIKA, sosFloorConflict, sosQueued, sosResolved } from '../testing/scenarios';

const notOnboarded = { deviceId: 'dev-alex', name: '', onboarded: false, hardwareBackedKeys: null };

beforeEach(() => {
  jest.clearAllMocks();
  act(() => useAppMode.setState({ mode: 'live' }));
});

describe('onboarding', () => {
  it('asks for a name, explains permissions without requesting them, and completes with the name', async () => {
    const app = createFakePulseApp({ me: notOnboarded, capabilities: capabilities('unavailable') });
    renderWithApp(<OnboardingScreen />, app);

    expect(screen.getByText(/Not an emergency service/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('get-started'));

    // A name is required before continuing.
    fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByText('What should people call you?')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('name-input'), '  Alex Rivera ');
    fireEvent.press(screen.getByTestId('onboarding-next'));

    expect(screen.getByText('Local Network')).toBeTruthy();
    expect(screen.getByText('Microphone')).toBeTruthy();
    expect(screen.getByText(/does not ask for anything now/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('onboarding-next'));

    // Per-capability facts from the snapshot; never a combined "ready" claim.
    expect(screen.getByTestId('capability-text')).toHaveTextContent(/Unavailable/);
    expect(screen.getByTestId('capability-embeddings')).toHaveTextContent(/Ready offline/);
    expect(screen.getByTestId('capability-transcription')).toHaveTextContent(/Unsupported locale/);
    expect(screen.queryByText(/of 4 ready|safety circle is ready/i)).toBeNull();
    fireEvent.press(screen.getByTestId('onboarding-next'));

    expect(screen.getByText('Not an emergency service')).toBeTruthy();
    expect(app.actions.completeOnboarding).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('onboarding-next'));
    await waitFor(() => expect(app.actions.completeOnboarding).toHaveBeenCalledWith({ name: 'Alex Rivera' }));
  });

  it('says capabilities are still being checked rather than inventing a result', () => {
    const app = createFakePulseApp({ me: { ...notOnboarded, name: 'Alex' }, capabilities: null });
    renderWithApp(<OnboardingScreen />, app);
    fireEvent.press(screen.getByTestId('get-started'));
    fireEvent.press(screen.getByTestId('onboarding-next'));
    fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-capabilities-pending')).toBeTruthy();
    expect(screen.queryByText('Ready offline')).toBeNull();
  });
});

describe('activity', () => {
  it('shows the empty state with no incidents and no delete control', () => {
    renderWithApp(<ActivityScreen />, createFakePulseApp());
    expect(screen.getByTestId('activity-empty')).toHaveTextContent(/No incidents found/);
    expect(screen.queryByTestId('delete-all')).toBeNull();
  });

  it('filters, searches and opens an incident', () => {
    const open = viewOf(sosQueued().state);
    const closed = { ...viewOf(sosResolved().state), id: 'inc-closed', shortId: 'PULSE-0002' };
    renderWithApp(<ActivityScreen />, createFakePulseApp({ incidents: [open, closed] }));

    expect(screen.getByTestId(`incident-${open.id}`)).toHaveTextContent(/Queued/);
    expect(screen.getByTestId('incident-inc-closed')).toHaveTextContent(/Resolved/);
    fireEvent.press(screen.getByTestId('filter-closed'));
    expect(screen.queryByTestId(`incident-${open.id}`)).toBeNull();
    fireEvent.press(screen.getByTestId('filter-all'));
    fireEvent.changeText(screen.getByTestId('activity-search'), 'pulse-0002');
    expect(screen.queryByTestId(`incident-${open.id}`)).toBeNull();
    fireEvent.press(screen.getByTestId('incident-inc-closed'));
    expect(mockRouter.push).toHaveBeenCalledWith('/incident/inc-closed');
    fireEvent.changeText(screen.getByTestId('activity-search'), 'nothing matches this');
    expect(screen.getByTestId('activity-empty')).toHaveTextContent(/Nothing matches/);
  });

  it('deletes only after a confirmation that says other devices keep their copies', () => {
    const app = createFakePulseApp({ incidents: [viewOf(sosQueued().state)] });
    renderWithApp(<ActivityScreen />, app);
    fireEvent.press(screen.getByTestId('delete-all'));
    expect(app.actions.deleteAllIncidents).not.toHaveBeenCalled();
    expect(screen.getByText(/Copies already delivered to other devices are not deleted/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(app.actions.deleteAllIncidents).toHaveBeenCalledTimes(1);
  });
});

describe('settings', () => {
  it('shows the short device id, per-capability AI status and writes settings', () => {
    const app = createFakePulseApp({ me: { deviceId: 'device-0123456789abcdef', name: 'Alex Rivera', onboarded: true, hardwareBackedKeys: true } });
    renderWithApp(<SettingsScreen />, app);
    expect(screen.getByTestId('device-id')).toHaveTextContent('Device ID devi…cdef');
    expect(screen.getByTestId('capability-text')).toHaveTextContent(/Ready offline/);
    expect(screen.getByTestId('capability-transcription')).toHaveTextContent(/Unsupported locale/);
    expect(screen.getByText('Held in the Secure Enclave')).toBeTruthy();

    fireEvent.press(screen.getByTestId('toggle-discovery'));
    expect(app.actions.setDiscovery).toHaveBeenCalledWith(false);
    fireEvent.press(screen.getByTestId('toggle-relay'));
    expect(app.actions.updateSettings).toHaveBeenCalledWith({ relayEnabled: false });
    fireEvent.press(screen.getByTestId('countdown-10'));
    expect(app.actions.updateSettings).toHaveBeenCalledWith({ sosCountdownSeconds: 10 });
    fireEvent.press(screen.getByTestId('locale-fil-PH'));
    expect(app.actions.updateSettings).toHaveBeenCalledWith({ reportLocale: 'fil-PH' });
    fireEvent.press(screen.getByTestId('open-demo-lab'));
    expect(mockRouter.push).toHaveBeenCalledWith('/demo-lab');
  });
});

describe('demo lab', () => {
  const demo = {
    viewingAs: 'alex' as const,
    aiReady: true,
    links: { mika: true, noah: false },
    runningScenario: null,
    scenarios: ['normal', 'intelligence', 'multi', 'privacy', 'recovery', 'complete'].map((key, i) => ({ key, title: `Scenario ${i + 1}`, description: 'Simulated' })),
  };

  it('switches the single live/demo mode store and hides scenario controls in live mode', () => {
    renderWithApp(<DemoLabScreen />, createFakePulseApp());
    expect(screen.getByTestId('demo-off')).toBeTruthy();
    expect(screen.queryByTestId('demo-reset')).toBeNull();
    fireEvent.press(screen.getByTestId('seg-demo'));
    expect(useAppMode.getState().mode).toBe('demo');
    fireEvent.press(screen.getByTestId('seg-live'));
    expect(useAppMode.getState().mode).toBe('live');
  });

  it('drives the simulated devices, links, AI toggle, six scenarios and reset', () => {
    const app = createFakePulseApp({ mode: 'demo', demo, settings: DEFAULT_SETTINGS });
    renderWithApp(<DemoLabScreen />, app);

    fireEvent.press(screen.getByTestId('view-as-mika'));
    expect(app.actions.demo.viewAs).toHaveBeenCalledWith('mika');
    fireEvent.press(screen.getByTestId('link-noah'));
    expect(app.actions.demo.setLink).toHaveBeenCalledWith('noah', true);
    fireEvent.press(screen.getByTestId('ai-ready'));
    expect(app.actions.demo.setAIReady).toHaveBeenCalledWith(false);
    expect(screen.getAllByLabelText(/^Run scenario \d:/)).toHaveLength(6);
    fireEvent.press(screen.getByTestId('scenario-privacy'));
    expect(app.actions.demo.runScenario).toHaveBeenCalledWith('privacy');
    fireEvent.press(screen.getByTestId('demo-reset'));
    expect(app.actions.demo.reset).toHaveBeenCalledTimes(1);
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
