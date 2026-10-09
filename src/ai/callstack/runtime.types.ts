import type { z } from 'zod';

/**
 * The narrow surface of @react-native-ai/apple + the AI SDK that the adapter needs.
 * The real implementation is in appleRuntime.ts; tests inject a fake.
 */
export interface AppleRuntime {
  packageVersion: string;
  device(): { model: string; osVersion: string };
  isTextAvailable(): boolean;
  /** Non-streaming structured generation. Returns the raw object the model produced (not yet trusted). */
  generateObject(args: { system: string; prompt: string; schema: z.ZodType; signal: AbortSignal }): Promise<unknown>;
  embeddingInfo(language: string): Promise<{ hasAvailableAssets: boolean; dimension: number }>;
  embed(texts: readonly string[], language: string): Promise<number[][]>;
  isTranscriptionAvailable(locale: string): boolean;
  transcribe(wavBytes: Uint8Array, locale: string): Promise<{ text: string; durationSeconds: number }>;
}
