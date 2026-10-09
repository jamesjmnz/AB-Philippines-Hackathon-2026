import { mockRouter } from '../testing/mocks';

import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { useSafetySession } from '../demo/safetySession';
import { HomeScreen } from '../home/HomeScreen';
import { capabilities, createFakePulseApp, peer, viewOf } from '../testing/fakePulseApp';
import { renderWithApp } from '../testing/render';
import { MIKA, NOAH, sosDelivered, sosQueued, sosRoleTaken } from '../testing/scenarios';

const DEMO = { viewingAs: 'alex' as const, aiReady: true, links: { mika: true, noah: true }, runningScenario: null, scenarios: [] };

beforeEach(() => {
  jest.clearAllMocks();
  act(() => useSafetySession.getState().reset());
});

describe('Home readiness card', () => {
  it.each([
    ['0 of 3 ready', capabilities('unavailable'), [], 'Local AI unavailable · 0 trusted · No reachable peer'],
    ['2 of 3 ready', capabilities('ready'), [peer(MIKA, { reach: 'unreachable' })], 'Local AI ready · 1 trusted · No reachable peer'],
    ['3 of 3 ready', capabilities('ready'), [peer(MIKA), peer(NOAH)], 'Local AI ready · 2 trusted · 2 reachable now'],
  ] as const)('shows "%s" as a count of three capability facts', (title, caps, peers, line) => {
    renderWithApp(<HomeScreen />, createFakePulseApp({ capabilities: caps, peers: [...peers] }));
    expect(screen.getByTestId('readiness-title')).toHaveTextContent(title);
    expect(screen.getByTestId('readiness-line')).toHaveTextContent(line);
    expect(screen.getByTestId('readiness-card').props.accessibilityLabel).toMatch(/On-device text model ready: (done|not yet)/);
    // A count of facts, never a verdict or a guarantee.
    expect(screen.queryByText(/4 of 4|Limited|Relay ready|protected|you are safe|guarantee/i)).toBeNull();
    expect(screen.queryByText('Ready')).toBeNull();
  });

  it('says the model is still being checked rather than inventing a result', () => {
    renderWithApp(<HomeScreen />, createFakePulseApp({ capabilities: null }));
    expect(screen.getByTestId('readiness-line')).toHaveTextContent(/Local AI checking/);
    expect(screen.getByTestId('overview-intelligence')).toHaveTextContent(/Checking this iPhone/);
  });
});

describe('Home map cards', () => {
  it('Live: draws the map under the veil with the reported words and no pins', () => {
    const view = viewOf(sosQueued().state);
    renderWithApp(<HomeScreen />, createFakePulseApp({ incidents: [view], peers: [peer(MIKA)] }));
    const card = screen.getByTestId(`active-${view.id}`);
    expect(within(card).getByTestId('map-veil')).toBeTruthy();
    expect(within(card).getByTestId('map-label')).toHaveTextContent('Location not stated');
    expect(within(card).queryByTestId('map-pin-request')).toBeNull();
  });

  it('Demo: draws the request pin and no veil', () => {
    const view = viewOf(sosQueued().state);
    renderWithApp(<HomeScreen />, createFakePulseApp({ mode: 'demo', demo: DEMO, incidents: [view], peers: [peer(MIKA)] }));
    const card = screen.getByTestId(`active-${view.id}`);
    fireEvent(within(card).getByTestId(`map-${view.id}`), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 340, height: 180 } } });
    expect(within(card).getByTestId('map-pin-request')).toBeTruthy();
    expect(within(card).queryByTestId('map-veil')).toBeNull();
  });

  it('shows the map on an incoming request in Live with the veil as well', () => {
    const view = viewOf(sosDelivered().state, MIKA);
    renderWithApp(<HomeScreen />, createFakePulseApp({ me: { deviceId: MIKA.deviceId, name: MIKA.userName, onboarded: true, hardwareBackedKeys: true }, incidents: [view] }));
    const card = screen.getByTestId(`incoming-${view.id}`);
    expect(within(card).getByTestId('map-veil')).toBeTruthy();
    expect(within(card).queryByTestId('map-pin-request')).toBeNull();
  });
});

describe('Home overview', () => {
  it('counts active requests and roles from the ledger and opens the first active one', () => {
    const view = viewOf(sosRoleTaken().state, undefined, { pendingOutbox: 2 });
    renderWithApp(<HomeScreen />, createFakePulseApp({ incidents: [view], peers: [peer(MIKA), peer(NOAH, { reach: 'unreachable' })] }));
    expect(screen.getByTestId('overview-carechain')).toHaveTextContent(/1 active · 1 role taken/);
    expect(screen.getByTestId('overview-dot-carechain')).toBeTruthy();
    expect(screen.getByTestId('overview-network')).toHaveTextContent(/1 connected · 1 unavailable · 2 pending/);
    expect(screen.getByTestId('overview-dot-network')).toBeTruthy();
    fireEvent.press(screen.getByTestId('overview-carechain'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/incident/${view.id}`);
    fireEvent.press(screen.getByTestId('overview-network'));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/network');
  });

  it('goes to Activity when nothing is active and has no Safety Session row in Live', () => {
    renderWithApp(<HomeScreen />, createFakePulseApp());
    expect(screen.getByTestId('overview-carechain')).toHaveTextContent(/No active incidents/);
    expect(screen.queryByTestId('home-badge')).toBeNull();
    fireEvent.press(screen.getByTestId('overview-carechain'));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/activity');
    expect(screen.queryByTestId('overview-session')).toBeNull();
    expect(screen.queryByText('Safety Session')).toBeNull();
  });

  it('shows the simulated Safety Session row only in Demo', () => {
    renderWithApp(<HomeScreen />, createFakePulseApp({ mode: 'demo', demo: DEMO, capabilities: capabilities('ready', 'simulated') }));
    expect(screen.getByTestId('overview-session')).toHaveTextContent(/Not active/);
    act(() => useSafetySession.getState().start());
    expect(screen.getByTestId('overview-session')).toHaveTextContent(/Active · 00:0\d/);
    fireEvent.press(screen.getByTestId('overview-session'));
    expect(mockRouter.push).toHaveBeenCalledWith('/demo-lab/session');
    expect(screen.getByTestId('overview-intelligence')).toHaveTextContent(/Simulation · no cloud AI/);
  });

  it('opens On-Device Intelligence with provider, device, each capability and the SOS note', () => {
    const app = createFakePulseApp({ capabilities: capabilities('unavailable') });
    renderWithApp(<HomeScreen />, app);
    expect(screen.getByTestId('overview-intelligence')).toHaveTextContent(/Unavailable · manual SOS still works/);
    expect(screen.queryByTestId('intelligence-provider')).toBeNull();

    fireEvent.press(screen.getByTestId('overview-intelligence'));
    expect(screen.getByTestId('intelligence-provider')).toHaveTextContent(/Callstack Apple/);
    expect(screen.getByTestId('intelligence-device')).toHaveTextContent(/iPhone 16 Pro · iOS 26\.0/);
    expect(screen.getByTestId('intelligence-text')).toHaveTextContent(/Unavailable/);
    expect(screen.getByTestId('intelligence-embeddings')).toHaveTextContent(/Ready offline/);
    expect(screen.getByTestId('intelligence-transcription')).toHaveTextContent(/Unsupported locale/);
    expect(screen.getByTestId('intelligence-speech')).toHaveTextContent(/Ready offline/);
    expect(screen.getByTestId('intelligence-sos-note')).toHaveTextContent(/Manual SOS works without it/);
    fireEvent.press(screen.getByTestId('intelligence-refresh'));
    expect(app.actions.refreshCapabilities).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('intelligence-done'));
    expect(screen.queryByTestId('intelligence-provider')).toBeNull();
  });

  it('names Simulation as the provider in Demo', () => {
    renderWithApp(<HomeScreen />, createFakePulseApp({ mode: 'demo', demo: DEMO, capabilities: capabilities('ready', 'simulated') }));
    fireEvent.press(screen.getByTestId('overview-intelligence'));
    expect(screen.getByTestId('intelligence-provider')).toHaveTextContent(/Simulation/);
    expect(screen.getByTestId('intelligence-text')).toHaveTextContent(/Simulation/);
  });
});
