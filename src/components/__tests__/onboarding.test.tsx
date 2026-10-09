import '../testing/mocks';

import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useAppMode } from '../appMode';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import { capabilities, createFakePulseApp, peer } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { MIKA, NOAH } from '../testing/scenarios';

const notOnboarded = { deviceId: 'dev-alex', name: '', onboarded: false, hardwareBackedKeys: null };

beforeEach(() => {
  jest.clearAllMocks();
  act(() => useAppMode.setState({ mode: 'live' }));
});

function toStep(n: number, name = 'Alex Rivera') {
  fireEvent.press(screen.getByTestId('get-started'));
  if (n === 0) return;
  fireEvent.press(screen.getByTestId('for-0'));
  fireEvent.press(screen.getByTestId('onboarding-next'));
  if (n === 1) return;
  fireEvent.press(screen.getByTestId('role-0'));
  fireEvent.changeText(screen.getByTestId('name-input'), name);
  fireEvent.press(screen.getByTestId('onboarding-next'));
  for (let i = 2; i < n; i += 1) fireEvent.press(screen.getByTestId('onboarding-next'));
}

describe('splash and welcome', () => {
  it('shows the splash for 2.2 seconds, then the welcome screen', () => {
    jest.useFakeTimers();
    try {
      renderWithApp(<OnboardingScreen />, createFakePulseApp({ me: notOnboarded }));
      expect(screen.getByTestId('splash-screen')).toBeTruthy();
      expect(screen.getByText('SAGIP')).toBeTruthy();
      expect(screen.queryByTestId('get-started')).toBeNull();
      act(() => jest.advanceTimersByTime(2100));
      expect(screen.queryByTestId('get-started')).toBeNull();
      act(() => jest.advanceTimersByTime(200));
      expect(screen.getByTestId('welcome-screen')).toBeTruthy();
      expect(screen.getByTestId('get-started')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('draws the orbit without invented people in Live and offers the demo', () => {
    renderWithApp(<OnboardingScreen initial="welcome" />, createFakePulseApp({ me: notOnboarded }));
    expect(screen.getByText('You’re never meant to face an emergency alone.')).toBeTruthy();
    // The orbit is decorative, so it is hidden from assistive technology.
    expect(screen.getByTestId('welcome-orbit', { includeHiddenElements: true })).toBeTruthy();
    for (const initials of ['MS', 'NC', 'SR']) expect(screen.queryByText(initials, { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText(/PULSE/)).toBeNull();
    fireEvent.press(screen.getByTestId('explore-demo'));
    expect(useAppMode.getState().mode).toBe('demo');
  });

  it('uses the design’s simulated people only in Demo, where "Explore Demo" is gone', () => {
    renderWithApp(<OnboardingScreen initial="welcome" />, createFakePulseApp({ me: notOnboarded, mode: 'demo' }));
    for (const initials of ['MS', 'NC', 'SR']) expect(screen.getByText(initials, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('explore-demo')).toBeNull();
  });
});

describe('onboarding steps', () => {
  it('walks the five steps, requires a choice and a name, and completes with the trimmed name', async () => {
    const app = createFakePulseApp({ me: notOnboarded, capabilities: capabilities('unavailable'), peers: [] });
    renderWithApp(<OnboardingScreen initial="welcome" />, app);
    fireEvent.press(screen.getByTestId('get-started'));

    // 1/5: nothing chosen yet, so Continue does nothing.
    expect(screen.getByText('Who are you using SAGIP for?')).toBeTruthy();
    expect(screen.getByTestId('onboarding-step')).toHaveTextContent('1/5');
    fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-step')).toHaveTextContent('1/5');
    fireEvent.press(screen.getByTestId('for-1'));
    expect(screen.getByTestId('for-1')).toHaveProp('accessibilityState', { selected: true });
    fireEvent.press(screen.getByTestId('onboarding-next'));

    // 2/5: a role alone is not enough; the name is required.
    expect(screen.getByText('Choose your role')).toBeTruthy();
    fireEvent.press(screen.getByTestId('role-1'));
    fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-step')).toHaveTextContent('2/5');
    fireEvent.changeText(screen.getByTestId('name-input'), '   ');
    fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-step')).toHaveTextContent('2/5');
    fireEvent.changeText(screen.getByTestId('name-input'), '  Alex Rivera ');
    fireEvent.press(screen.getByTestId('onboarding-next'));

    // 3/5: no seeded contacts.
    expect(screen.getByText('Set up your safety circle')).toBeTruthy();
    expect(screen.getByTestId('circle-empty')).toHaveTextContent(/No devices yet/);
    expect(screen.queryByText(/Mika|Noah|Sofia|Daniel/)).toBeNull();
    fireEvent.press(screen.getByTestId('onboarding-next'));

    // 4/5: only real settings in Live, nothing simulated.
    expect(screen.getByText('Safety monitoring preferences')).toBeTruthy();
    expect(screen.queryByText(/fall detection|check-ins|simulated/i)).toBeNull();
    expect(screen.getByTestId('pref-note')).toHaveTextContent(/Nothing is monitored in the background/);
    fireEvent.press(screen.getByTestId('pref-discovery'));
    expect(app.actions.setDiscovery).toHaveBeenCalledWith(false);
    fireEvent.press(screen.getByTestId('pref-relay'));
    expect(app.actions.updateSettings).toHaveBeenCalledWith({ relayEnabled: false });
    fireEvent.press(screen.getByTestId('onboarding-next'));

    // 5/5: real readiness, not a guarantee.
    expect(screen.getByTestId('onboarding-step')).toHaveTextContent('5/5');
    expect(screen.getByTestId('onboarding-ready-count')).toHaveTextContent('0 of 3 ready');
    expect(screen.getByText('SAGIP is set up.')).toBeTruthy();
    expect(screen.getByText('No trusted device yet. Pair one in Network.')).toBeTruthy();
    expect(screen.getByTestId('ready-ai')).toHaveTextContent(/Callstack Apple/);
    expect(screen.getByTestId('ready-ai')).toHaveTextContent(/Unavailable/);
    expect(screen.queryByText(/of 4 ready|safety circle is ready/i)).toBeNull();
    expect(app.actions.completeOnboarding).not.toHaveBeenCalled();
    expect(screen.getByText('Go to SAGIP')).toBeTruthy();
    fireEvent.press(screen.getByTestId('onboarding-next'));
    await waitFor(() => expect(app.actions.completeOnboarding).toHaveBeenCalledWith({ name: 'Alex Rivera' }));
  });

  it('binds the safety circle and the final step to real peers and capabilities', () => {
    const app = createFakePulseApp({
      me: notOnboarded,
      capabilities: capabilities('ready'),
      peers: [peer(MIKA), peer(NOAH, { trusted: false, reach: 'discovered' })],
    });
    renderWithApp(<OnboardingScreen initial="welcome" />, app);
    toStep(2);
    expect(screen.getByTestId(`circle-${MIKA.deviceId}`)).toHaveTextContent(/Trusted · code confirmed/);
    expect(screen.getByTestId(`circle-${NOAH.deviceId}`)).toHaveTextContent(/Nearby · pair it in Network/);
    fireEvent.press(screen.getByTestId('onboarding-next'));
    fireEvent.press(screen.getByTestId('onboarding-next'));

    expect(screen.getByTestId('onboarding-ready-count')).toHaveTextContent('3 of 3 ready');
    expect(screen.getByText('Your safety circle is ready.')).toBeTruthy();
    expect(screen.getByText('1 trusted device set up for local relay.')).toBeTruthy();
    expect(screen.getByTestId('ready-me')).toHaveTextContent(/Alex Rivera/);
    expect(screen.getByTestId(`ready-${MIKA.deviceId}`)).toHaveTextContent(/Reachable/);
    expect(screen.queryByTestId(`ready-${NOAH.deviceId}`)).toBeNull();
    expect(screen.getByTestId('ready-ai')).toHaveTextContent(/Ready offline/);
  });

  it('says capabilities are still being checked rather than inventing a result', () => {
    renderWithApp(<OnboardingScreen initial="welcome" />, createFakePulseApp({ me: { ...notOnboarded, name: 'Alex' }, capabilities: null }));
    toStep(4, 'Alex');
    expect(screen.getByTestId('ready-ai')).toHaveTextContent(/Checking…/);
    expect(screen.queryByText('Ready offline')).toBeNull();
    expect(screen.getByTestId('onboarding-ready-count')).toHaveTextContent('0 of 3 ready');
  });

  it('shows the design’s simulated preferences only in Demo', () => {
    renderWithApp(<OnboardingScreen initial="welcome" />, createFakePulseApp({ me: notOnboarded, mode: 'demo', capabilities: capabilities('ready', 'simulated') }));
    toStep(3);
    expect(screen.getByText('Possible fall detection')).toBeTruthy();
    expect(screen.getByTestId('pref-note')).toHaveTextContent(/monitoring is simulated/);
    fireEvent.press(screen.getByTestId('pref-fall'));
    expect(screen.getByTestId('pref-fall')).toHaveProp('accessibilityState', { checked: true, disabled: false });
    fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('ready-ai')).toHaveTextContent(/Simulation/);
  });

  it('goes back a step, and from the first step back to welcome', () => {
    renderWithApp(<OnboardingScreen initial="welcome" />, createFakePulseApp({ me: notOnboarded }));
    toStep(1);
    fireEvent.press(screen.getByTestId('onboarding-back'));
    expect(screen.getByTestId('onboarding-step')).toHaveTextContent('1/5');
    fireEvent.press(screen.getByTestId('onboarding-back'));
    expect(screen.getByTestId('welcome-screen')).toBeTruthy();
  });

  it('says so when the name could not be saved', async () => {
    const app = createFakePulseApp({ me: notOnboarded });
    app.actions.completeOnboarding.mockRejectedValueOnce(new Error('disk'));
    renderWithApp(<OnboardingScreen initial="welcome" />, app);
    toStep(4);
    fireEvent.press(screen.getByTestId('onboarding-next'));
    await waitFor(() => expect(screen.getByTestId('onboarding-failed')).toBeTruthy());
  });
});
