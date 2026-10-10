# ADR 0005 — Incident Delta Intelligence is deterministic first, with the model as an optional second stage

- Date: 2026-10-10
- Status: **Accepted, implementation in progress**
- Phase: after P7 (branch `feat/local-ai-intelligence`)

## Context

An incident collects statements over time: the reporter's account, later updates from the reporter, and observations from responders. A person reading the incident needs to know how each new statement relates to what was already known: whether it adds something, repeats it from a second source, corrects it, or disagrees with it. SAGIP must answer this on every device, including the iPhone 14 Pro Max and iPhone 13, which do not run the text model, and the answer must be the same on every device that holds the same events.

Facts established by reading the repository and the installed package:

- Claim revisions are append-only and carry their source (actor, role, kind) and the event that produced them. State is derived by replay; there is no stored status ([DOMAIN_MODEL.md](../DOMAIN_MODEL.md), [ADR 0004](0004-offline-event-synchronization.md)).
- The current conflict rule (`detectFieldConflicts` in `src/domain/rules/conflicts.ts`) compares every human statement after the latest confirmation with the statement leading the field. A reporter who corrects their own earlier statement is therefore flagged as contradicting themselves.
- The deterministic rules extract two fields only: floor and building (`src/domain/rules/location.ts`).
- The model's context window is 4096 tokens including instructions, schema and response ([ADR 0001](0001-callstack-primary-provider.md)).
- `eventTier` in `src/crypto/capsule.ts` puts any event type it does not name in the `summary` tier. `AI_PROPOSAL_CREATED` is named and is restricted (`detail`, or `withheld` when the policy shares the report text with nobody).
- In `@react-native-ai/apple` 0.12.0 the non-streaming generation path (`doGenerate` in `src/ai-sdk.ts`) calls the native `generateText` and does not read the abort signal. The only cancellation in the package source is `cancelStream`, for streaming. Structured output is non-streaming.
- `src/domain/__tests__/schema.test.ts` asserts the exact list of added event types.

The invariants that bound the design: model output is a proposal and never changes a confirmed human claim without a human event; a contradiction is not resolved automatically and both statements are kept; manual SOS never waits on AI; no diagnosis, severity or medical instruction.

## Decision

1. **Deterministic first.** A pure function in `src/domain/rules/delta.ts`, `classifyStatementDelta(state, reportId)`, derives how a new statement relates to earlier evidence from the claim revisions. The classes are:
   - new information;
   - confirmation: a second source states the same value;
   - correction: the same author changes their own statement, including movement such as "moved from the first floor to the second";
   - possible contradiction: different authors disagree, or the statement differs from a reporter-confirmed claim;
   - no meaningful change;
   - `not_assessed`: the rules extracted nothing from the statement.

   The result is derived at replay and never persisted. It runs on every device. It compares only the new statement's revisions with each field's earlier revisions and does not re-read history. The deterministic layer never says "unrelated".
2. **The conflict rule changes.** Only each author's latest statement per field is compared, so a self-correction no longer flags a contradiction. Differences between authors, and differences from a confirmed claim, still flag. An open contradiction is never closed automatically. Both statements are always kept.
3. **The model is an optional second stage, on capable devices only, for what the rules cannot see.** It receives the new statement and one line per field of current values, never the history. It returns a relation per field (not mentioned / same / different / updated) with a quote. The class is computed in code from the relation and the authorship, so the model never chooses between correction and contradiction. Output is validated: strict schema, the quote located in the statement, the value grounded in the quote, no medical or severity content. For floor and building the rules override the model.
4. **The model's verdict is one new appended event, `STATEMENT_ASSESSED`.** It carries only ids, classes and an evidence span: no free text and no values. Values travel as an ordinary `AI_PROPOSAL_CREATED`. It is a proposal: the reducer records it and changes no claim and no contradiction. Its id is deterministic, so concurrent devices that assess the same statement collapse to one event. In the capsule it is tiered as restricted, the same as AI proposals, because the default tier would expose it to summary-level recipients.
5. **Analysis runs off the critical path.** A bounded queue with deduplication per statement runs on the incident owner's device, and is also triggered when a responder's observation arrives. A result is re-checked against the current state under the ledger lock and dropped if the basis changed. Manual SOS never touches this path.
6. **Evaluation lives in a root `ml/` workspace.** Synthetic scenarios, with reference answers written and hash-frozen before any model run. Development, validation and held-out splits. A deterministic baseline scored on the Mac. Real-model results come only from exports produced on the iPhone 17 Pro Max by an in-app runner in Demo Lab. English and Taglish are reported separately. No number is written that does not come from a committed result file.

## Alternatives considered

- **Model-only delta classification.** Rejected: it does not run on the responder devices, it is not deterministic under replay, and its quality is unmeasured.
- **Persisting the deterministic delta as an event.** Rejected: it duplicates state that can be derived, and it adds sync and disclosure surface for no new information.
- **Re-analysing the whole incident on each update.** Rejected: context window, latency and battery.
- **Letting the model resolve or overwrite contradictions.** Rejected: it violates the human-authority invariant.

## Consequences

- One more event type beyond the documented vocabulary: 23 with `STATEMENT_ASSESSED`. Tests that assert the exact list change, and [DOMAIN_MODEL.md](../DOMAIN_MODEL.md) must be updated when the event lands.
- Only floor and building are rule-extracted today, so the deterministic layer sees little else. A statement about anything other than those two fields is `not_assessed` on a device without the model.
- "Unrelated" exists only where the model runs. Two devices can show different amounts of assessment for the same statement until the `STATEMENT_ASSESSED` event reaches the one without the model, and a recipient whose level excludes the restricted tier never receives it.
- A reporter's self-correction is no longer shown as a contradiction. A statement that the old rule would have flagged between the same author's earlier and later words is now a correction; the earlier statement stays in the history.
- The package does not honour abort for structured generation, so a call that timed out in the adapter still occupies the model until the native call returns. The queue is bounded for this reason, and it does not make the model available sooner.
- The assessment is advisory. It adds text to the Intelligence view and changes no claim, no contradiction and no status.
- The evaluation is on synthetic scenarios written by the team. Results will say how the system does on those scenarios and nothing about real incidents.
- A new event type that is tiered wrongly would leak to summary-level recipients; the tier is set explicitly and needs a test.

## Verification

Updated 2026-10-10 after implementation. Model behaviour on a device is still unverified beyond the single observations logged in `ml/benchmarks/device-results/DEVICE_RUNS.md`; no scored device run exists yet.

| Evidence required | Status |
| --- | --- |
| Jest for `classifyStatementDelta`: each class, self-correction, movement, a second source, a difference from a confirmed claim, `not_assessed` | Present: `src/domain/__tests__/delta.test.ts`, `rules.test.ts` |
| Jest for the changed conflict rule | Present: `src/domain/__tests__/delta.test.ts` |
| Jest showing `STATEMENT_ASSESSED` changes no claim or contradiction, collapses across runs, is absent from sent projections and is tiered restricted | Present: `src/domain/__tests__/assessment.test.ts`, `src/crypto/__tests__/capsule.test.ts` |
| Jest showing a result is dropped when the state changed while the model ran, and that manual SOS does not depend on this path | Present: `src/services/__tests__/analysis.test.ts` (stale drop; SOS with the lane full, throwing and hanging) |
| Frozen scenario hashes committed before the first model run, and the deterministic baseline result | Present: `ml/datasets/FROZEN.json`, `ml/benchmarks/mac-results/`, `ml/RESULTS.md` |
| An export from the iPhone 17 Pro Max with external internet disabled, English and Taglish reported separately | **Missing.** The in-app runner exists; no file has been exported and scored. |

Changes to the decision made during implementation, each after independent review:

- Only the incident owner's device may record an assessment or an AI proposal. The original text allowed any participant.
- An assessment can add to what the rules found for a statement but never replace or soften it in what is shown.
- A different person's differing reading is not stored as the field's proposal; it is raised as a question in fixed wording.
- "What is already known" for the model stage is everything else on record, not what precedes the statement in replay order.
- The movement rule requires a first-person statement, and near-duplicate detection is exact repeats only.
- Two held-out scenarios were exposed during rule changes and are excluded from held-out scoring (`ml/datasets/EXPOSED.json`).
