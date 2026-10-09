import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { SPLITS, type Split } from '../datasets/schema';
import { runBaseline } from './baseline';
import {
  FROZEN_PATH,
  MANIFEST_PATH,
  ML_ROOT,
  fixturePath,
  frozenFiles,
  hashFile,
  listResultFiles,
  loadScenarios,
  readJson,
  renderFixtures,
  scoredScenarios,
  sha256,
  verify,
  type Frozen,
} from './datasets';
import { renderFailures } from './failure-analysis';
import { deviceClaimProblems, renderRun } from './report';
import { runResultSchema, type RunResult } from './result-schema';

/**
 * Evaluation entry point. Run with `npx tsx ml/evaluation/run-evaluation.ts <command>`:
 *   fixtures            write fixtures/<split>/{inputs,reference}.json from the datasets
 *   freeze "<note>"     record the sha256 of datasets and fixtures in datasets/FROZEN.json
 *   verify              check datasets validate, fixtures are current and nothing changed after the freeze
 *   baseline [split]    run the deterministic baseline on the Mac and save the result (held_out only when named)
 *   score <file>        print the tables and failure analysis for one result file
 *   report              rewrite the generated section of RESULTS.md from every saved result file
 */

const MAC_RESULTS = join(ML_ROOT, 'benchmarks', 'mac-results');
const DEVICE_RESULTS = join(ML_ROOT, 'benchmarks', 'device-results');
const HELD_OUT_LOG = join(ML_ROOT, 'benchmarks', 'held-out-log.json');
const RESULTS_MD = join(ML_ROOT, 'RESULTS.md');
const BEGIN = '<!-- BEGIN GENERATED RESULTS: written by `npm run ml:report`, do not edit by hand -->';
const END = '<!-- END GENERATED RESULTS -->';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const asSplit = (value: string | undefined): Split => (SPLITS.includes(value as Split) ? (value as Split) : fail(`split must be one of ${SPLITS.join(', ')}`));

function requireVerified(): void {
  const problems = verify();
  if (problems.length > 0) fail(`Refusing to run: the datasets are not verified.\n${problems.map((p) => `- ${p}`).join('\n')}`);
}

function loadRun(file: string): RunResult {
  const run = runResultSchema.parse(readJson(file));
  const expected = sha256(readFileSync(fixturePath(run.header.split, 'inputs.json'), 'utf8'));
  if (run.header.inputsSha256 !== expected) fail(`${file} was produced from different inputs than fixtures/${run.header.split}/inputs.json`);
  const problems = deviceClaimProblems(run);
  if (problems.length > 0) fail(`${file} claims to be a device run but ${problems.join('; ')}`);
  return run;
}

/**
 * A held-out result is looked at once per prompt version, variant and runner. A second look needs a
 * written reason. Every way of seeing held-out numbers (score, report, baseline) goes through here.
 */
type Look = { file: string; runner: string; promptVersion: string; variant: string; reason: string };
const readLooks = (): Look[] => (existsSync(HELD_OUT_LOG) ? (readJson(HELD_OUT_LOG) as Look[]) : []);

function recordHeldOutLook(run: RunResult, file: string, reason: string | undefined): void {
  if (run.header.split !== 'held_out') return;
  const log = readLooks();
  if (log.some((e) => e.file === basename(file))) return;
  const earlier = log.filter((e) => e.promptVersion === run.header.promptVersion && e.variant === run.header.variant && e.runner === run.header.runner);
  if (earlier.length > 0 && !reason) {
    fail(`Held-out was already scored for ${run.header.runner} / ${run.header.variant} / prompt ${run.header.promptVersion}. Pass --reason "<why>" to record a second look.`);
  }
  log.push({ file: basename(file), runner: run.header.runner, promptVersion: run.header.promptVersion, variant: run.header.variant, reason: reason ?? 'first look' });
  mkdirSync(dirname(HELD_OUT_LOG), { recursive: true });
  writeFileSync(HELD_OUT_LOG, `${JSON.stringify(log, null, 2)}\n`);
}

/** The report never takes the first look itself: a held-out file has to be scored, and so logged, first. */
function requireLogged(run: RunResult, file: string): void {
  if (run.header.split === 'held_out' && !readLooks().some((e) => e.file === basename(file))) {
    fail(`${file} is a held-out result that has not been scored yet. Run ml:score on it first; that records the look.`);
  }
}

/** Where a file sits must agree with what it says it is. */
function requirePlacement(run: RunResult, file: string, place: 'device' | 'mac'): void {
  if (place === 'device' && run.header.runner !== 'device') fail(`${file} is in device-results but its runner is ${run.header.runner}`);
  if (place === 'mac' && run.header.runner === 'device') fail(`${file} is a device run and belongs in device-results`);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'fixtures': {
    const scenarios = loadScenarios();
    const manifest: Record<string, string> = {};
    for (const split of SPLITS) {
      const rendered = renderFixtures(split, scenarios);
      manifest[split] = sha256(rendered.inputs);
      mkdirSync(dirname(fixturePath(split, 'inputs.json')), { recursive: true });
      writeFileSync(fixturePath(split, 'inputs.json'), rendered.inputs);
      writeFileSync(fixturePath(split, 'reference.json'), rendered.reference);
      console.log(`${split}: ${scenarios.filter((s) => s.split === split).length} scenarios`);
    }
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    break;
  }
  case 'freeze': {
    const note = args[0] ?? fail('freeze needs a note saying why the answers are being (re)frozen');
    if (existsSync(FROZEN_PATH) && !args.includes('--refreeze')) fail('Already frozen. Changing reference answers after a model run invalidates earlier results; pass --refreeze and say why in the note.');
    const frozen: Frozen = { frozenAt: new Date().toISOString(), note, files: Object.fromEntries(frozenFiles().map((f) => [f, hashFile(f)])) };
    writeFileSync(FROZEN_PATH, `${JSON.stringify(frozen, null, 2)}\n`);
    console.log(`Frozen ${Object.keys(frozen.files).length} files.`);
    break;
  }
  case 'verify': {
    const problems = verify();
    if (problems.length > 0) fail(problems.map((p) => `- ${p}`).join('\n'));
    const scenarios = loadScenarios();
    console.log(`OK: ${scenarios.length} scenarios, fixtures current, nothing changed since the freeze.`);
    break;
  }
  case 'baseline': {
    requireVerified();
    mkdirSync(MAC_RESULTS, { recursive: true });
    // Held-out is run only when asked for by name, once the rules are final: it is not a tuning signal.
    for (const split of args[0] ? [asSplit(args[0])] : SPLITS.filter((x) => x !== 'held_out')) {
      const file = join(MAC_RESULTS, `baseline-rules-${split}.json`);
      const run = runBaseline(split);
      const reasonAt = args.indexOf('--reason');
      recordHeldOutLook(run, file, reasonAt >= 0 ? args[reasonAt + 1] : undefined);
      writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
      console.log(`wrote ${relative(process.cwd(), file)}`);
    }
    break;
  }
  case 'score': {
    requireVerified();
    const file = args[0] ?? fail('score needs a result file');
    const run = loadRun(file);
    const reasonAt = args.indexOf('--reason');
    recordHeldOutLook(run, file, reasonAt >= 0 ? args[reasonAt + 1] : undefined);
    const scenarios = scoredScenarios(run.header.split);
    console.log(renderRun(scenarios, run, relative(ML_ROOT, file)));
    console.log(`\n${renderFailures(scenarios, run)}`);
    break;
  }
  case 'report': {
    requireVerified();
    const section = (title: string, intro: string, files: string[], place: 'device' | 'mac') => {
      const body = files.map((file) => {
        const run = loadRun(file);
        requirePlacement(run, file, place);
        requireLogged(run, file);
        return renderRun(scoredScenarios(run.header.split), run, relative(ML_ROOT, file));
      });
      return [`## ${title}`, '', intro, '', body.length > 0 ? body.join('\n\n') : '_No result file yet. Unverified._'].join('\n');
    };
    const generated = [
      BEGIN,
      '',
      section(
        'On-device model results (iPhone)',
        'Produced by the in-app runner on a physical iPhone through `@react-native-ai/apple`. Only files whose every model call came from the on-device provider are accepted here.',
        listResultFiles(DEVICE_RESULTS),
        'device',
      ),
      '',
      section(
        'Deterministic baseline and simulated runs (Mac)',
        'Run under Node on the development Mac. These involve no language model and are never to be read as model results. Latency is not reported for them.',
        listResultFiles(MAC_RESULTS),
        'mac',
      ),
      '',
      END,
    ].join('\n');
    const current = existsSync(RESULTS_MD) ? readFileSync(RESULTS_MD, 'utf8') : `# Results\n\n${BEGIN}\n${END}\n`;
    const start = current.indexOf(BEGIN);
    const end = current.indexOf(END);
    if (start < 0 || end < 0) fail('RESULTS.md has no generated-section markers');
    writeFileSync(RESULTS_MD, `${current.slice(0, start)}${generated}${current.slice(end + END.length)}`);
    console.log('RESULTS.md updated.');
    break;
  }
  default:
    fail('usage: run-evaluation.ts fixtures | freeze "<note>" | verify | baseline [split] | score <file> [--reason "<why>"] | report');
}
