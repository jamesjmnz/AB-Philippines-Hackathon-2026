import { z } from 'zod';

import { CLARIFIABLE_FIELDS, TASK_KINDS } from '../types';

// Schemas sent to Apple Foundation Models through the Callstack provider.
// Its schema mapper (0.12.0) cannot express nullable, literal, $ref, oneOf, or min+max together,
// so these use plain strings, string enums and required properties only. Strict checking happens in the adapter.

const field = z.object({
  value: z.string().describe('Short value using the person\'s own words, or "unknown".'),
  evidence: z.string().describe('Exact words copied from the report that support the value, or empty.'),
});

export const extractionModelSchema = z.object({
  incidentType: field.describe('What happened, in a few plain words.'),
  building: field.describe('Building or place name the person stated.'),
  floor: field.describe('Floor or level the person stated.'),
  locationText: field.describe('Any other location words the person used.'),
  symptom: field.describe('What the person says they feel, in their own words.'),
  assistanceRequested: field.describe('"yes" if the person asks for help, otherwise "unknown".'),
});

export const EXTRACTION_SYSTEM = `You structure a short assistance request written by a person who may be distressed. The report may be in English, Filipino or mixed.
Rules:
- Use only what the report says. Never guess or infer.
- For each field give "value" and "evidence". "evidence" must be words copied exactly from the report, in the report's language.
- If the report does not state a field, set value to "unknown" and evidence to "".
- Do not invent a floor, room, building, address, coordinates, age, or name.
- Do not judge how serious anything is. Do not diagnose. Do not give medical advice.`;

export const clarificationModelSchema = z.object({
  field: z.enum([...CLARIFIABLE_FIELDS, 'none']).describe('The single most useful missing detail, or "none".'),
  question: z.string().describe('One short, calm question to the person. Empty if field is "none".'),
});

export const CLARIFICATION_SYSTEM = `You help someone who asked for assistance add one missing detail so helpers can find them.
Rules:
- Ask at most one short question about a detail listed as missing.
- If nothing important is missing, answer field "none" with an empty question.
- Ask about location first. Never ask medical questions. Never give advice or reassurance.`;

export const conflictModelSchema = z.object({
  conflicts: z.array(
    z.object({
      field: z.enum(['floor', 'building', 'locationText']),
      first: z.string().describe('Id of one statement.'),
      second: z.string().describe('Id of the statement that disagrees with it.'),
      note: z.string().describe('One short neutral sentence naming the disagreement.'),
    }),
  ),
});

export const CONFLICT_SYSTEM = `You compare statements from different people about where someone is.
Rules:
- Report a conflict only when two statements give different values for the same location detail.
- Use the statement ids exactly as given.
- Do not decide who is right. Do not add information. If there is no disagreement return an empty list.`;

export const taskModelSchema = z.object({
  tasks: z.array(
    z.object({
      kind: z.enum(TASK_KINDS),
      title: z.string().describe('Short task a volunteer could choose to do, under 8 words.'),
    }),
  ),
});

export const TASK_SYSTEM = `You suggest up to three simple coordination tasks that nearby volunteers could choose to take.
Rules:
- Only non-medical coordination: contacting building staff or security, going to meet the person, confirming the location, guiding others to the place.
- Never suggest first aid, treatment, moving the person, medication, or any medical action.
- Do not assign tasks to anyone. Do not state that help is coming.`;
