import type { ScenarioInput, Split } from '../../ml/datasets/schema';
import type { RunResult, Variant } from '../../ml/evaluation/result-schema';
import type { LocalAIService } from '../ai';
import { runScenarioWithModel } from './modelRun';
import { runRules } from './rulesRun';

/**
 * The only door between the app and the ml/ workspace. It loads scenario INPUTS (statements only);
 * reference answers are not in the bundle, so nothing on the phone can score or peek at them.
 */
function loadInputs(split: Split): { scenarios: ScenarioInput[]; sha256: string } {
  const manifest = require('../../ml/fixtures/manifest.json') as Record<Split, string>;
  const file =
    split === 'development'
      ? require('../../ml/fixtures/development/inputs.json')
      : split === 'validation'
        ? require('../../ml/fixtures/validation/inputs.json')
        : require('../../ml/fixtures/held_out/inputs.json');
  return { scenarios: (file as { scenarios: ScenarioInput[] }).scenarios, sha256: manifest[split] };
}

export interface SplitRunInput {
  split: Split;
  variant: Variant;
  /** Built for this variant by the composition root. Not used for 'rules'. */
  ai: LocalAIService;
  promptVersion: string;
  commit: string;
  device: RunResult['header']['device'];
  packageVersion: string;
  conditions: string;
  now?: () => Date;
  onProgress?: (done: number, total: number) => void;
  shouldStop?: () => boolean;
}

/** Runs every scenario of a split, one after another, and returns the result file's contents. */
export async function runSplit(input: SplitRunInput): Promise<RunResult> {
  const { scenarios, sha256 } = loadInputs(input.split);
  const startedAt = (input.now?.() ?? new Date()).toISOString();
  const records: RunResult['records'] = [];
  for (const [index, scenario] of scenarios.entries()) {
    if (input.shouldStop?.()) break;
    if (input.variant === 'rules') records.push(runRules(scenario));
    else {
      const extractionOnly = input.variant === 'quotes' || input.variant === 'nested';
      // A scenario that throws is left out of the records, which the scorer counts as not completed.
      try {
        records.push(await runScenarioWithModel(input.ai, scenario, { clarify: !extractionOnly, extractionOnly }));
      } catch {
        // Deliberately silent: no scenario text may reach a log.
      }
    }
    input.onProgress?.(index + 1, scenarios.length);
  }
  return {
    header: {
      runner: input.device.isPhysicalDevice ? 'device' : 'mac-simulated',
      variant: input.variant,
      split: input.split,
      inputsSha256: sha256,
      promptVersion: input.promptVersion,
      commit: input.commit,
      startedAt,
      device: input.device,
      packageVersion: input.packageVersion,
      conditions: input.conditions,
    },
    records,
  };
}
