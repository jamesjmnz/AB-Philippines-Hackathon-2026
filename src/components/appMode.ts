import { create } from 'zustand';

import type { AppMode } from '@/services/api';

type AppModeState = { mode: AppMode; setMode: (mode: AppMode) => void };

/**
 * The single switch between the LIVE and DEMO adapter bundles. `AppRoot` reads it to decide which
 * factory to call; Demo Lab is the only screen that writes it. The app always starts in live mode.
 */
export const useAppMode = create<AppModeState>((set) => ({
  mode: 'live',
  setMode: (mode) => set({ mode }),
}));
