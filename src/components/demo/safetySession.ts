import { create } from 'zustand';

/**
 * SIMULATION ONLY. Local state for the design's Safety Session and unusual-movement check-in. Nothing
 * here reads a sensor, touches the service layer or exists outside Demo mode.
 */
type SafetySessionState = {
  active: boolean;
  startMs: number;
  shareLocation: boolean;
  /** The unusual-movement sheet is open. */
  anomalyOpen: boolean;
  start: () => void;
  end: () => void;
  toggleShareLocation: () => void;
  openAnomaly: () => void;
  closeAnomaly: () => void;
  reset: () => void;
};

export const useSafetySession = create<SafetySessionState>((set) => ({
  active: false,
  startMs: 0,
  shareLocation: true,
  anomalyOpen: false,
  start: () => set({ active: true, startMs: Date.now() }),
  end: () => set({ active: false, startMs: 0 }),
  toggleShareLocation: () => set((s) => ({ shareLocation: !s.shareLocation })),
  openAnomaly: () => set({ anomalyOpen: true }),
  closeAnomaly: () => set({ anomalyOpen: false }),
  reset: () => set({ active: false, startMs: 0, shareLocation: true, anomalyOpen: false }),
}));

/** "04:07" */
export function clock(elapsedSeconds: number): string {
  const s = Math.max(0, Math.floor(elapsedSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const SESSION_CHECKIN_SECONDS = 900;
