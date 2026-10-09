import type { LocalAIService } from '../types';
import { CallstackAppleAIAdapter, type AdapterOptions } from './CallstackAppleAIAdapter';
import { appleRuntime } from './appleRuntime';
import { probeOutputShapes } from './probe';

/** Live on-device AI. Import this only from the app composition root. */
export function createCallstackAppleAI(options?: AdapterOptions): LocalAIService {
  return new CallstackAppleAIAdapter(appleRuntime, { probe: probeOutputShapes, ...options });
}
