import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';

import type { PulseActions, PulseApp, PulseSnapshot } from './api';

const PulseContext = createContext<PulseApp | null>(null);

export function PulseProvider({ app, children }: { app: PulseApp; children: ReactNode }) {
  return <PulseContext.Provider value={app}>{children}</PulseContext.Provider>;
}

function useApp(): PulseApp {
  const app = useContext(PulseContext);
  if (!app) throw new Error('PulseProvider is missing');
  return app;
}

/** Subscribes to the current app (live or demo). Snapshots are immutable; a new object means something changed. */
export function usePulse(): PulseSnapshot {
  const app = useApp();
  return useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
}

export function usePulseActions(): PulseActions {
  return useApp().actions;
}
