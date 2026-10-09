import { z } from 'zod';

import { CLARIFIABLE_FIELDS, DELTA_CLASSES, FIELDS, FIELD_DELTA_CLASSES, SPLITS } from '../datasets/schema';

/**
 * One evaluation run: what a pipeline produced for every scenario of a split. The same shape is written
 * by the in-app runner on the phone and by the Mac runners, so one scorer handles all of them.
 * It holds outputs and timings only. Scenario text and reference answers are never copied in.
 */

/** Who produced the run. Only 'device' rows may be reported as on-device model results. */
export const RUNNERS = ['device', 'mac-baseline', 'mac-simulated'] as const;
export type Runner = (typeof RUNNERS)[number];

/** rules = deterministic baseline; staged = extraction then per-statement assessment; single = one call per statement. */
export const VARIANTS = ['rules', 'staged', 'single'] as const;

export const CALL_STATES = [
  'ready',
  'unavailable',
  'unsupported_locale',
  'model_assets_missing',
  'guardrail_refusal',
  'timeout',
  'invalid_output',
  'native_error',
  'cancelled',
  'queue_full',
  'context_overflow',
  'superseded',
] as const;

export const callRecordSchema = z.strictObject({
  op: z.enum(['extract', 'assess', 'clarify', 'conflicts']),
  statementId: z.string(),
  state: z.enum(CALL_STATES),
  source: z.enum(['callstack-apple', 'simulated', 'rules', 'none']),
  latencyMs: z.number().nonnegative(),
  /** Fields the model returned a value for, before the evidence and grounding checks. */
  proposed: z.number().int().nonnegative(),
  /** Fields that survived those checks. */
  kept: z.number().int().nonnegative(),
});
export type CallRecord = z.infer<typeof callRecordSchema>;

const proposedField = z.strictObject({ value: z.string(), evidence: z.string() });

export const scenarioRecordSchema = z.strictObject({
  scenarioId: z.string(),
  calls: z.array(callRecordSchema),
  /** One entry per statement the pipeline extracted from. Missing statement = the call did not complete. */
  extraction: z.array(
    z.strictObject({ statementId: z.string(), fields: z.partialRecord(z.enum(FIELDS), proposedField) }),
  ),
  deltas: z.array(
    z.strictObject({
      statementId: z.string(),
      overall: z.enum([...DELTA_CLASSES, 'not_assessed']),
      fields: z.partialRecord(z.enum(FIELDS), z.enum(FIELD_DELTA_CLASSES)),
    }),
  ),
  conflicts: z.array(z.strictObject({ field: z.enum(FIELDS), statementIds: z.tuple([z.string(), z.string()]) })),
  /** undefined = not attempted; null = attempted and nothing asked. */
  clarification: z
    .strictObject({ field: z.enum(CLARIFIABLE_FIELDS), question: z.string() })
    .nullable()
    .optional(),
});
export type ScenarioRecord = z.infer<typeof scenarioRecordSchema>;

export const runHeaderSchema = z.strictObject({
  runner: z.enum(RUNNERS),
  variant: z.enum(VARIANTS),
  split: z.enum(SPLITS),
  /** sha256 of the split's inputs.json, so a run is tied to the exact inputs it saw. */
  inputsSha256: z.string(),
  promptVersion: z.string(),
  commit: z.string(),
  startedAt: z.string(),
  device: z.strictObject({ model: z.string(), osVersion: z.string(), isPhysicalDevice: z.boolean() }),
  packageVersion: z.string(),
  /** Free-form test conditions typed by the operator: network state, phone language, thermal notes. */
  conditions: z.string(),
});

export const runResultSchema = z.strictObject({ header: runHeaderSchema, records: z.array(scenarioRecordSchema) });
export type RunResult = z.infer<typeof runResultSchema>;
