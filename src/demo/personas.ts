import type { DisclosureLevel } from '@/domain';
import type { DemoDevice } from '@/services/api';

/** SIMULATED people and phones for the Demo Lab. None of them is a real person or a measured device. */
export interface DemoPersona {
  key: DemoDevice;
  name: string;
  firstName: string;
  deviceModel: string;
  osVersion: string;
  /** Whether the simulated on-device text model runs on this phone. */
  textModel: boolean;
}

export const DEMO_PERSONAS: Record<DemoDevice, DemoPersona> = {
  alex: { key: 'alex', name: 'Alex Rivera', firstName: 'Alex', deviceModel: 'iPhone 17 Pro Max', osVersion: '26.0', textModel: true },
  mika: { key: 'mika', name: 'Mika Santos', firstName: 'Mika', deviceModel: 'iPhone 14 Pro Max', osVersion: '26.0', textModel: false },
  noah: { key: 'noah', name: 'Noah Cruz', firstName: 'Noah', deviceModel: 'iPhone 13', osVersion: '26.0', textModel: false },
};

export const DEMO_DEVICES: readonly DemoDevice[] = ['alex', 'mika', 'noah'];

/**
 * Default disclosure level each device grants the others, as in the design: the first responder is
 * `trusted` (summary), the second `authorized` (everything the requester chose to share).
 */
export const DEMO_LEVELS: Record<DemoDevice, Partial<Record<DemoDevice, DisclosureLevel>>> = {
  alex: { mika: 'trusted', noah: 'authorized' },
  mika: { alex: 'trusted', noah: 'authorized' },
  noah: { alex: 'trusted', mika: 'authorized' },
};

/** The spoken report used by the design's scripted scenarios (Taglish). Synthetic. */
export const SAMPLE_REPORT = 'Nadulas ako sa hagdan sa Building B. Masakit paa ko at kailangan ko ng tulong.';

/**
 * Statements for the incident-updates scenario. Synthetic. The move is in the first person because the
 * wording rules read nothing else as a move.
 */
export const DELTA_STATEMENTS = {
  report: 'I slipped on the stairs. I am on the second floor of Building B.',
  sameFloor: 'I think Alex is on the second floor.',
  moved: 'I moved from the second floor to the third floor.',
  otherFloor: 'I think Alex is on the fourth floor.',
  resolvedFloor: 'Third floor',
} as const;

/**
 * Simulated radio topology, as in the design: Alex reaches Mika directly, and Noah only through
 * Mika. `links.mika` is the Alex–Mika link and `links.noah` is the Mika–Noah link.
 */
export const DEMO_LINKS: Record<Exclude<DemoDevice, 'alex'>, readonly [DemoDevice, DemoDevice]> = {
  mika: ['alex', 'mika'],
  noah: ['mika', 'noah'],
};
