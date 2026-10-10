import { execSync } from 'node:child_process';

import { runRules } from '../../src/eval/rulesRun';
import type { Split } from '../datasets/schema';
import { fixturePath, readJson, sha256 } from './datasets';
import { readFileSync } from 'node:fs';
import { fixtureInputsSchema } from '../datasets/schema';
import type { RunResult } from './result-schema';

/**
 * The deterministic baseline, run on the Mac: the app's own location rules, delta classifier and
 * conflict rule, with no model. It reads the split's inputs only, exactly as the phone runner does.
 */
export function runBaseline(split: Split): RunResult {
  const path = fixturePath(split, 'inputs.json');
  const inputs = fixtureInputsSchema.parse(readJson(path));
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // Not a git checkout: the run is still valid, only less traceable.
  }
  return {
    header: {
      runner: 'mac-baseline',
      variant: 'rules',
      split,
      inputsSha256: sha256(readFileSync(path, 'utf8')),
      promptVersion: 'none',
      commit,
      startedAt: new Date().toISOString(),
      device: { model: 'Mac (Node)', osVersion: process.version, isPhysicalDevice: false },
      packageVersion: 'n/a',
      conditions: 'Deterministic rules only, no model, run under Node on the development Mac',
    },
    records: inputs.scenarios.map(runRules),
  };
}
