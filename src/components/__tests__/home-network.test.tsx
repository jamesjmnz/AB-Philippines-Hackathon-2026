import { mockRouter } from '../testing/mocks';

import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { HomeScreen } from '../home/HomeScreen';
import { NetworkScreen } from '../network/NetworkScreen';
import { PairScreen } from '../network/PairScreen';
import { capabilities, createFakePulseApp, peer, viewOf } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { ALEX, MIKA, NOAH, sosAcknowledged, sosDelivered, sosQueued } from '../testing/scenarios';

beforeEach(() => jest.clearAllMocks());

/** Lets a pending action promise settle so its state update lands inside act. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('Home', () => {
  it('says no trusted device is paired when there is none', () => {
    renderWithApp(<HomeScreen />, createFakePulseApp({ peers: [] }));
    expect(screen.getByTestId('network-line')).toHaveTextContent('No trusted device paired');
    expect(screen.getByTestId('overview-network')).toHaveTextContent(/No trusted device paired/);
    expect(screen.queryByTestId('responder-idle')).toBeNull();
  });

  it('says none are connected when the trusted peer is disconnected', () => {
    renderWithApp(<HomeScreen />, createFakePulseApp({ peers: [peer(MIKA, { reach: 'unreachable' })] }));
    expect(screen.getByTestId('network-line')).toHaveTextContent('1 trusted · none connected right now');
    expect(screen.queryByTestId('responder-idle')).toBeNull();
  });

  it('reports connected peers only from real peer state', () => {
    renderWithApp(<HomeScreen />, createFakePulseApp({ peers: [peer(MIKA), peer(NOAH, { reach: 'discovered' })] }));
    expect(screen.getByTestId('network-line')).toHaveTextContent('2 trusted · 1 connected now');
  });

  it('reports a denied Local Network permission', () => {
    renderWithApp(<HomeScreen />, createFakePulseApp({ peers: [peer(MIKA)], network: { discovery: 'permission_denied', error: null } }));
    expect(screen.getByTestId('network-line')).toHaveTextContent(/Local Network access is denied/);
  });

  it('shows the Local AI card with provider, device and the real text-model state', () => {
    const app = createFakePulseApp({ capabilities: capabilities('ready') });
    renderWithApp(<HomeScreen />, app);
    expect(screen.getByTestId('local-ai-provider')).toHaveTextContent('Callstack Apple');
    expect(screen.getByTestId('local-ai-device')).toHaveTextContent('iPhone 16 Pro · iOS 26.0');
    expect(screen.getByTestId('local-ai-text')).toHaveTextContent('Ready offline');
    expect(within(screen.getByTestId('local-ai-card')).getByText(/Manual SOS does not depend on local AI/)).toBeTruthy();
  });

  it.each([
    ['unavailable', 'Unavailable'],
    ['unsupported_locale', 'Unsupported locale'],
  ] as const)('shows the text model as %s without a readiness score', (state, label) => {
    renderWithApp(<HomeScreen />, createFakePulseApp({ capabilities: capabilities(state) }));
    expect(screen.getByTestId('local-ai-text')).toHaveTextContent(label);
    expect(screen.queryByText(/protected|of 4 ready|safety score/i)).toBeNull();
  });

  it('names simulation as the provider and state in demo mode', () => {
    renderWithApp(<HomeScreen />, createFakePulseApp({ mode: 'demo', capabilities: capabilities('ready', 'simulated') }));
    expect(screen.getByTestId('local-ai-provider')).toHaveTextContent('Simulation');
    expect(screen.getByTestId('local-ai-text')).toHaveTextContent('Simulation');
  });

  it('shows the own active request with its real status and opens the SOS flow', () => {
    const view = viewOf(sosQueued().state);
    renderWithApp(<HomeScreen />, createFakePulseApp({ incidents: [view], peers: [peer(MIKA), peer(NOAH)] }));
    expect(screen.getByTestId(`active-${view.id}`)).toHaveTextContent(/Saved on this device/);
    expect(screen.queryByText(/on the way|notified|alerted/i)).toBeNull();

    fireEvent.press(screen.getByTestId('request-assistance'));
    expect(mockRouter.push).toHaveBeenCalledWith('/sos');
  });

  it('shows an incoming request to a responder, who can mark it seen', async () => {
    const view = viewOf(sosDelivered().state, MIKA);
    const app = createFakePulseApp({ me: { deviceId: MIKA.deviceId, name: MIKA.userName, onboarded: true, hardwareBackedKeys: true }, incidents: [view], peers: [peer(ALEX)] });
    renderWithApp(<HomeScreen />, app);

    const card = screen.getByTestId(`incoming-${view.id}`);
    expect(within(card).getByText('Incoming request')).toBeTruthy();
    expect(within(card).getByText(/Alex · Manual SOS/)).toBeTruthy();
    fireEvent.press(screen.getByTestId(`incoming-ack-${view.id}`));
    expect(app.actions.acknowledge).toHaveBeenCalledWith(view.id);
    await flush();
  });

  it('does not offer "mark as seen" twice', () => {
    const view = viewOf(sosAcknowledged().state, MIKA);
    const app = createFakePulseApp({ me: { deviceId: MIKA.deviceId, name: MIKA.userName, onboarded: true, hardwareBackedKeys: true }, incidents: [view] });
    renderWithApp(<HomeScreen />, app);
    fireEvent.press(screen.getByTestId(`incoming-ack-${view.id}`));
    expect(app.actions.acknowledge).not.toHaveBeenCalled();
  });
});

describe('Network', () => {
  it('shows the no-peer states in both segments and no relay card', () => {
    renderWithApp(<NetworkScreen />, createFakePulseApp({ peers: [] }));
    expect(screen.getByTestId('discovery-state')).toHaveTextContent('Looking for nearby devices');
    expect(screen.getByTestId('peers-empty-nearby')).toHaveTextContent(/No nearby device found/);
    fireEvent.press(screen.getByTestId('seg-trusted'));
    expect(screen.getByTestId('peers-empty-trusted')).toHaveTextContent(/No trusted device paired/);
    expect(screen.queryByTestId('relay-card')).toBeNull();
  });

  it('shows a disconnected trusted peer as not reachable, and not under Nearby', () => {
    renderWithApp(<NetworkScreen />, createFakePulseApp({ peers: [peer(MIKA, { reach: 'unreachable' })] }));
    expect(screen.getByTestId('peers-empty-nearby')).toBeTruthy();
    fireEvent.press(screen.getByTestId('seg-trusted'));
    expect(screen.getByTestId(`peer-${MIKA.deviceId}`)).toHaveTextContent(/Not reachable/);
    expect(screen.queryByText('Connected')).toBeNull();
  });

  it('explains a denied Local Network permission', () => {
    renderWithApp(<NetworkScreen />, createFakePulseApp({ network: { discovery: 'permission_denied', error: null } }));
    expect(screen.getByTestId('discovery-state')).toHaveTextContent('Local Network access is denied');
    expect(screen.getByTestId('permission-denied')).toBeTruthy();
  });

  it('offers to turn discovery on when it is off', () => {
    const app = createFakePulseApp({ network: { discovery: 'off', error: null } });
    renderWithApp(<NetworkScreen />, app);
    fireEvent.press(screen.getByTestId('discovery-on'));
    expect(app.actions.setDiscovery).toHaveBeenCalledWith(true);
  });

  it('shows a relay path only when the incident records one', () => {
    const view = viewOf(sosDelivered().state, MIKA, { receivedViaName: 'Noah Cruz' });
    renderWithApp(<NetworkScreen />, createFakePulseApp({ me: { deviceId: MIKA.deviceId, name: MIKA.userName, onboarded: true, hardwareBackedKeys: null }, incidents: [view] }));
    expect(screen.getByTestId('relay-card')).toHaveTextContent(/Alex Rivera/);
    expect(screen.getByTestId('relay-card')).toHaveTextContent(/Noah Cruz/);
  });
});

describe('Pairing', () => {
  it('lists only discovered, unpaired devices and starts pairing on tap', async () => {
    const app = createFakePulseApp({ peers: [peer(MIKA), peer(NOAH, { trusted: false, reach: 'discovered' })] });
    renderWithApp(<PairScreen />, app);
    expect(screen.queryByTestId(`pair-pick-${MIKA.deviceId}`)).toBeNull();
    fireEvent.press(screen.getByTestId(`pair-pick-${NOAH.deviceId}`));
    expect(app.actions.startPairing).toHaveBeenCalledWith(NOAH.deviceId);
    await flush();
  });

  it('shows the six-digit code with confirm and reject, and is not trusted while waiting', async () => {
    const app = createFakePulseApp({ pairing: { peerDeviceId: NOAH.deviceId, peerName: 'Noah', code: '482913', stage: 'compare', error: null } });
    renderWithApp(<PairScreen />, app);
    expect(screen.getByLabelText('Pairing code 4 8 2 9 1 3')).toBeTruthy();
    fireEvent.press(screen.getByTestId('pair-confirm'));
    expect(app.actions.confirmPairing).toHaveBeenCalledTimes(1);
    await flush();
    fireEvent.press(screen.getByTestId('pair-reject'));
    expect(app.actions.cancelPairing).toHaveBeenCalledTimes(1);

    act(() => app.setSnapshot({ pairing: { peerDeviceId: NOAH.deviceId, peerName: 'Noah', code: '482913', stage: 'awaiting_peer', error: null } }));
    expect(screen.getByTestId('pair-waiting')).toHaveTextContent(/Not trusted yet/);
  });

  it('shows the empty state when nothing can be paired', () => {
    renderWithApp(<PairScreen />, createFakePulseApp({ peers: [] }));
    expect(screen.getByTestId('pair-empty')).toBeTruthy();
  });
});
