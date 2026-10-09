import { AppleEmbeddings, AppleTranscription, apple } from '@react-native-ai/apple';
import { NoObjectGeneratedError, Output, embedMany, generateText, experimental_transcribe as transcribe } from 'ai';
import * as Device from 'expo-device';

import pkg from '../../../package.json';
import type { AppleRuntime } from './runtime.types';

/**
 * The only module that touches @react-native-ai/apple and the AI SDK.
 * All inference here is on-device; nothing in this file performs a network request.
 */
export const appleRuntime: AppleRuntime = {
  packageVersion: pkg.dependencies['@react-native-ai/apple'],

  device: () => ({ model: Device.modelName ?? 'Unknown iPhone', osVersion: Device.osVersion ?? 'unknown' }),

  isTextAvailable: () => apple.isAvailable(),

  // Structured output must be non-streaming with this provider: its adapter throws on streaming JSON.
  generateObject: async ({ system, prompt, schema, signal }) => {
    try {
      const result = await generateText({
        model: apple(),
        system,
        prompt,
        output: Output.object({ schema }),
        temperature: 0,
        maxOutputTokens: 1500,
        maxRetries: 0,
        abortSignal: signal,
      });
      return result.output;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) throw new Error(`NoObjectGenerated: ${error.message} ${describeShape(error.text, error.cause)}`);
      throw error;
    }
  },

  embeddingInfo: async (language) => {
    const info = await AppleEmbeddings.getInfo(language);
    return { hasAvailableAssets: info.hasAvailableAssets, dimension: info.dimension };
  },

  embed: async (texts, language) => {
    const model = apple.textEmbeddingModel({ language });
    await model.prepare();
    const { embeddings } = await embedMany({ model, values: [...texts], maxRetries: 0 });
    return embeddings;
  },

  isTranscriptionAvailable: (locale) => AppleTranscription.isAvailable(locale),

  transcribe: async (wavBytes, locale) => {
    const model = apple.transcriptionModel({ language: locale });
    await model.prepare();
    // The provider forwards `audio.buffer`, so pass a copy that owns exactly these bytes.
    const audio = new Uint8Array(wavBytes);
    const result = await transcribe({ model, audio, maxRetries: 0 });
    return { text: result.text, durationSeconds: result.durationInSeconds ?? 0 };
  },
};

/** Says what kind of text came back, never the text itself: the report's words must not reach an error message. */
function describeShape(text: string | undefined, cause: unknown): string {
  const body = text ?? '';
  const opener = /^\s*[{[]/.test(body) ? 'JSON-like' : /^\s*[A-Za-z_]+\(/.test(body) ? 'Swift description' : 'other';
  const closed = /[}\]]\s*$/.test(body) ? 'closed' : 'not closed';
  const name = cause instanceof Error ? cause.name : 'none';
  return `(${body.length} chars, ${opener}, ${closed}, cause ${name})`;
}
