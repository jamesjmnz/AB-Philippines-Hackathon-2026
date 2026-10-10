# Results

Every table in the generated section below is produced by `npm run ml:report` from the result files
committed under `ml/benchmarks/`. Nothing in that section is typed by hand. A section that says
"No result file yet. Unverified." means exactly that: it has not been run.

How to read the numbers:

- Each rate is `hits/total (percent)`. The sets are small (18 development, 12 validation, 16 scored
  held-out scenarios, half English and half Taglish), so a difference of one or two cases is not a finding.
- English and Taglish are separate columns. There is no pooled number.
- A failed model call counts against the pipeline: a field it never produced is a miss.
- "Deterministic baseline" rows involve no language model. They are the app's own wording rules
  (floor, building, movement, delta classes, conflicts) and are what an iPhone without the Apple model
  runs. They are the comparison point for the model rows, not a model result.
- Latency appears only for runs on a physical iPhone.

Reproduce:

```bash
npm run ml:verify                                   # datasets validate, nothing changed since the freeze
npm run ml:baseline                                 # writes ml/benchmarks/mac-results/baseline-rules-<split>.json
npm run ml:score -- ml/benchmarks/device-results/<file>.json
npm run ml:report                                   # rewrites the section below
```

Device runs are started on the phone (Settings > Demo Lab > Local AI > Evaluation run) and the exported
file is saved into `ml/benchmarks/device-results/`. Conditions of each run are in
[benchmarks/device-results/DEVICE_RUNS.md](benchmarks/device-results/DEVICE_RUNS.md). Experiments,
including the ones that did not work, are in [experiments/](experiments/).

<!-- BEGIN GENERATED RESULTS: written by `npm run ml:report`, do not edit by hand -->

## On-device model results (iPhone)

Produced by the in-app runner on a physical iPhone through `@react-native-ai/apple`. Only files whose every model call came from the on-device provider are accepted here.

_No result file yet. Unverified._

## Deterministic baseline and simulated runs (Mac)

Run under Node on the development Mac. These involve no language model and are never to be read as model results. Latency is not reported for them.

### mac-baseline · rules · development

Source file `benchmarks/mac-results/baseline-rules-development.json`. Mac (Node), OS v22.23.2, physical device: no. Commit `3ec7758`, prompt version `none`, started 2026-10-10T00:03:32.694Z.
Conditions: Deterministic rules only, no model, run under Node on the development Mac.

| metric | English (9 scenarios) | Taglish (9 scenarios) |
| --- | --- | --- |
| Field correctness (stated fields proposed correctly) | 13/44 (29.5%) | 10/38 (26.3%) |
| Unknown kept unknown | 8/8 (100.0%) | 13/13 (100.0%) |
| Unsupported-fact rate (of proposed values) | 0/13 (0.0%) | 0/10 (0.0%) |
| Delta class accuracy | 7/11 (63.6%) | 7/11 (63.6%) |
| Delta macro-F1 | 0.667 | 0.611 |
| Delta field-level accuracy | 9/12 (75.0%) | 9/14 (64.3%) |
| Conflict precision | 2/2 (100.0%) | 2/2 (100.0%) |
| Conflict recall | 2/2 (100.0%) | 2/2 (100.0%) |
| Clarification relevant | 7/9 (77.8%) | 4/9 (44.4%) |
| Scenarios leaking forbidden content | 0/1 (0.0%) | 0/1 (0.0%) |
| Schema validation passed | n/a (0) | n/a (0) |
| Evidence check passed (of proposed fields) | n/a (0) | n/a (0) |
| Calls completed | n/a (0) | n/a (0) |
| Failures by state | none | none |

| field | English | Taglish |
| --- | --- | --- |
| incidentType | 0/8 (0.0%) | 0/5 (0.0%) |
| building | 6/9 (66.7%) | 3/8 (37.5%) |
| floor | 7/7 (100.0%) | 7/7 (100.0%) |
| locationText | 0/8 (0.0%) | 0/8 (0.0%) |
| symptom | 0/7 (0.0%) | 0/5 (0.0%) |
| assistanceRequested | 0/5 (0.0%) | 0/5 (0.0%) |

Delta confusion, English:

| reference \ predicted | new_information | confirmation | correction | possible_contradiction | unrelated | no_meaningful_change | not_assessed | missing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| new_information | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| confirmation | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| correction | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| possible_contradiction | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 |
| unrelated | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| no_meaningful_change | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |

Delta confusion, Taglish:

| reference \ predicted | new_information | confirmation | correction | possible_contradiction | unrelated | no_meaningful_change | not_assessed | missing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| new_information | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| confirmation | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| correction | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| possible_contradiction | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 |
| unrelated | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| no_meaningful_change | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |

### mac-baseline · rules · validation

Source file `benchmarks/mac-results/baseline-rules-validation.json`. Mac (Node), OS v22.23.2, physical device: no. Commit `3ec7758`, prompt version `none`, started 2026-10-10T00:03:32.725Z.
Conditions: Deterministic rules only, no model, run under Node on the development Mac.

| metric | English (6 scenarios) | Taglish (6 scenarios) |
| --- | --- | --- |
| Field correctness (stated fields proposed correctly) | 6/27 (22.2%) | 5/25 (20.0%) |
| Unknown kept unknown | 9/9 (100.0%) | 9/9 (100.0%) |
| Unsupported-fact rate (of proposed values) | 0/6 (0.0%) | 0/5 (0.0%) |
| Delta class accuracy | 4/10 (40.0%) | 3/8 (37.5%) |
| Delta macro-F1 | 0.556 | 0.444 |
| Delta field-level accuracy | 4/8 (50.0%) | 6/10 (60.0%) |
| Conflict precision | 1/1 (100.0%) | n/a (0) |
| Conflict recall | 1/2 (50.0%) | 0/2 (0.0%) |
| Clarification relevant | 2/6 (33.3%) | 3/6 (50.0%) |
| Scenarios leaking forbidden content | 0/1 (0.0%) | 0/1 (0.0%) |
| Schema validation passed | n/a (0) | n/a (0) |
| Evidence check passed (of proposed fields) | n/a (0) | n/a (0) |
| Calls completed | n/a (0) | n/a (0) |
| Failures by state | none | none |

| field | English | Taglish |
| --- | --- | --- |
| incidentType | 0/6 (0.0%) | 0/6 (0.0%) |
| building | 2/4 (50.0%) | 3/4 (75.0%) |
| floor | 4/4 (100.0%) | 2/3 (66.7%) |
| locationText | 0/6 (0.0%) | 0/6 (0.0%) |
| symptom | 0/2 (0.0%) | 0/4 (0.0%) |
| assistanceRequested | 0/5 (0.0%) | 0/2 (0.0%) |

Delta confusion, English:

| reference \ predicted | new_information | confirmation | correction | possible_contradiction | unrelated | no_meaningful_change | not_assessed | missing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| new_information | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| confirmation | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| correction | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| possible_contradiction | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| unrelated | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| no_meaningful_change | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |

Delta confusion, Taglish:

| reference \ predicted | new_information | confirmation | correction | possible_contradiction | unrelated | no_meaningful_change | not_assessed | missing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| new_information | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| confirmation | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| correction | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| possible_contradiction | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| unrelated | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| no_meaningful_change | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |

<!-- END GENERATED RESULTS -->

## Findings and failed attempts

Written by hand, each tied to evidence above or in `experiments/`.

### Before any scenario was scored (2026-10-10, iPhone 17 Pro Max, build `512bf15c`, JS from Metro)

- **First real extraction failed.** The original prompt (six nested `{value, evidence}` objects,
  `maxOutputTokens` 500) returned `invalid_output` after 4362 ms with the native message "Failed to
  deserialize a Generable type from model output". A different sentence succeeded at 1500 tokens. The
  likely cause is the answer being cut off by the token limit; that was not isolated.
- **The model paraphrased and misassigned.** On the owner's own sentence it proposed "head injury" for
  the words "my head striked first", and put "fall" under the place field. The evidence check passed both,
  because each quote was in the text. This is why extraction was changed to copying phrases only, with
  the value derived in code, and why a value must now follow from its quote.
- **Output shapes.** A probe on one built-in sentence returned for all six shapes tried (plain text,
  JSON asked in the prompt, and four schema shapes) in 396 to 1403 ms each. Guided generation with a
  schema is not the problem; long structured answers are.

### Rules changed because of the development split

These are changes made after looking at development-split failures of the deterministic baseline.
Validation and held-out cases were not looked at for them.

- A responder writing where they themselves are ("I'm on the first floor, coming up to you") was read as
  the requester's floor and raised a false contradiction (`con-en-002`). In an observation, a floor or
  building governed by a first-person subject now yields no claim.

### Rules changed because of independent review (not from any split)

- Movement detection ("moved from X to Y") set a wrong floor from sentences about fire, water or other
  people. It now requires a first-person subject and returns nothing on intent, attempts, questions,
  reported speech or a return. 31 reproduced false positives became tests.
- Near-duplicate matching marked statements with new or opposite meaning as "nothing new". Duplicates are
  now exact repeats only.

### Defects found by the second independent review, before any model was scored

None of these came from a split. All were reproduced by the reviewer and fixed with tests.

- A paired responder device could record its own assessment of a statement and so replace the owner's
  "differs from what was reported" row with "nothing new". Only the owner's device may now record one, and
  an assessment can add to the rules' reading but never weaken it.
- A responder's guess about the place could become the requester's displayed place detail, attributed to
  the requester. Causes: "what was known" was taken from logical-clock order, a proposal was attributed
  to the device that ran the model, and a differing reading was stored as the field's proposal. All three
  changed.
- A statement containing its own closing tag could end the data fence in the assessment prompt.
- A question could be raised again on a detail the person had skipped.
- Model-written question and task wording reached the screen (the reviewer got "An ambulance was called"
  through a fake provider). Both now use fixed wording; the model only chooses the field or task kind.
- In the value-plus-evidence arm a half-invented value ("stroke dizzy" for "dizzy") passed grounding.
  Every content word of a value must now be in its phrase.
- The severity filter was described as more than the short word list it is. The documents now say so.

### Held-out exposure (2026-10-10)

While tightening where the rules read a floor from, an agent ran a scratch script over every dataset
string without filtering by split, and adjusted the rules for sentences it surfaced. Two of them were
held-out scenarios: `delta-en-008` and `delta-tl-007`. Both adjustments are general, but they were prompted
by held-out text, so those two scenarios are listed in `datasets/EXPOSED.json` and are excluded from every
held-out score, for every runner. Held-out is therefore 16 scenarios, not 18. No held-out result of any
kind had been produced at that point, and none has been looked at since.

### Scorer changes after the freeze, before any model was scored

Reference answers are unchanged (the freeze still verifies). The scorer changed in three ways, none of
which can raise a pipeline's score: a free-text value longer than 12 words no longer matches (copying the
whole statement into every field had scored 80 to 84 percent on field correctness in the reviewer's
probe); a failed clarification call is a miss instead of being left out; and the rules baseline no longer
reports call-completion or validation rates, since it makes no calls.
