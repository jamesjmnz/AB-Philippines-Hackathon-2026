import type { LocalAIService } from '@/ai';
import type { CapsuleCrypto } from '@/crypto/types';
import { createSequentialIds } from '@/domain';
import { createMemoryIncidentRepository } from '@/storage';
import type { PeerRecord } from '@/sync/types';
import type { PeerTransport } from '@/transport/types';

import { createMemoryKeyValueStore } from '../kv';
import { PulseCore } from '../PulseCore';
import { ManualClock, createInertTimers } from '../testing/harness';

const never = <T>() => new Promise<T>(() => undefined);

type Mode = 'hang' | 'throw';

function brokenAI(mode: Mode): LocalAIService {
  const fail = () => (mode === 'hang' ? never<never>() : Promise.reject(new Error('ai exploded')));
  return {
    inspectCapabilities: fail,
    extractIncidentReport: fail,
    suggestClarification: fail,
    findConflicts: fail,
    proposeNonMedicalTasks: fail,
    compareSemanticReports: fail,
    transcribeLocal: fail,
  };
}

function brokenTransport(mode: Mode): PeerTransport {
  const fail = () => (mode === 'hang' ? never<void>() : Promise.reject(new Error('radio exploded')));
  const subscribe = () => {
    if (mode === 'throw') throw new Error('no native module');
    return () => undefined;
  };
  return {
    startDiscovery: fail,
    stopDiscovery: fail,
    connect: fail,
    disconnect: fail,
    sendOpaquePacket: fail,
    onPeerFound: subscribe,
    onPeerLost: subscribe,
    onConnectionState: subscribe,
    onOpaquePacket: subscribe,
    onError: subscribe,
    stop: async () => undefined,
  };
}

function brokenCrypto(mode: Mode): CapsuleCrypto {
  const fail = () => (mode === 'hang' ? never<never>() : Promise.reject(new Error('keychain exploded')));
  return {
    createOrLoadIdentity: fail,
    exportPublicPairingMaterial: fail,
    verifyPeerPairing: fail,
    encryptForRecipients: fail,
    verifyEnvelope: fail,
    decryptAuthorized: fail,
    signEvent: fail,
    verifyEventSignature: fail,
  };
}

const PEER: PeerRecord = {
  deviceId: 'dev-aaaaaaaaaaaaaaaaaaaa',
  name: 'Mika',
  level: 'trusted',
  material: { v: 1, deviceId: 'dev-aaaaaaaaaaaaaaaaaaaa', signKey: 's'.repeat(44), agreeKey: 'a'.repeat(44) },
  pairedAtMs: 0,
};

function build(mode: Mode, options: { peers?: PeerRecord[]; cachedId?: string } = {}) {
  const repo = createMemoryIncidentRepository();
  const kv = createMemoryKeyValueStore(
    options.cachedId
      ? { profile: JSON.stringify({ deviceId: options.cachedId, aliases: [], provisional: false, name: 'Alex', onboarded: true, hardwareBacked: true }) }
      : {},
  );
  const core = new PulseCore({
    mode: 'live',
    repo,
    ai: brokenAI(mode),
    transport: brokenTransport(mode),
    crypto: brokenCrypto(mode),
    kv,
    clock: new ManualClock(),
    ids: createSequentialIds('alex'),
    deviceInfo: { model: 'Test iPhone', osVersion: '0' },
    timers: createInertTimers(),
    seed: { name: 'Alex', onboarded: true, peers: options.peers ?? [] },
  });
  return { core, repo, kv };
}

describe('manual SOS never depends on AI, radio, keychain or permissions', () => {
  it.each(['hang', 'throw'] as const)('persists and returns with zero peers when everything else would %s', async (mode) => {
    const { core, repo } = build(mode);
    // Startup is not awaited: with hanging dependencies it never finishes on its own.
    void core.start().catch(() => undefined);

    const result = await core.actions.sendSOS();
    if (!result.ok) throw new Error(result.code);
    const state = await repo.replay(result.value.incidentId);
    expect(state.incident?.source).toBe('manual_sos');
    expect(state.status).toEqual({ status: 'queued', reason: 'no_trusted_peer' });
    expect(state.claims.assistanceRequested.value).toBe('yes');
    // The snapshot shows it immediately as this device's own request.
    const view = core.getSnapshot().incidents.find((i) => i.id === result.value.incidentId);
    expect(view).toMatchObject({ role: 'reporter', access: 'owner' });
    await core.dispose();
  });

  it.each(['hang', 'throw'] as const)('persists, queues for every trusted peer and returns when sealing and sending %s', async (mode) => {
    const { core, repo } = build(mode, { peers: [PEER], cachedId: 'dev-bbbbbbbbbbbbbbbbbbbb' });
    void core.start().catch(() => undefined);

    const result = await core.actions.sendSOS({ incidentType: 'Manual SOS' });
    if (!result.ok) throw new Error(result.code);
    const state = await repo.replay(result.value.incidentId);
    expect(state.incident?.reporter.deviceId).toBe('dev-bbbbbbbbbbbbbbbbbbbb');
    expect(state.recipients.map((r) => r.deviceId)).toEqual([PEER.deviceId]);
    // Queued, and honestly so: nothing was attempted, nothing is shown as sent or delivered.
    expect(state.status).toEqual({ status: 'queued', reason: 'awaiting_peer' });
    expect(await repo.getPendingOutbox(result.value.incidentId)).toHaveLength(1);
    expect(state.events.map((e) => e.type)).toEqual(['INCIDENT_CREATED']);

    // The rest of the report flow that does not need AI still works.
    const report = await core.actions.addReport(result.value.incidentId, 'I am near the stairs on the second floor.', 'typed');
    expect(report.ok).toBe(true);
    expect((await repo.replay(result.value.incidentId)).claims.floor.value).toBe('Second floor');
    await core.dispose();
  });

  it('returns typed AI failures instead of throwing when the model errors', async () => {
    const { core } = build('throw', { cachedId: 'dev-bbbbbbbbbbbbbbbbbbbb' });
    void core.start().catch(() => undefined);
    const sos = await core.actions.sendSOS();
    if (!sos.ok) throw new Error(sos.code);
    const report = await core.actions.addReport(sos.value.incidentId, 'Help please', 'typed');
    if (!report.ok) throw new Error(report.code);
    expect(await core.actions.analyzeReport(sos.value.incidentId, report.value.reportId)).toMatchObject({ ok: false, state: 'native_error' });
    expect(await core.actions.suggestClarification(sos.value.incidentId)).toMatchObject({ ok: false, state: 'native_error' });
    expect(await core.actions.suggestTasks(sos.value.incidentId)).toMatchObject({ ok: false, state: 'native_error' });
    await core.dispose();
  });

  it('uses a provisional id when the keychain never answers, and keeps owning the incident once it does', async () => {
    const repo = createMemoryIncidentRepository();
    const kv = createMemoryKeyValueStore();
    let release: (value: { deviceId: string; hardwareBacked: boolean }) => void = () => undefined;
    const crypto: CapsuleCrypto = {
      ...brokenCrypto('throw'),
      createOrLoadIdentity: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    const core = new PulseCore({
      mode: 'live',
      repo,
      ai: brokenAI('throw'),
      transport: brokenTransport('throw'),
      crypto,
      kv,
      clock: new ManualClock(),
      ids: createSequentialIds('alex'),
      deviceInfo: { model: 'Test iPhone', osVersion: '0' },
      timers: createInertTimers(),
      seed: { name: 'Alex', onboarded: true },
    });
    void core.start();
    const result = await core.actions.sendSOS();
    if (!result.ok) throw new Error(result.code);
    const provisional = core.getSnapshot().me.deviceId;
    expect(provisional).toMatch(/^dev-[0-9a-f]{20}$/);

    release({ deviceId: 'dev-cccccccccccccccccccc', hardwareBacked: true });
    await core.start();
    await core.whenIdle();
    expect(core.getSnapshot().me).toMatchObject({ deviceId: 'dev-cccccccccccccccccccc', hardwareBackedKeys: true });
    const view = core.getSnapshot().incidents.find((i) => i.id === result.value.incidentId);
    expect(view).toMatchObject({ role: 'reporter', access: 'owner' });
    // Still able to act on it as its reporter.
    expect((await core.actions.cancelIncident(result.value.incidentId)).ok).toBe(true);
    await core.dispose();
  });
});
