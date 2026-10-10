import { AITimeoutError, classifyAIError } from '../classifyError';

const appleLLM = (message: string) => Object.assign(new Error(message), { code: 'AppleLLM' });

describe('classifyAIError', () => {
  it('maps the guided-generation decode failure seen on a device to invalid_output', () => {
    expect(classifyAIError(appleLLM('Failed to deserialize a Generable type from model output')).state).toBe('invalid_output');
  });

  it.each([
    'Exceeded model context window size',
    'The request exceeded the context window.',
    'exceededContextWindowSize',
    'Prompt exceeds the maximum context length',
  ])('maps "%s" to context_overflow', (message) => {
    expect(classifyAIError(appleLLM(message)).state).toBe('context_overflow');
  });

  it('keeps the existing mappings', () => {
    expect(classifyAIError(new AITimeoutError(20_000)).state).toBe('timeout');
    expect(classifyAIError(Object.assign(new Error('x'), { code: 'MODEL_UNAVAILABLE' })).state).toBe('unavailable');
    expect(classifyAIError(appleLLM('The operation was aborted')).state).toBe('timeout');
    expect(classifyAIError(appleLLM('Guardrail violation: may be harmful')).state).toBe('guardrail_refusal');
    expect(classifyAIError(appleLLM('Unsupported language or locale')).state).toBe('unsupported_locale');
    expect(classifyAIError(appleLLM('Model assets are unavailable')).state).toBe('model_assets_missing');
    expect(classifyAIError(appleLLM('Something nobody has seen before')).state).toBe('native_error');
    expect(classifyAIError(undefined).state).toBe('native_error');
  });
});
