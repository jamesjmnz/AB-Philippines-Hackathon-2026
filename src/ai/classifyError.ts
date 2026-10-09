import type { AIFailureState } from './types';

export class AITimeoutError extends Error {
  constructor(ms: number) {
    super(`On-device model did not answer within ${ms} ms`);
    this.name = 'AITimeoutError';
  }
}

/**
 * Maps a provider error to a typed state.
 * @react-native-ai/apple 0.12.0 only gives a distinct code for MODEL_UNAVAILABLE; every other Foundation Models
 * failure arrives as code "AppleLLM" with Apple's localized description, so the rest is matched on message text.
 */
export function classifyAIError(error: unknown): { state: AIFailureState; message: string } {
  if (error instanceof AITimeoutError) return { state: 'timeout', message: error.message };
  const e = (error ?? {}) as { code?: unknown; message?: unknown; name?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : String(error);
  const name = typeof e.name === 'string' ? e.name : '';
  const text = `${code} ${name} ${message}`;

  if (code === 'MODEL_UNAVAILABLE' || /model is not available|not available on this platform|not supported on this device/i.test(text)) {
    return { state: 'unavailable', message };
  }
  if (/abort|timed? ?out/i.test(text)) return { state: 'timeout', message };
  if (/guardrail|unsafe|safety|refus|sensitive content|may be harmful/i.test(text)) return { state: 'guardrail_refusal', message };
  if (/unsupported language|language or locale|locale not supported|unsupportedlanguage|failed to create nlcontextualembedding/i.test(text)) {
    return { state: 'unsupported_locale', message };
  }
  if (/assets? (are |is )?(not |un)available|assets not supported|failed to (prepare|request) assets|assetsunavailable|model.*download/i.test(text)) {
    return { state: 'model_assets_missing', message };
  }
  if (/NoObjectGenerated|NoOutputGenerated|could not parse|invalid json|decodingfailure|failed to deserialize|type validation/i.test(text)) {
    return { state: 'invalid_output', message };
  }
  return { state: 'native_error', message };
}
