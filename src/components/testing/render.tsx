import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { PulseProvider } from '@/services/PulseProvider';
import { OverlayHost, ToastHost } from '@/ui';

import type { FakePulseApp } from './fakePulseApp';

/** Mounts a screen the way the shell does: inside the provider, with the overlay and toast hosts after it. */
export function renderWithApp(ui: ReactElement, app: FakePulseApp) {
  return render(
    <PulseProvider app={app}>
      {ui}
      <OverlayHost />
      <ToastHost />
    </PulseProvider>,
  );
}
