import { z } from 'zod';

/** Opaque identifier (event, incident, device, packet, task ...). */
export const IdSchema = z.string().min(1).max(128);

export const NameSchema = z.string().min(1).max(80);

/** Who authored something: the device identifier is the identity, the name is for display. */
export const ActorSchema = z.strictObject({
  deviceId: IdSchema,
  userName: NameSchema,
});
export type Actor = z.infer<typeof ActorSchema>;

/**
 * Ordering metadata.
 * - `seq`: monotonic per authoring device (within an incident unless the caller supplies a global counter).
 * - `lamport`: logical clock; one more than the highest lamport the author had seen.
 * - `wallClockMs`: display only. Never used to order events across devices.
 */
export const EventClockSchema = z.strictObject({
  seq: z.number().int().min(1),
  lamport: z.number().int().min(1),
  wallClockMs: z.number().int().nonnegative(),
});
export type EventClock = z.infer<typeof EventClockSchema>;

export const EventSignatureSchema = z.strictObject({
  alg: z.string().min(1).max(32),
  keyId: IdSchema,
  value: z.string().min(1).max(1024),
});
export type EventSignature = z.infer<typeof EventSignatureSchema>;

/** A character span inside a piece of original text. `text` is the exact substring. */
export const TextSpanSchema = z.strictObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string().max(500),
});
export type TextSpan = z.infer<typeof TextSpanSchema>;

/** Injected time source. The domain never reads the system clock itself. */
export interface Clock {
  nowMs(): number;
}

/** Injected id source. The app supplies a random UUID generator; tests supply a counter. */
export interface IdGenerator {
  next(prefix?: string): string;
}

/** Deterministic clock for tests and the Demo store. */
export function createFixedClock(startMs: number, stepMs = 1000): Clock {
  let now = startMs - stepMs;
  return {
    nowMs() {
      now += stepMs;
      return now;
    },
  };
}

/** Deterministic id generator for tests and the Demo store. */
export function createSequentialIds(namespace = 'id'): IdGenerator {
  let n = 0;
  return {
    next(prefix = 'x') {
      n += 1;
      return `${prefix}-${namespace}-${String(n).padStart(4, '0')}`;
    },
  };
}

/** Comparison key for claim values: case, surrounding space and inner whitespace runs are ignored. */
export function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
