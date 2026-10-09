import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { PulseProvider } from '@/services/PulseProvider';

import type { FakePulseApp } from './fakePulseApp';

export function renderWithApp(ui: ReactElement, app: FakePulseApp) {
  return render(<PulseProvider app={app}>{ui}</PulseProvider>);
}
