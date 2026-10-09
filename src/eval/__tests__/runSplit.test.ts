import { runResultSchema } from '../../../ml/evaluation/result-schema';
import { CallstackAppleAIAdapter } from '../../ai/callstack/CallstackAppleAIAdapter';
import type { AppleRuntime } from '../../ai/callstack/runtime.types';
import { runSplit } from '../runSplit';

/** A runtime that copies nothing and relates nothing: every model call succeeds with empty output. */
function emptyRuntime(calls: { system: string; prompt: string }[]): AppleRuntime {
  return {
    packageVersion: '0.12.0',
    device: () => ({ model: 'Test iPhone', osVersion: '26.0' }),
    isTextAvailable: () => true,
    generateObject: async ({ system, prompt }) => {
      calls.push({ system, prompt });
      if (system.startsWith('You compare')) return { topic: 'about_request', place: 'not_mentioned', incident: 'not_mentioned', feeling: 'not_mentioned' };
      if (system.startsWith('You help someone')) return { field: 'none', question: '' };
      return { incident: '', building: '', floor: '', place: '', feeling: '', help: '' };
    },
    embeddingInfo: async () => ({ hasAvailableAssets: false, dimension: 0 }),
    embed: async () => [],
    isTranscriptionAvailable: () => false,
    transcribe: async () => ({ text: '', durationSeconds: 0 }),
  };
}

const base = {
  promptVersion: 'test',
  commit: 'test',
  packageVersion: '0.12.0',
  conditions: 'unit test',
  device: { model: 'Test iPhone', osVersion: '26.0', isPhysicalDevice: false },
  now: () => new Date('2026-10-10T00:00:00Z'),
};

describe('runSplit', () => {
  it('produces a valid result file for every scenario of a split, with no scenario text in it', async () => {
    const calls: { system: string; prompt: string }[] = [];
    const progress: number[] = [];
    const result = await runSplit({ ...base, split: 'development', variant: 'staged', ai: new CallstackAppleAIAdapter(emptyRuntime(calls)), onProgress: (done) => progress.push(done) });

    expect(runResultSchema.safeParse(result).success).toBe(true);
    expect(result.header).toMatchObject({ runner: 'mac-simulated', variant: 'staged', split: 'development' });
    expect(result.header.inputsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.records).toHaveLength(18);
    expect(progress[progress.length - 1]).toBe(18);
    expect(calls.length).toBeGreaterThan(18);
    // The rules still read floors and buildings even though this model returns nothing.
    expect(result.records.some((r) => r.extraction.some((e) => e.fields.floor !== undefined))).toBe(true);
    expect(result.records.every((r) => r.calls.every((c) => c.source === 'callstack-apple' && c.state === 'ready'))).toBe(true);
    // Statement text reaches the model, and only the model: it is not in what gets exported.
    const exported = JSON.stringify(result);
    const sample = calls[0]?.prompt.split('\n')[1] ?? '';
    expect(sample.length).toBeGreaterThan(20);
    expect(exported).not.toContain(sample);
  });

  it('runs the rules arm without touching the model', async () => {
    const calls: { system: string; prompt: string }[] = [];
    const result = await runSplit({ ...base, split: 'validation', variant: 'rules', ai: new CallstackAppleAIAdapter(emptyRuntime(calls)) });
    expect(calls).toHaveLength(0);
    expect(result.records).toHaveLength(12);
    expect(result.records.every((r) => r.calls.every((c) => c.source === 'rules'))).toBe(true);
  });

  it('extraction-only arms ask about the first statement only', async () => {
    const calls: { system: string; prompt: string }[] = [];
    const result = await runSplit({ ...base, split: 'development', variant: 'quotes', ai: new CallstackAppleAIAdapter(emptyRuntime(calls)) });
    expect(calls).toHaveLength(18);
    expect(result.records.every((r) => r.deltas.length === 0 && r.calls.length === 1)).toBe(true);
  });

  it('records a failing provider as failed calls instead of throwing', async () => {
    const runtime = { ...emptyRuntime([]), isTextAvailable: () => false };
    const result = await runSplit({ ...base, split: 'validation', variant: 'staged', ai: new CallstackAppleAIAdapter(runtime) });
    expect(result.records).toHaveLength(12);
    expect(result.records.flatMap((r) => r.calls).every((c) => c.state === 'unavailable')).toBe(true);
    // The deterministic delta is still there for every later statement.
    expect(result.records.flatMap((r) => r.deltas).length).toBeGreaterThan(0);
  });

  it('stops early when asked', async () => {
    let n = 0;
    const result = await runSplit({ ...base, split: 'development', variant: 'rules', ai: new CallstackAppleAIAdapter(emptyRuntime([])), shouldStop: () => ++n > 3 });
    expect(result.records).toHaveLength(3);
  });
});
