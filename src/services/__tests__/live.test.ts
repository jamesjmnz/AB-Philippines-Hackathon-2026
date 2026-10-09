import { createMemoryIncidentRepository, type IncidentRepository } from '@/storage';

import { createLiveApp } from '../live';

/**
 * LIVE wiring, with every native module replaced: storage by the in-memory repository and the rest
 * by modules that fail to load. This checks the composition (lazy imports, fallbacks, SOS path), not
 * any native behaviour.
 */
const mockState: { repo: IncidentRepository | null; storage: Map<string, string>; openFails: boolean } = {
  repo: null,
  storage: new Map(),
  openFails: false,
};

jest.mock('@/storage/expoDriver', () => ({
  openExpoIncidentRepository: async () => {
    if (mockState.openFails || !mockState.repo) throw new Error('cannot open database');
    return { repository: mockState.repo, close: async () => undefined };
  },
}));
jest.mock('expo-sqlite/kv-store', () => ({
  Storage: {
    getItemAsync: async (key: string) => mockState.storage.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => void mockState.storage.set(key, value),
    removeItemAsync: async (key: string) => mockState.storage.delete(key),
  },
}));
jest.mock('expo-device', () => ({ modelName: 'iPhone 17 Pro Max', osVersion: '26.0' }));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
});
jest.mock('@/ai/callstack', () => {
  throw new Error('native AI module missing');
});
jest.mock('@/transport/NativePeerTransport', () => {
  throw new Error('native peer module missing');
});
jest.mock('@/crypto/NativeCapsuleCrypto', () => {
  throw new Error('native crypto module missing');
});

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  if (!check()) throw new Error('condition not reached');
}

describe('createLiveApp', () => {
  beforeEach(() => {
    mockState.repo = createMemoryIncidentRepository();
    mockState.storage = new Map();
    mockState.openFails = false;
  });

  it('starts in live mode, and an SOS persists even though AI, radio and crypto modules failed to load', async () => {
    const app = await createLiveApp();
    try {
      expect(app.getSnapshot()).toMatchObject({ mode: 'live', demo: null });
      // The SOS does not wait for readiness.
      const sos = await app.actions.sendSOS();
      if (!sos.ok) throw new Error(sos.code);
      expect(sos.value.incidentId).toMatch(/^inc-[0-9a-f-]{36}$/);
      expect(await mockState.repo?.allIncidentIds()).toEqual([sos.value.incidentId]);

      await waitFor(() => app.getSnapshot().ready);
      const snapshot = app.getSnapshot();
      expect(snapshot.incidents.map((i) => [i.id, i.role, i.state.status.reason])).toEqual([[sos.value.incidentId, 'reporter', 'no_trusted_peer']]);
      // Nothing is dressed up as working: capabilities report the failure, and nothing is simulated.
      expect(snapshot.capabilities).toMatchObject({ provider: 'Callstack Apple', source: 'callstack-apple', text: { state: 'native_error' }, device: { model: 'iPhone 17 Pro Max' } });
      expect(snapshot.me.hardwareBackedKeys).toBeNull();
      expect(snapshot.peers).toEqual([]);
      const report = await app.actions.addReport(sos.value.incidentId, 'second floor near the stairs', 'typed');
      if (!report.ok) throw new Error(report.code);
      expect(await app.actions.analyzeReport(sos.value.incidentId, report.value.reportId)).toMatchObject({ ok: false, state: 'native_error' });
      expect(await app.actions.startPairing('dev-00000000000000000000')).toMatchObject({ ok: false });

      await app.actions.completeOnboarding({ name: 'Alex' });
      await waitFor(() => app.getSnapshot().network.discovery === 'error');
      // Persisted under the live prefix, and no demo actions have any effect.
      expect([...mockState.storage.keys()].every((key) => key.startsWith('pulse.live.'))).toBe(true);
      expect(mockState.storage.get('pulse.live.profile')).toContain('"onboarded":true');
      const before = app.getSnapshot();
      app.actions.demo.viewAs('mika');
      app.actions.demo.runScenario('normal');
      app.actions.demo.reset();
      expect(app.getSnapshot()).toBe(before);
    } finally {
      await app.dispose();
    }
  });

  it('rejects when on-device storage cannot be opened', async () => {
    mockState.openFails = true;
    await expect(createLiveApp()).rejects.toThrow();
  });
});
