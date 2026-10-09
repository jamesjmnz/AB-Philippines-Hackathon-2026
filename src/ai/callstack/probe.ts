import { apple } from '@react-native-ai/apple';
import { NoObjectGeneratedError, Output, generateText } from 'ai';
import { z } from 'zod';

import type { OutputProbeLine } from '../types';
import { EXTRACTION_SYSTEM, QUOTE_SYSTEM, extractionModelSchema, fenceReport, quoteModelSchema } from './prompts';

/**
 * Device probe: the same built-in sentence through several output shapes, to see which of them the
 * provider can produce on this iPhone. It never takes user text, so the head of the raw output it
 * reports contains nothing from a real report. Nothing is stored or sent.
 */

const PROBE_REPORT = 'I slipped near the canteen in Building C, third floor. My ankle hurts and I need help.';
const PROMPT = fenceReport(PROBE_REPORT);

const FLAT_KEYS = ['incidentType', 'building', 'floor', 'locationText', 'symptom', 'assistanceRequested'] as const;
const flatSchema = z.object(
  Object.fromEntries(FLAT_KEYS.flatMap((k) => [[`${k}Value`, z.string()], [`${k}Evidence`, z.string()]])) as Record<string, z.ZodString>,
);
const tinySchema = z.object({ building: z.string(), floor: z.string() });
const listSchema = z.object({ items: z.array(z.object({ field: z.string(), value: z.string() })) });

const JSON_SYSTEM = `${EXTRACTION_SYSTEM}
Answer with one JSON object only, no other text, with exactly these keys: ${FLAT_KEYS.join(', ')}. Each key holds an object {"value": string, "evidence": string}.`;

// The same limit the app's own calls use, so a shape that returns here returns there.
const base = { temperature: 0, maxOutputTokens: 1500, maxRetries: 0 } as const;

function shape(text: string | undefined): string {
  const body = (text ?? '').trim();
  let parsed = 'not JSON';
  try {
    const value: unknown = JSON.parse(body);
    parsed = value !== null && typeof value === 'object' ? `JSON, ${Object.keys(value).length} keys` : `JSON ${typeof value}`;
  } catch {
    // Left as 'not JSON': the head below shows what it is instead.
  }
  return `${body.length} chars, ${parsed}, head: ${body.slice(0, 160).replace(/\s+/g, ' ')}`;
}

function describeError(error: unknown): string {
  if (NoObjectGeneratedError.isInstance(error)) {
    const cause = error.cause instanceof Error ? `${error.cause.name}: ${error.cause.message.slice(0, 120)}` : 'no cause';
    return `NoObjectGenerated (${cause}); ${shape(error.text)}`;
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return `${error.name}${typeof code === 'string' ? ` [${code}]` : ''}: ${error.message.slice(0, 200)}`;
  }
  return `non-Error rejection: ${String(error).slice(0, 200)}`;
}

async function line(variant: string, run: () => Promise<string | undefined>): Promise<OutputProbeLine> {
  const started = Date.now();
  try {
    const text = await run();
    return { variant, ok: true, latencyMs: Date.now() - started, detail: shape(text) };
  } catch (error) {
    return { variant, ok: false, latencyMs: Date.now() - started, detail: describeError(error) };
  }
}

const structured = (schema: z.ZodType, system = EXTRACTION_SYSTEM) => async () => {
  const result = await generateText({ model: apple(), system, prompt: PROMPT, output: Output.object({ schema }), ...base });
  return result.text;
};

/** Runs the variants one after another (the model handles one generation at a time) and never throws. */
export async function probeOutputShapes(): Promise<OutputProbeLine[]> {
  if (!apple.isAvailable()) return [{ variant: 'availability', ok: false, latencyMs: 0, detail: 'apple.isAvailable() is false' }];
  return [
    await line('plain text', async () => (await generateText({ model: apple(), prompt: 'Reply with the single word OK.', ...base })).text),
    await line('text, JSON asked in prompt', async () => (await generateText({ model: apple(), system: JSON_SYSTEM, prompt: PROMPT, ...base })).text),
    await line('schema: 2 strings', structured(tinySchema)),
    await line('schema: 12 flat strings', structured(flatSchema)),
    await line('schema: 6 phrases (in use)', structured(quoteModelSchema, QUOTE_SYSTEM)),
    await line('schema: 6 nested objects (original)', structured(extractionModelSchema)),
    await line('schema: array of objects', structured(listSchema)),
  ];
}
