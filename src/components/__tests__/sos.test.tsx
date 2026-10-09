import { mockOpenURL, mockRouter } from '../testing/mocks';

import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { SOSScreen } from '../sos/SOSScreen';
import { AI_ACTIONS, createFakePulseApp, DEFAULT_SETTINGS, peer } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { MIKA } from '../testing/scenarios';

function expectNoAI(app: ReturnType<typeof createFakePulseApp>) {
  for (const name of AI_ACTIONS) expect(app.actions[name]).not.toHaveBeenCalled();
  expect(app.actions.addReport).not.toHaveBeenCalled();
}

describe('SOS screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls sendSOS immediately on "Send SOS now", before any navigation, and calls no AI action', async () => {
    const app = createFakePulseApp({ peers: [peer(MIKA)] });
    renderWithApp(<SOSScreen />, app);

    fireEvent.press(screen.getByTestId('sos-send'));

    // Synchronously after the press: the request was issued and nothing else has happened yet.
    expect(app.actions.sendSOS).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/incident/inc-test-0001'));
    expect(app.actions.sendSOS).toHaveBeenCalledTimes(1);
    expectNoAI(app);
  });

  it('calls sendSOS when the countdown ends, not before', async () => {
    const app = createFakePulseApp({ settings: { ...DEFAULT_SETTINGS, sosCountdownSeconds: 3 } });
    renderWithApp(<SOSScreen />, app);

    expect(screen.getByText('3')).toBeTruthy();
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.getByText('2')).toBeTruthy();
    act(() => jest.advanceTimersByTime(1000));
    expect(app.actions.sendSOS).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1000));

    expect(app.actions.sendSOS).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/incident/inc-test-0001'));
    act(() => jest.advanceTimersByTime(5000));
    expect(app.actions.sendSOS).toHaveBeenCalledTimes(1);
    expectNoAI(app);
  });

  it('creates the SOS first when describing, then opens the report screen', async () => {
    const app = createFakePulseApp();
    renderWithApp(<SOSScreen />, app);

    fireEvent.press(screen.getByTestId('sos-describe'));

    expect(app.actions.sendSOS).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/incident/inc-test-0001/report'));
    expectNoAI(app);
  });

  it('does not send when cancelled, and the countdown stops with the screen', () => {
    const app = createFakePulseApp();
    const view = renderWithApp(<SOSScreen />, app);

    fireEvent.press(screen.getByTestId('sos-cancel'));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    view.unmount();
    act(() => jest.advanceTimersByTime(20000));
    expect(app.actions.sendSOS).not.toHaveBeenCalled();
  });

  it('says plainly when saving failed and lets the person retry', async () => {
    const app = createFakePulseApp();
    app.actions.sendSOS.mockResolvedValueOnce({ ok: false, code: 'storage', message: 'disk' });
    renderWithApp(<SOSScreen />, app);

    fireEvent.press(screen.getByTestId('sos-send'));
    await waitFor(() => expect(screen.getByTestId('sos-failed')).toBeTruthy());
    expect(mockRouter.replace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('sos-send'));
    expect(app.actions.sendSOS).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/incident/inc-test-0001'));
  });

  it('states that no emergency services are contacted and dials only when the link is tapped', () => {
    const app = createFakePulseApp();
    renderWithApp(<SOSScreen />, app);

    expect(screen.getByText(/SAGIP does not contact emergency services/)).toBeTruthy();
    expect(mockOpenURL).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(2000));
    expect(mockOpenURL).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Call emergency number'));
    expect(mockOpenURL).toHaveBeenCalledWith('tel:911');
  });

  it('warns when no trusted device is paired and never promises that anyone was alerted', () => {
    const app = createFakePulseApp({ peers: [] });
    renderWithApp(<SOSScreen />, app);

    expect(screen.getByTestId('sos-no-peer')).toBeTruthy();
    expect(screen.queryByText(/will be alerted/i)).toBeNull();
    expect(screen.queryByText(/help is on the way/i)).toBeNull();
    expect(screen.getByText(/saved on this device and queued/)).toBeTruthy();
  });
});
