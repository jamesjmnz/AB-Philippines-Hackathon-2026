import { mockRouter } from '../testing/mocks';

import { act, fireEvent, screen } from '@testing-library/react-native';

import { SafetySessionScreen } from '../demo/SafetySessionScreen';
import { useSafetySession } from '../demo/safetySession';
import { createFakePulseApp, peer } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { MIKA, NOAH } from '../testing/scenarios';

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  act(() => useSafetySession.getState().reset());
});
afterEach(() => {
  act(() => useSafetySession.getState().reset());
  jest.useRealTimers();
});

describe('safety session (simulation only)', () => {
  it('refuses to render outside Demo mode, even if the store says a session is active', () => {
    act(() => useSafetySession.getState().start());
    renderWithApp(<SafetySessionScreen />, createFakePulseApp({ mode: 'live' }));
    expect(screen.getByTestId('session-unavailable')).toBeTruthy();
    expect(screen.getByText('Safety Session is a simulation')).toBeTruthy();
    expect(screen.queryByTestId('session-screen')).toBeNull();
    expect(screen.queryByTestId('session-start')).toBeNull();
    expect(screen.queryByTestId('session-simulate')).toBeNull();
    fireEvent.press(screen.getByTestId('session-open-lab'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/demo-lab');
  });

  it('starts, counts, opens the unusual-movement check and ends, in Demo', () => {
    const app = createFakePulseApp({ mode: 'demo', peers: [peer(MIKA), peer(NOAH, { reach: 'unreachable' })] });
    renderWithApp(<SafetySessionScreen />, app);

    expect(screen.getByTestId('session-status')).toHaveTextContent('Inactive');
    expect(screen.getByTestId('session-timer')).toHaveTextContent('00:00');
    expect(screen.getByText('1 reachable')).toBeTruthy();
    expect(screen.queryByText(/1:05 PM/)).toBeNull();
    expect(screen.getByText(/does not read motion sensors/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('session-start'));
    expect(screen.getByTestId('session-status')).toHaveTextContent('Monitoring · simulated');
    act(() => jest.advanceTimersByTime(3100));
    expect(screen.getByTestId('session-timer')).toHaveTextContent('00:03');
    expect(screen.getByText('Next check-in in 15 min')).toBeTruthy();

    fireEvent.press(screen.getByTestId('session-location'));
    expect(useSafetySession.getState().shareLocation).toBe(false);

    expect(useSafetySession.getState().anomalyOpen).toBe(false);
    fireEvent.press(screen.getByTestId('session-simulate'));
    expect(useSafetySession.getState().anomalyOpen).toBe(true);

    fireEvent.press(screen.getByTestId('session-end'));
    expect(useSafetySession.getState().active).toBe(false);
    expect(screen.getByTestId('session-timer')).toHaveTextContent('00:00');
    // The simulation never touches the service layer.
    expect(app.actions.sendSOS).not.toHaveBeenCalled();
    expect(app.actions.updateSettings).not.toHaveBeenCalled();
  });
});
