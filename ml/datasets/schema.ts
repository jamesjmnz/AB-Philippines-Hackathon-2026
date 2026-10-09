import { z } from 'zod';

/**
 * Contract for every synthetic scenario in ml/datasets. A scenario is a short chronological list of
 * statements about one incident, plus the reference answers a careful human reader would give.
 * Reference answers are written before any model sees the inputs and are frozen by hash (FROZEN.json).
 */

export const FIELDS = ['incidentType', 'building', 'floor', 'locationText', 'symptom', 'assistanceRequested'] as const;
export type Field = (typeof FIELDS)[number];

export const CLARIFIABLE_FIELDS = ['floor', 'building', 'locationText', 'assistanceRequested'] as const;

export const DELTA_CLASSES = [
  'new_information',
  'confirmation',
  'correction',
  'possible_contradiction',
  'unrelated',
  'no_meaningful_change',
] as const;
export type DeltaClass = (typeof DELTA_CLASSES)[number];

export const FIELD_DELTA_CLASSES = [
  'new_information',
  'confirmation',
  'correction',
  'possible_contradiction',
  'no_meaningful_change',
] as const;

export const SPLITS = ['development', 'validation', 'held_out'] as const;
export type Split = (typeof SPLITS)[number];

/** 'taglish' covers Filipino and mixed Filipino-English text; it is always reported apart from 'en'. */
export const LANGUAGES = ['en', 'taglish'] as const;
export type Language = (typeof LANGUAGES)[number];

export const AUTHORS = ['reporter', 'responder_a', 'responder_b'] as const;
export type Author = (typeof AUTHORS)[number];

export const TAGS = [
  'complete',
  'incomplete',
  'ambiguous',
  'chronological',
  'movement',
  'conflict',
  'hard_negative',
  'negation',
  'unrelated',
  'adversarial',
  'medical_bait',
  'long',
] as const;

const id = z.string().regex(/^[a-z0-9-]{3,40}$/);

export const statementSchema = z.strictObject({
  /** Unique inside the scenario: s1, s2, ... in chronological order. */
  id: z.string().regex(/^s[1-9]$/),
  /** The reporter is the person who needs assistance. The first statement is always the reporter's. */
  author: z.enum(AUTHORS),
  text: z.string().min(1).max(4000),
  /** Fields the reporter explicitly confirms right after this statement (a human confirmation event). */
  confirms: z.partialRecord(z.enum(FIELDS), z.string().min(1).max(120)).optional(),
});
export type Statement = z.infer<typeof statementSchema>;

/**
 * What a statement says about one field.
 * - stated: the text states it. `anyOf` lists acceptable answers (see evaluation/scoring.ts for matching).
 * - unknown: the text does not state it. Proposing any value is an unsupported fact.
 * - optional: a reasonable reader could go either way. Excluded from every denominator.
 */
export const fieldReferenceSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('stated'), anyOf: z.array(z.string().min(1)).min(1) }),
  z.strictObject({ status: z.literal('unknown') }),
  z.strictObject({ status: z.literal('optional') }),
]);
export type FieldReference = z.infer<typeof fieldReferenceSchema>;

export const extractionReferenceSchema = z.strictObject({
  statementId: z.string(),
  fields: z.strictObject({
    incidentType: fieldReferenceSchema,
    building: fieldReferenceSchema,
    floor: fieldReferenceSchema,
    locationText: fieldReferenceSchema,
    symptom: fieldReferenceSchema,
    assistanceRequested: fieldReferenceSchema,
  }),
});

/** How a statement relates to everything said before it. Never given for s1. */
export const deltaReferenceSchema = z.strictObject({
  statementId: z.string(),
  overall: z.enum(DELTA_CLASSES),
  /** Only fields the statement actually speaks about. */
  fields: z.partialRecord(z.enum(FIELDS), z.enum(FIELD_DELTA_CLASSES)),
});

/** A disagreement between two statements that a human must settle. Self-corrections are not conflicts. */
export const conflictReferenceSchema = z.strictObject({
  field: z.enum(FIELDS),
  statementIds: z.tuple([z.string(), z.string()]),
});

export const clarificationReferenceSchema = z.strictObject({
  /** Fields worth asking about after s1. Empty means no question is useful. */
  acceptable: z.array(z.enum(CLARIFIABLE_FIELDS)),
  /** True when asking nothing is also a good outcome. */
  noneAcceptable: z.boolean(),
});

export const referenceSchema = z.strictObject({
  extraction: z.array(extractionReferenceSchema),
  deltas: z.array(deltaReferenceSchema),
  /** Complete list of conflicts open after the last statement. Empty is a real answer (hard negative). */
  conflicts: z.array(conflictReferenceSchema),
  clarification: clarificationReferenceSchema.optional(),
  /** Lower-case fragments that must never appear in any proposed value or question (injected text, diagnoses). */
  forbidden: z.array(z.string().min(2)),
});
export type Reference = z.infer<typeof referenceSchema>;

export const scenarioSchema = z
  .strictObject({
    id,
    split: z.enum(SPLITS),
    language: z.enum(LANGUAGES),
    tags: z.array(z.enum(TAGS)).min(1),
    statements: z.array(statementSchema).min(1).max(5),
    reference: referenceSchema,
    /** Why the reference is what it is. Never shown to a model. */
    notes: z.string().max(400),
  })
  .superRefine((s, ctx) => {
    const ids = s.statements.map((x) => x.id);
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message: `${s.id}: ${message}` });
    ids.forEach((x, i) => x === `s${i + 1}` || fail(`statement ${i + 1} must have id s${i + 1}`));
    if (s.statements[0]?.author !== 'reporter') fail('s1 must be the reporter');
    for (const e of s.reference.extraction) ids.includes(e.statementId) || fail(`extraction for unknown ${e.statementId}`);
    for (const d of s.reference.deltas) {
      if (!ids.includes(d.statementId) || d.statementId === 's1') fail(`delta for ${d.statementId}`);
    }
    const expected = ids.slice(1).join(',');
    if (s.reference.deltas.map((d) => d.statementId).join(',') !== expected) fail('one delta per statement after s1, in order');
    for (const c of s.reference.conflicts) {
      if (!c.statementIds.every((x) => ids.includes(x)) || c.statementIds[0] === c.statementIds[1]) fail('conflict ids');
    }
    s.statements.forEach((st) => st.confirms && st.author !== 'reporter' && fail('only the reporter confirms'));
  });
export type Scenario = z.infer<typeof scenarioSchema>;

export const datasetSchema = z.strictObject({
  name: z.enum(['extraction', 'incident_deltas', 'contradictions', 'adversarial']),
  description: z.string(),
  scenarios: z.array(scenarioSchema),
});
export type Dataset = z.infer<typeof datasetSchema>;

/** What ships to the phone: inputs only. Reference answers never leave the Mac. */
export const scenarioInputSchema = z.strictObject({
  id,
  language: z.enum(LANGUAGES),
  statements: z.array(statementSchema),
});
export type ScenarioInput = z.infer<typeof scenarioInputSchema>;

export const fixtureInputsSchema = z.strictObject({ split: z.enum(SPLITS), scenarios: z.array(scenarioInputSchema) });
export const fixtureReferenceSchema = z.strictObject({
  split: z.enum(SPLITS),
  scenarios: z.array(z.strictObject({ id, tags: z.array(z.enum(TAGS)), reference: referenceSchema, notes: z.string() })),
});
