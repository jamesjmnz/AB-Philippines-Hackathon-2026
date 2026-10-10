import type { LocalAIService } from '../types';
import { CallstackAppleAIAdapter, type AdapterOptions } from './CallstackAppleAIAdapter';
import { appleRuntime } from './appleRuntime';
import { probeOutputShapes } from './probe';

export { promptFingerprint } from './prompts';
export type { AdapterOptions } from './CallstackAppleAIAdapter';

/** Version of @react-native-ai/apple this build links against. */
export const providerPackageVersion = appleRuntime.packageVersion;

/** Live on-device AI. Import this only from the app composition root. */
export function createCallstackAppleAI(options?: AdapterOptions): LocalAIService {
  return new CallstackAppleAIAdapter(appleRuntime, { probe: probeOutputShapes, ...options });
}
