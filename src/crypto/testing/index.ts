/**
 * In-memory CapsuleCrypto double for Jest. The implementation lives in `src/demo/` because the Demo
 * Lab uses the same simulation and app code may not import from `testing/` directories.
 */
export {
  SimulatedCryptoRealm as FakeCryptoRealm,
  createSimulatedCrypto as createFakeCapsuleCrypto,
  createSimulatedCryptoRealm as createFakeCryptoRealm,
  simulatedDeviceId as fakeDeviceId,
  simulatedDigest as fakeDigest,
} from '@/demo/simulatedCrypto';
