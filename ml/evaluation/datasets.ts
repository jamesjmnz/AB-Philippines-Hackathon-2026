import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  SPLITS,
  datasetSchema,
  fixtureInputsSchema,
  fixtureReferenceSchema,
  type Scenario,
  type Split,
} from '../datasets/schema';

/** Node-side access to datasets, fixtures and the freeze manifest. Never imported by the app. */

export const ML_ROOT = join(__dirname, '..');
export const DATASET_FILES = ['extraction.json', 'incident_deltas.json', 'contradictions.json', 'adversarial.json'] as const;
export const FROZEN_PATH = join(ML_ROOT, 'datasets', 'FROZEN.json');
/** sha256 of each split's inputs.json, bundled with the app so a device run can name the inputs it saw. */
export const MANIFEST_PATH = join(ML_ROOT, 'fixtures', 'manifest.json');

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
export const fixturePath = (split: Split, file: 'inputs.json' | 'reference.json'): string => join(ML_ROOT, 'fixtures', split, file);

export function loadScenarios(): Scenario[] {
  const scenarios = DATASET_FILES.flatMap((file) => datasetSchema.parse(readJson(join(ML_ROOT, 'datasets', file))).scenarios);
  const seen = new Set<string>();
  for (const s of scenarios) {
    if (seen.has(s.id)) throw new Error(`duplicate scenario id ${s.id}`);
    seen.add(s.id);
  }
  return scenarios;
}

export const scenariosOf = (split: Split): Scenario[] => loadScenarios().filter((s) => s.split === split);

/** The two files a split is published as. Inputs carry no reference answer, tag or note. */
export function renderFixtures(split: Split, scenarios: readonly Scenario[]): { inputs: string; reference: string } {
  const own = scenarios.filter((s) => s.split === split);
  const inputs = fixtureInputsSchema.parse({
    split,
    scenarios: own.map((s) => ({ id: s.id, language: s.language, statements: s.statements })),
  });
  const reference = fixtureReferenceSchema.parse({
    split,
    scenarios: own.map((s) => ({ id: s.id, tags: s.tags, reference: s.reference, notes: s.notes })),
  });
  return { inputs: `${JSON.stringify(inputs, null, 2)}\n`, reference: `${JSON.stringify(reference, null, 2)}\n` };
}

export function frozenFiles(): string[] {
  return [
    ...DATASET_FILES.map((f) => join('datasets', f)),
    ...SPLITS.flatMap((s) => [join('fixtures', s, 'inputs.json'), join('fixtures', s, 'reference.json')]),
  ];
}

export const hashFile = (relative: string): string => sha256(readFileSync(join(ML_ROOT, relative), 'utf8'));

export interface Frozen {
  frozenAt: string;
  note: string;
  files: Record<string, string>;
}

/** Problems that mean the published fixtures or the frozen answers are not what the datasets say. */
export function verify(): string[] {
  const problems: string[] = [];
  let scenarios: Scenario[];
  try {
    scenarios = loadScenarios();
  } catch (error) {
    return [`datasets do not validate: ${error instanceof Error ? error.message : String(error)}`];
  }
  for (const split of SPLITS) {
    const rendered = renderFixtures(split, scenarios);
    for (const file of ['inputs.json', 'reference.json'] as const) {
      const path = fixturePath(split, file);
      if (!existsSync(path)) problems.push(`missing fixtures/${split}/${file}`);
      else if (readFileSync(path, 'utf8') !== rendered[file === 'inputs.json' ? 'inputs' : 'reference']) problems.push(`fixtures/${split}/${file} is out of date`);
    }
  }
  const manifest = existsSync(MANIFEST_PATH) ? (readJson(MANIFEST_PATH) as Record<string, string>) : {};
  for (const split of SPLITS) {
    if (existsSync(fixturePath(split, 'inputs.json')) && manifest[split] !== sha256(readFileSync(fixturePath(split, 'inputs.json'), 'utf8'))) problems.push(`fixtures/manifest.json is out of date for ${split}`);
  }
  if (!existsSync(FROZEN_PATH)) return [...problems, 'datasets/FROZEN.json is missing: answers are not frozen'];
  const frozen = readJson(FROZEN_PATH) as Frozen;
  for (const relative of frozenFiles()) {
    const expected = frozen.files[relative];
    if (expected === undefined) problems.push(`${relative} is not in the freeze manifest`);
    else if (existsSync(join(ML_ROOT, relative)) && hashFile(relative) !== expected) problems.push(`${relative} changed after the freeze`);
  }
  return problems;
}

export const listResultFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => join(dir, f))
    : [];
