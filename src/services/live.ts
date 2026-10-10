import type { AIMeta, CapabilityMatrix, LocalAIService } from '@/ai';
import type { CapsuleCrypto } from '@/crypto/types';
import type { IdGenerator } from '@/domain';
import type { KeyValueStore } from '@/sync/types';
import type { PeerTransport } from '@/transport/types';

import type { PulseApp } from './api';
import { createMemoryKeyValueStore, prefixedKeyValueStore } from './kv';
import { PulseCore } from './PulseCore';

/**
 * LIVE wiring: SQLite ledger, Callstack Apple AI, the Swift peer transport and the Swift capsule
 * crypto. Every native module is required inside `boot()`, so importing this file (as Jest and the
 * Demo Lab do) loads none of them.
 *
 * A native module that fails to load is replaced by an adapter that reports itself unavailable.
 * The ledger is the only hard requirement: an SOS can always be created and queued.
 */

const LIVE_KV_PREFIX = 'pulse.live.';

function unavailableTransport(): PeerTransport {
  const off = () => () => undefined;
  const refuse = async () => {
    throw new Error('transport_unavailable');
  };
  return {
    startDiscovery: refuse,
    stopDiscovery: async () => undefined,
    connect: refuse,
    disconnect: async () => undefined,
    sendOpaquePacket: refuse,
    onPeerFound: off,
    onPeerLost: off,
    onConnectionState: off,
    onOpaquePacket: off,
    onError: off,
    stop: async () => undefined,
  };
}

function unavailableCrypto(): CapsuleCrypto {
  const refuse = async () => {
    throw new Error('crypto_unavailable');
  };
  const failed = async () => ({ ok: false as const, reason: 'native_error' as const, message: 'crypto_unavailable' });
  return {
    createOrLoadIdentity: refuse,
    exportPublicPairingMaterial: refuse,
    verifyPeerPairing: failed,
    encryptForRecipients: failed,
    verifyEnvelope: failed,
    decryptAuthorized: failed,
    signEvent: refuse,
    verifyEventSignature: async () => false,
  };
}

function unavailableAI(device: { model: string; osVersion: string }): LocalAIService {
  // No provider answered: the module did not load. Saying 'callstack-apple' here would pass a failure off as a real call.
  const meta: AIMeta = { source: 'none', latencyMs: 0 };
  const down = async () => ({ ok: false as const, state: 'native_error' as const, message: 'ai_module_unavailable', meta });
  const status = { state: 'native_error' as const, detail: 'ai_module_unavailable' };
  const matrix: CapabilityMatrix = {
    provider: 'Callstack Apple',
    source: 'none',
    packageVersion: 'unknown',
    device,
    text: status,
    embeddings: { ...status, language: 'en' },
    transcription: { ...status, locale: 'en-US' },
    speech: status,
  };
  return {
    inspectCapabilities: async () => matrix,
    extractIncidentReport: down,
    suggestClarification: down,
    findConflicts: down,
    proposeNonMedicalTasks: down,
    compareSemanticReports: down,
    transcribeLocal: down,
  };
}

function fallbackUuid(): string {
  const hex = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `${hex()}-${hex().slice(0, 4)}-${hex().slice(0, 4)}-${hex().slice(0, 4)}-${hex()}${hex().slice(0, 4)}`;
}

/* eslint-disable @typescript-eslint/no-require-imports --
   Native modules are required lazily, inside the functions below, so that importing this file
   never loads them. `require` (not `import()`) because it behaves the same under Metro and Jest. */
const lazy = {
  storage: () => require('@/storage/expoDriver') as typeof import('@/storage/expoDriver'),
  kvStore: () => require('expo-sqlite/kv-store') as typeof import('expo-sqlite/kv-store'),
  device: () => require('expo-device') as typeof import('expo-device'),
  crypto: () => require('expo-crypto') as typeof import('expo-crypto'),
  fileSystem: () => require('expo-file-system') as typeof import('expo-file-system'),
  reactNative: () => require('react-native') as typeof import('react-native'),
  ai: () => require('@/ai/callstack') as typeof import('@/ai/callstack'),
  transport: () => require('@/transport/NativePeerTransport') as typeof import('@/transport/NativePeerTransport'),
  capsuleCrypto: () => require('@/crypto/NativeCapsuleCrypto') as typeof import('@/crypto/NativeCapsuleCrypto'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

function attempt<T>(load: () => T, fallback: () => T): T {
  try {
    return load();
  } catch {
    return fallback();
  }
}

async function boot(): Promise<PulseCore> {
  // Storage first: without the ledger nothing can be persisted, so this one is allowed to fail the boot.
  const { repository } = await lazy.storage().openExpoIncidentRepository();

  // Without the key-value module the profile, pairings and settings live in memory; the snapshot says so.
  let kvPersistent = true;
  const kv = attempt<KeyValueStore>(
    () => {
      const { Storage } = lazy.kvStore();
      return prefixedKeyValueStore(
        {
          get: (key) => Storage.getItemAsync(key),
          set: (key, value) => Storage.setItemAsync(key, value),
          remove: async (key) => {
            await Storage.removeItemAsync(key);
          },
        },
        LIVE_KV_PREFIX,
      );
    },
    () => {
      kvPersistent = false;
      return createMemoryKeyValueStore();
    },
  );

  const deviceInfo = attempt(
    () => {
      const Device = lazy.device();
      return { model: Device.modelName ?? 'iPhone', osVersion: Device.osVersion ?? 'unknown' };
    },
    () => ({ model: 'iPhone', osVersion: 'unknown' }),
  );

  const randomUUID = attempt(
    () => {
      const Crypto = lazy.crypto();
      // Probe once: a module that loads but cannot generate is as good as missing.
      Crypto.randomUUID();
      return () => Crypto.randomUUID();
    },
    () => fallbackUuid,
  );
  const ids: IdGenerator = { next: (prefix = 'x') => `${prefix}-${randomUUID()}` };

  const ai = attempt(
    () => lazy.ai().createCallstackAppleAI(),
    () => unavailableAI(deviceInfo),
  );
  const evaluation = attempt<ConstructorParameters<typeof PulseCore>[0]['evaluation']>(
    () => {
      const callstack = lazy.ai();
      return {
        promptVersion: callstack.promptFingerprint(),
        packageVersion: callstack.providerPackageVersion,
        isPhysicalDevice: lazy.device().isDevice,
        createAI: (variant) =>
          callstack.createCallstackAppleAI({
            extraction: variant === 'nested' ? 'nested' : 'quotes',
            assessment: variant === 'single' ? 'single' : 'staged',
          }),
        exportFile: async (name, contents) => {
          const { File, Paths } = lazy.fileSystem();
          const file = new File(Paths.cache, name);
          file.create({ overwrite: true });
          file.write(contents);
          return file.uri;
        },
      };
    },
    () => undefined,
  );
  const transport = attempt(() => lazy.transport().createNativePeerTransport(), unavailableTransport);
  const crypto = attempt(() => lazy.capsuleCrypto().createNativeCapsuleCrypto(), unavailableCrypto);

  const readFile = async (uri: string): Promise<Uint8Array> => {
    const { File } = lazy.fileSystem();
    return new Uint8Array(await new File(uri).arrayBuffer());
  };

  return new PulseCore({
    mode: 'live',
    repo: repository,
    ai,
    transport,
    crypto,
    kv,
    kvPersistent,
    clock: { nowMs: () => Date.now() },
    ids,
    deviceInfo,
    readFile,
    ...(evaluation ? { evaluation, aiPromptVersion: evaluation.promptVersion } : {}),
  });
}

/**
 * The LIVE PulseApp. Call it once from the composition root and await it.
 *
 * It resolves as soon as the ledger is open, with `ready: false`; identity, capabilities and
 * discovery finish in the background and flip `ready` when they are done (bounded, so a slow
 * keychain cannot hold the app back). It rejects only if on-device storage cannot be opened.
 */
export async function createLiveApp(): Promise<PulseApp> {
  const core = await boot();
  void core.start();
  // 'inactive' (Control Center, the app switcher) is ignored: iOS keeps the radio up through it.
  const stopWatching = attempt(
    () => {
      const subscription = lazy.reactNative().AppState.addEventListener('change', (state) => {
        if (state === 'active') void core.setAppActive(true);
        else if (state === 'background') void core.setAppActive(false);
      });
      return () => subscription.remove();
    },
    () => () => undefined,
  );
  return {
    getSnapshot: core.getSnapshot,
    subscribe: core.subscribe,
    actions: core.actions,
    dispose: async () => {
      attempt(stopWatching, () => undefined);
      await core.dispose();
    },
  };
}
