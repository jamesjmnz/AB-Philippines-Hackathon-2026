import { mockRouter } from '../testing/mocks';

import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { HomeScreen } from '../home/HomeScreen';
import { NetworkScreen } from '../network/NetworkScreen';
import { PairScreen } from '../network/PairScreen';
import { createFakePulseApp, peer, viewOf } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { ALEX, MIKA, NOAH, sosAcknowledged, sosDelivered, sosQueued } from '../testing/scenarios';

beforeEach(() => jest.clearAllMocks());

/** Lets a pending action promise settle so its state update lands inside act. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

const asMika = { deviceId: MIKA.deviceId, name: MIKA.userName, onboarded: true, hardwareBackedKeys: true };

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
    expect(screen.getByTestId('overview-network')).toHaveTextContent(/0 connected · 1 unavailable/);
    expect(screen.queryByTestId('responder-idle')).toBeNull();
  });

  it('hides the limitation pill when a trusted device is connected, and counts peers only from real state', () => {
    renderWithApp(<HomeScreen />, createFakePulseApp({ peers: [peer(MIKA), peer(NOAH, { reach: 'discovered' })] }));
    expect(screen.queryByTestId('network-line')).toBeNull();
    expect(screen.getByTestId('overview-network')).toHaveTextContent(/1 connected · 1 unavailable/);
    expect(screen.getByTestId('responder-idle')).toHaveTextContent(/appear here when they reach this iPhone/);
    expect(screen.queryByText(/alerted|notified/i)).toBeNull();
  });

  it('reports a denied Local Network permission', () => {
    renderWithApp(<HomeScreen />, createFakePulseApp({ peers: [peer(MIKA)], network: { discovery: 'permission_denied', error: null } }));
    expect(screen.getByTestId('network-line')).toHaveTextContent(/Local Network access is denied/);
  });

  it('shows the own active request with its real status and opens the SOS flow', () => {
    const view = viewOf(sosQueued().state);
    renderWithApp(<HomeScreen />, createFakePulseApp({ incidents: [view], peers: [peer(MIKA), peer(NOAH)] }));
    expect(screen.getByTestId(`active-${view.id}`)).toHaveTextContent(/Saved on this device/);
    expect(screen.getByTestId(`active-${view.id}`)).toHaveTextContent(/PULSE-7F3A · Queued/);
    expect(screen.getByTestId('home-badge')).toBeTruthy();
    expect(screen.queryByText(/on the way|notified|alerted/i)).toBeNull();

    fireEvent.press(screen.getByTestId(`active-${view.id}`));
    expect(mockRouter.push).toHaveBeenCalledWith(`/incident/${view.id}`);
    fireEvent.press(screen.getByTestId('request-assistance'));
    expect(mockRouter.push).toHaveBeenCalledWith('/sos');
  });

  it('shows an incoming request to a responder, who can mark it seen', async () => {
    const view = viewOf(sosDelivered().state, MIKA);
    const app = createFakePulseApp({ me: asMika, incidents: [view], peers: [peer(ALEX)] });
    renderWithApp(<HomeScreen />, app);

    const card = screen.getByTestId(`incoming-${view.id}`);
    expect(within(card).getByText('Incoming request')).toBeTruthy();
    expect(within(card).getByText('Someone nearby needs assistance.')).toBeTruthy();
    expect(within(card).getByText(/Manual SOS reported by Alex\./)).toBeTruthy();
    expect(within(card).getByText('Directly from Alex')).toBeTruthy();
    expect(within(card).getByText('Can see everything')).toBeTruthy();
    fireEvent.press(screen.getByTestId(`incoming-ack-${view.id}`));
    expect(app.actions.acknowledge).toHaveBeenCalledWith(view.id);
    await flush();
    fireEvent.press(screen.getByTestId(`incoming-open-${view.id}`));
    expect(mockRouter.push).toHaveBeenCalledWith(`/incident/${view.id}`);
  });

  it('does not offer "mark as seen" twice', () => {
    const view = viewOf(sosAcknowledged().state, MIKA);
    const app = createFakePulseApp({ me: asMika, incidents: [view] });
    renderWithApp(<HomeScreen />, app);
    expect(screen.getByTestId(`incoming-ack-${view.id}`)).toHaveTextContent('Seen');
    fireEvent.press(screen.getByTestId(`incoming-ack-${view.id}`));
    expect(app.actions.acknowledge).not.toHaveBeenCalled();
  });

  it('declines a request only after the confirmation dialog', async () => {
    const view = viewOf(sosDelivered().state, MIKA, { receivedViaName: 'Noah Cruz' });
    const app = createFakePulseApp({ me: asMika, incidents: [view] });
    renderWithApp(<HomeScreen />, app);
    expect(within(screen.getByTestId(`incoming-${view.id}`)).getByText('Relayed through Noah Cruz')).toBeTruthy();

    fireEvent.press(screen.getByTestId(`incoming-decline-${view.id}`));
    expect(app.actions.declineRequest).not.toHaveBeenCalled();
    expect(screen.getByText('The request stays open and your open roles go to someone else.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(app.actions.declineRequest).toHaveBeenCalledWith(view.id);
    await flush();
  });
});

describe('Network', () => {
  it('shows the no-peer states in both segments and a relay chain with only this device', () => {
    renderWithApp(<NetworkScreen />, createFakePulseApp({ peers: [] }));
    expect(screen.getByTestId('discovery-state')).toHaveTextContent('No trusted device paired');
    expect(screen.getByTestId('peers-empty-nearby')).toHaveTextContent(/No nearby device found/);
    fireEvent.press(screen.getByTestId('seg-trusted'));
    expect(screen.getByTestId('peers-empty-trusted')).toHaveTextContent(/No trusted device paired/);
    fireEvent.press(screen.getByTestId('pair-device'));
    expect(mockRouter.push).toHaveBeenCalledWith('/pair');

    const card = screen.getByTestId('relay-card');
    expect(within(card).getByText('Source · this device')).toBeTruthy();
    expect(screen.getByTestId('relay-sub')).toHaveTextContent('No active incident');
    expect(screen.getByTestId('relay-pill')).toHaveTextContent('NO REACHABLE PEER');
    expect(screen.getByTestId('relay-empty')).toHaveTextContent(/reach nobody/);
    expect(screen.queryByText('SIMULATED')).toBeNull();
  });

  it('shows a disconnected trusted peer as not reachable, and not under Nearby', () => {
    renderWithApp(<NetworkScreen />, createFakePulseApp({ peers: [peer(MIKA, { reach: 'unreachable' })] }));
    expect(screen.getByTestId('peers-empty-nearby')).toBeTruthy();
    expect(screen.getByTestId(`relay-node-${MIKA.deviceId}`)).toHaveTextContent(/Not reachable/);
    expect(screen.getByTestId(`relay-link-${MIKA.deviceId}`)).toHaveTextContent(/Not connected/);
    fireEvent.press(screen.getByTestId('seg-trusted'));
    expect(screen.getByTestId(`peer-${MIKA.deviceId}`)).toHaveTextContent(/Not reachable/);
    expect(screen.queryByText('Connected')).toBeNull();
    expect(screen.queryByText('Trusted and connected')).toBeNull();
  });

  it('draws the chain from delivery state: delivered, queued and connected', () => {
    const view = viewOf(sosDelivered().state);
    renderWithApp(<NetworkScreen />, createFakePulseApp({ incidents: [view], peers: [peer(MIKA), peer(NOAH, { reach: 'unreachable' })] }));
    expect(screen.getByTestId('relay-sub')).toHaveTextContent('PULSE-7F3A · Delivered');
    expect(screen.getByTestId('relay-pill')).toHaveTextContent('1 CONNECTED');
    expect(screen.getByTestId(`relay-node-${MIKA.deviceId}`)).toHaveTextContent(/Packet delivered/);
    expect(screen.getByTestId(`relay-link-${MIKA.deviceId}`)).toHaveTextContent(/Direct local connection/);
    expect(screen.getByTestId(`relay-node-${NOAH.deviceId}`)).toHaveTextContent(/Awaiting reconnection/);
  });

  it('shows a connected trusted peer with no incident as trusted and connected', () => {
    renderWithApp(<NetworkScreen />, createFakePulseApp({ peers: [peer(MIKA), peer(NOAH, { reach: 'discovered' })] }));
    expect(screen.getByTestId(`relay-node-${MIKA.deviceId}`)).toHaveTextContent(/Trusted and connected/);
    expect(screen.getByTestId(`relay-node-${NOAH.deviceId}`)).toHaveTextContent(/Nearby · not connected/);
    expect(screen.queryByText(/Packet delivered|Sending/)).toBeNull();
  });

  it('explains a denied Local Network permission', () => {
    renderWithApp(<NetworkScreen />, createFakePulseApp({ network: { discovery: 'permission_denied', error: null } }));
    expect(screen.getByTestId('discovery-state')).toHaveTextContent(/Local Network access is denied/);
    expect(screen.getByTestId('permission-denied')).toHaveTextContent(/SAGIP is not allowed to use the local network/);
  });

  it('offers to turn discovery on when it is off', () => {
    const app = createFakePulseApp({ network: { discovery: 'off', error: null } });
    renderWithApp(<NetworkScreen />, app);
    expect(screen.getByTestId('discovery-state')).toHaveTextContent('Discovery is off');
    fireEvent.press(screen.getByTestId('discovery-on'));
    expect(app.actions.setDiscovery).toHaveBeenCalledWith(true);
  });

  it('shows the path a received request really took', () => {
    const view = viewOf(sosDelivered().state, MIKA, { receivedViaName: 'Noah Cruz' });
    renderWithApp(<NetworkScreen />, createFakePulseApp({ me: { ...asMika, hardwareBackedKeys: null }, incidents: [view] }));
    expect(screen.getByTestId('relay-card')).toHaveTextContent(/Alex Rivera/);
    expect(screen.getByTestId('relay-card')).toHaveTextContent(/Noah Cruz/);
    expect(screen.getByTestId('relay-link-via')).toHaveTextContent(/Forwarded incident/);
    expect(screen.getByTestId('relay-node-me')).toHaveTextContent(/Received · this device/);
  });

  it('shows Simulation controls only in Demo and drives the simulated links', () => {
    const live = renderWithApp(<NetworkScreen />, createFakePulseApp({ peers: [peer(MIKA)] }));
    expect(screen.queryByTestId('sim-controls')).toBeNull();
    live.unmount();

    const demo = { viewingAs: 'alex' as const, aiReady: true, links: { mika: true, noah: false }, runningScenario: null, scenarios: [] };
    const app = createFakePulseApp({ mode: 'demo', demo, peers: [peer(MIKA)] });
    renderWithApp(<NetworkScreen />, app);
    expect(screen.getByTestId('relay-pill')).toHaveTextContent('SIMULATED');
    expect(screen.queryByTestId('sim-mika-off')).toBeNull();
    fireEvent.press(screen.getByTestId('sim-toggle'));
    fireEvent.press(screen.getByTestId('sim-mika-off'));
    expect(app.actions.demo.setLink).toHaveBeenCalledWith('mika', false);
    expect(screen.getByTestId('sim-noah')).toHaveTextContent('Reconnect Noah');
    fireEvent.press(screen.getByTestId('sim-noah'));
    expect(app.actions.demo.setLink).toHaveBeenCalledWith('noah', true);
    fireEvent.press(screen.getByTestId('sim-ai'));
    expect(app.actions.demo.setAIReady).toHaveBeenCalledWith(false);
    fireEvent.press(screen.getByTestId('sim-reset'));
    expect(app.actions.demo.reset).toHaveBeenCalledTimes(1);
  });

  it('pairs, renames and removes from the peer sheet', async () => {
    const app = createFakePulseApp({ peers: [peer(MIKA), peer(NOAH, { trusted: false, reach: 'discovered' })] });
    renderWithApp(<NetworkScreen />, app);

    fireEvent.press(screen.getByTestId(`peer-${NOAH.deviceId}`));
    expect(within(screen.getByTestId('peer-sheet')).getByText('Not paired')).toBeTruthy();
    expect(screen.queryByTestId('peer-remove')).toBeNull();
    fireEvent.press(screen.getByTestId('peer-pair'));
    expect(app.actions.startPairing).toHaveBeenCalledWith(NOAH.deviceId);
    await flush();
    expect(mockRouter.push).toHaveBeenCalledWith('/pair');

    fireEvent.press(screen.getByTestId(`peer-${MIKA.deviceId}`));
    expect(screen.queryByTestId('peer-pair')).toBeNull();
    fireEvent.press(screen.getByTestId('peer-rename'));
    fireEvent.changeText(screen.getByTestId('rename-input'), '  Mika S ');
    fireEvent.press(screen.getByTestId('rename-save'));
    expect(app.actions.renamePeer).toHaveBeenCalledWith(MIKA.deviceId, 'Mika S');

    fireEvent.press(screen.getByTestId('peer-remove'));
    expect(app.actions.removePeer).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(app.actions.removePeer).toHaveBeenCalledWith(MIKA.deviceId);
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
