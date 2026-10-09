import '../testing/mocks';

import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { PulseShell } from '../AppRoot';
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
    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(screen.queryByText('content')).toBeNull();
  });
});
