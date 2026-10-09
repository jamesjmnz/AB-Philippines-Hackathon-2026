import { mockRouter } from '../testing/mocks';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal, Text } from 'react-native';

import { Dialog, Sheet, useToast } from '@/ui';

import { PulseShell } from '../AppRoot';
import { useSafetySession } from '../demo/safetySession';
import { createFakePulseApp } from '../testing/fakePulseApp';

describe('PulseShell', () => {
  it('shows the SIMULATED bar in demo mode', () => {
    const app = createFakePulseApp({ mode: 'demo' });
    render(
      <PulseShell app={app}>
        <Text>content</Text>
      </PulseShell>,
    );
    expect(screen.getByTestId('simulated-bar')).toBeTruthy();
    expect(screen.getByText('SIMULATED')).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('does not show the SIMULATED bar in live mode', () => {
    const app = createFakePulseApp({ mode: 'live' });
    render(
      <PulseShell app={app}>
        <Text>content</Text>
      </PulseShell>,
    );
    expect(screen.queryByTestId('simulated-bar')).toBeNull();
    expect(screen.queryByText('SIMULATED')).toBeNull();
  });

  it('shows a neutral starting screen until the snapshot is ready', () => {
    const app = createFakePulseApp({ ready: false });
    render(
      <PulseShell app={app}>
        <Text>content</Text>
      </PulseShell>,
    );
    // The loading state is the design's splash: logo, wordmark and tagline, never data.
    expect(screen.getByTestId('starting-screen')).toBeTruthy();
    expect(screen.getByText('SAGIP')).toBeTruthy();
    expect(screen.getByText('Intelligence that stays with you.')).toBeTruthy();
    expect(screen.queryByText('content')).toBeNull();
    expect(screen.queryByText(/PULSE/)).toBeNull();
  });
});

describe('overlays', () => {
  function Probe({ sheet, dialog }: { sheet: boolean; dialog: boolean }) {
    return (
      <>
        <Text>content</Text>
        <Sheet visible={sheet} onClose={() => undefined}>
          <Text>sheet body</Text>
        </Sheet>
        <Dialog visible={dialog} title="Sure?" message="Really" cancelLabel="No" confirmLabel="Yes" onCancel={() => undefined} onConfirm={() => undefined} />
      </>
    );
  }

  /** True when `node` is rendered somewhere under the element with this testID. */
  function isInside(node: ReturnType<typeof screen.getByText>, testID: string): boolean {
    for (let p: typeof node | null = node; p; p = p.parent) if (p.props.testID === testID) return true;
    return false;
  }

  it('draws sheets and dialogs in the shell, after the SIMULATED bar, never in a native Modal', () => {
    const app = createFakePulseApp({ mode: 'demo' });
    render(
      <PulseShell app={app}>
        <Probe sheet dialog />
      </PulseShell>,
    );
    expect(screen.getByTestId('simulated-bar')).toBeTruthy();
    expect(isInside(screen.getByText('sheet body'), 'overlay-host')).toBe(true);
    expect(isInside(screen.getByText('Sure?'), 'overlay-host')).toBe(true);
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
    // The bar is a sibling drawn before the area that holds the overlays, so they cannot cover it.
    const json = JSON.stringify(screen.toJSON());
    expect(json.indexOf('simulated-bar')).toBeLessThan(json.indexOf('overlay-host'));
  });

  it('removes the overlay when it closes', () => {
    const app = createFakePulseApp();
    const view = render(
      <PulseShell app={app}>
        <Probe sheet dialog={false} />
      </PulseShell>,
    );
    expect(screen.getByText('sheet body')).toBeTruthy();
    view.rerender(
      <PulseShell app={app}>
        <Probe sheet={false} dialog={false} />
      </PulseShell>,
    );
    expect(screen.queryByText('sheet body')).toBeNull();
    expect(screen.queryByTestId('overlay-host')).toBeNull();
  });

  it('shows a toast in the design pill and clears it after 2.6 seconds', () => {
    jest.useFakeTimers();
    const app = createFakePulseApp();
    render(
      <PulseShell app={app}>
        <Text>content</Text>
      </PulseShell>,
    );
    act(() => useToast.getState().show('Saved', 'check_circle'));
    expect(screen.getByTestId('toast')).toHaveTextContent('Saved');
    act(() => jest.advanceTimersByTime(2600));
    expect(screen.queryByTestId('toast')).toBeNull();
    jest.useRealTimers();
  });
});

describe('unusual-movement sheet (simulation)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    act(() => useSafetySession.getState().reset());
  });
  afterEach(() => {
    act(() => useSafetySession.getState().reset());
    jest.useRealTimers();
  });

  it('never appears in Live mode, even if something tries to open it', () => {
    const app = createFakePulseApp({ mode: 'live' });
    render(
      <PulseShell app={app}>
        <Text>content</Text>
      </PulseShell>,
    );
    act(() => useSafetySession.getState().openAnomaly());
    expect(screen.queryByText('Unusual movement detected')).toBeNull();
    act(() => jest.advanceTimersByTime(15000));
    expect(app.actions.sendSOS).not.toHaveBeenCalled();
  });

  it('counts down from 10 under the SIMULATED bar and closes on "I’m okay" without creating anything', () => {
    const app = createFakePulseApp({ mode: 'demo' });
    render(
      <PulseShell app={app}>
        <Text>content</Text>
      </PulseShell>,
    );
    act(() => useSafetySession.getState().openAnomaly());
    expect(screen.getByTestId('simulated-bar')).toBeTruthy();
    expect(screen.getByText('SIMULATION')).toBeTruthy();
    expect(screen.getByText('Unusual movement detected')).toBeTruthy();
    expect(screen.getByText('Are you okay?')).toBeTruthy();
    expect(screen.getByLabelText('10 seconds to respond')).toBeTruthy();
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.getByLabelText('9 seconds to respond')).toBeTruthy();

    fireEvent.press(screen.getByTestId('anomaly-ok'));
    expect(screen.queryByText('Unusual movement detected')).toBeNull();
    act(() => jest.advanceTimersByTime(20000));
    expect(app.actions.sendSOS).not.toHaveBeenCalled();
  });

  it('saves a simulated request through the Demo app when assistance is asked for', async () => {
    const app = createFakePulseApp({ mode: 'demo' });
    render(
      <PulseShell app={app}>
        <Text>content</Text>
      </PulseShell>,
    );
    act(() => useSafetySession.getState().openAnomaly());
    fireEvent.press(screen.getByTestId('anomaly-help'));
    expect(app.actions.sendSOS).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockRouter.push).toHaveBeenCalledWith('/incident/inc-test-0001');
  });
});
