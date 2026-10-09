# Local AI

Status (2026-10-10): the adapter is **implemented and unit-tested against a fake runtime** (`npx jest src/ai`: 24 passed), and the package's native pod compiles on React Native 0.86.3 (EAS build `fbc85457`). **No inference has been run on any device or simulator.** The package facts in "Verified package behaviour" come from reading the `@react-native-ai/apple` 0.12.0 source, not from running it. How the real model behaves, including the error wording the classifier matches, is UNVERIFIED.

## Position

- The primary and only planned AI provider is Callstack's `@react-native-ai/apple`, called through the Vercel AI SDK (`ai@6`). See [ADR/0001](ADR/0001-callstack-primary-provider.md).
- No custom Swift wrapper for Apple Foundation Models will be written while the package covers the capability.
- There is no cloud fallback. If the model is unavailable, the app will say so and send the original report.
- AI output is always a proposal. Only a human event can confirm a claim.
- Manual SOS never waits for, or depends on, any AI call.

## Verified package behaviour (0.12.0 source)

| Topic | Fact |
| --- | --- |
| Structured output | `generateText({ model: apple(), output: Output.object({ schema }) })`. Non-streaming only; streaming JSON throws. |
| Schema limits | Schemas sent to the model must avoid `.nullable()`, `z.literal`, `$ref`, `oneOf`, `multipleOf`, and combined min + max. |
| Context window | 4096 tokens, covering instructions, schema and response together. |
| Availability | `apple.isAvailable()` returns one boolean with no reason. |
| Error codes | Only `MODEL_UNAVAILABLE` has its own code. Guardrail refusal, unsupported language and context overflow all arrive with code `AppleLLM` and a message. |
| Embeddings | iOS 17+. Need `prepare()`. Reject `tl` / `fil` as a language. |
| Transcription | iOS 26. Takes complete audio-file bytes (WAV is the proven path). No streaming. |
| Text to speech | Uses the system synthesizer. |
| Native config | No config plugin, entitlements or Info.plist keys needed by the package. |

**UNVERIFIED:** `fil-PH` transcription support (unknown until probed on a phone). Embeddings and transcription on the iPhone 14 Pro Max and iPhone 13. Whether the package runs on RN 0.86 (it builds: EAS build `fbc85457`).

## Architecture

As built.

```
Screens -> PulseProvider -> PulseCore            (src/services)
   |
LocalAIService            (interface, src/ai/types.ts)
   |
   +-- evidence check     (src/ai/evidence.ts; verbatim span must exist in the report;
   |                       proposals containing medical-judgement words are discarded)
   +-- error classifier   (src/ai/classifyError.ts; maps provider errors to typed states)
   |
CallstackAppleAIAdapter   (src/ai/callstack; only importer of @react-native-ai/apple and ai)
   +-- prompts.ts         (system prompts and model-facing schemas)
   +-- appleRuntime.ts    (the thin wrapper over the package; replaced by a fake in tests)
```

The deterministic rules engine (floor and building extraction, explicit conflict detection, no model) is not in `src/ai/`. It lives in `src/domain/rules/` and runs inside the domain commands.

The DEMO bundle supplies `src/demo/SimulatedAI.ts`, a keyword-matching implementation of the same interface. Every result it returns carries `source: 'simulated'` and `latencyMs: 0`. If the Callstack adapter cannot be loaded in LIVE, every AI call returns a `native_error` result (`ai_module_unavailable`) and the rest of the app carries on (`src/services/__tests__/live.test.ts`).

## `LocalAIService` interface

As in `src/ai/types.ts`:

```
LocalAIService:
  inspectCapabilities(): Promise<CapabilityMatrix>
  extractIncidentReport(raw: { text }): Promise<AIResult<IncidentProposal>>
  suggestClarification(context: IncidentContext): Promise<AIResult<ClarificationProposal>>
  findConflicts(statements: { id, author, text }[]): Promise<AIResult<ConflictProposal[]>>
  proposeNonMedicalTasks(context: IncidentContext): Promise<AIResult<TaskProposal[]>>
  compareSemanticReports(a: string, b: string): Promise<SimilarityResult>
  transcribeLocal(audio: { wavBytes }, locale: string): Promise<AIResult<Transcript>>
```

Every method resolves and never rejects. There is no text-to-speech method.

## Typed result states

Every call returns an `AIResult<T>` and never throws to the UI. State is tracked **per capability** (text, embeddings, transcription, speech), not as one global flag.

| State | Meaning | What the user will see |
| --- | --- | --- |
| `ready` | Call succeeded and output was validated. | Proposal with provenance tags. |
| `unavailable` | Provider reports the model is not available on this device or right now. | "Local AI unavailable — sending original report." |
| `unsupported_locale` | Language or locale is rejected. | Original text kept; typed input offered. |
| `model_assets_missing` | Model or language assets are not downloaded or prepared. | Prompt to prepare while online, or continue without. |
| `guardrail_refusal` | The model declined the input. | Original report kept; no proposal. |
| `timeout` | The call exceeded its time budget. | Original report kept; retry offered. |
| `invalid_output` | Output failed Zod validation or the evidence check. | No proposal, or fields dropped to `unknown`. |
| `native_error` | Any other provider error. | Original report kept. |

In every non-`ready` state the incident is already persisted and queued.

## Error classification

Because 0.12.0 gives only `MODEL_UNAVAILABLE` a distinct code, `classifyAIError` (`src/ai/classifyError.ts`) classifies by message text, in this order:

1. The adapter's own timeout (20 s by default) → `timeout`.
2. Code `MODEL_UNAVAILABLE`, or "not available" wording → `unavailable`.
3. Abort or time-out wording → `timeout`.
4. Guardrail, safety or refusal wording → `guardrail_refusal`.
5. Unsupported language or locale wording → `unsupported_locale`.
6. Missing or undownloaded assets wording → `model_assets_missing`.
7. No-object or parse-failure wording from the AI SDK → `invalid_output`.
8. Anything unmatched → `native_error`. This includes context overflow: "Exceeded model context window size" is tested to map to `native_error`.

This is fragile by nature: message wording can change between OS releases. The patterns live in one file with tests, and the fallback is always `native_error`, never a guess. The patterns were written from the package source and from expected wording; none has been compared with an error from a real device.

## Structured-output constraints

- One short task per call, because 4096 tokens covers instructions, schema and response.
- Non-streaming calls only for structured output.
- Two schemas per task:
  - a **model-facing** schema that avoids `.nullable()`, `z.literal`, `$ref`, `oneOf`, `multipleOf` and combined min + max; uses `.optional()` and string enums;
  - a **strict** application schema applied afterwards in app code.
- Extraction, clarification, conflict notes and task proposals are separate small calls.
- No provider tool calling for actions. Domain mutations happen only in deterministic code after a human event.

## Evidence-span check

Implemented in `src/ai/evidence.ts` and applied by the adapter to extraction:

1. Each extracted field must carry a verbatim span quoted from the original report.
2. A deterministic check looks for that span in the original text, ignoring case and whitespace.
3. If the span is not found, the field is discarded and listed under `dropped`; fields with no value are listed under `unknown`.
4. A value or span containing a medical-judgement word (severity, diagnosis, triage and similar) is discarded.
5. The model is never asked for, and the strict schema has no field for, diagnosis, injury severity, priority, age or coordinates; output with such extra keys fails validation.

The reducer repeats the span check when the proposal is recorded (`AIFinding.evidenceVerified`).

## Other capabilities

| Capability | Use | Constraint | Code status |
| --- | --- | --- | --- |
| Clarification | At most one optional question at a time; skipping leaves the field `unknown`. | Non-blocking. Medical questions and questions about known or skipped fields are rejected. | IMPLEMENTED, UNIT-TESTED |
| Conflict notes | Model may describe a possible contradiction. | The deterministic rules engine detects explicit floor/building conflicts without the model. Nothing is auto-resolved. | IMPLEMENTED, UNIT-TESTED. In the app the path runs only when text is `ready`, and no test shows it adding a flag the rules had not already raised. |
| Task proposals | Simple non-medical coordination tasks, at most three. | A human must accept voluntarily. | IMPLEMENTED, UNIT-TESTED |
| Embeddings | Possible-duplicate hints, language `en`. | Tagalog is reported as unsupported unless probing shows otherwise. No percent-confidence UI. | Adapter method IMPLEMENTED, UNIT-TESTED; nothing in the app calls it, so there are no duplicate hints yet. |
| Transcription | `expo-audio` records to WAV; the file bytes go to the adapter. | `fil-PH` is UNVERIFIED; fallback is typed text. | IMPLEMENTED, UNIT-TESTED with a fake runtime and an injected file reader. Recording has never run. |
| Text to speech | Optional readout (P8). | Never blocks SOS. | NOT STARTED |

## Privacy

- Raw reports, prompts and model output are not written to logs, crash reports or analytics. This holds by absence of logging in `src/ai/`, `src/services/` and `src/sync/`, not by a test.
- Diagnostics show package version, per-feature state, latency and whether the source is real or simulated.
- Planned, not confirmed in code: a proposal received from another device is labelled as received, not as local inference on this device.

## Diagnostics screen

`Demo Lab > Local AI` (`src/app/demo-lab/local-ai.tsx`, `src/components/settings/LocalAIDiagnosticsScreen.tsx`): provider name, package version, per-capability state, latency of the last call, device model, real or simulated source. Unit-tested in `src/components/__tests__/screens.test.tsx`; not yet looked at in the simulator or on a phone. In LIVE it re-runs extraction on a report already stored on the device; free text is offered in Demo only, because the service contract has no free-text extraction call.

## Test evidence

No on-device inference has been run. All AI tests use a fake runtime.

| Item | Status | Evidence |
| --- | --- | --- |
| Adapter unit tests with a fake model (refusal, malformed output, timeout, invented floor or severity) | UNIT-TESTED | `src/ai/__tests__/CallstackAppleAIAdapter.test.ts`: 24 passed (2026-10-09; whole suite re-run 2026-10-10). |
| Error classifier tests | UNIT-TESTED | Same file, seven provider-error cases. The wording is assumed, not captured from a device. |
| Evidence-span check tests | UNIT-TESTED | Same file ("keeps only fields whose evidence is verbatim in the report"). |
| Service-level AI actions, clarification, transcription with an injected reader | UNIT-TESTED | `src/services/__tests__/ai.test.ts`. |
| Native pod compiles on RN 0.86.3 | BUILT | EAS build `fbc85457` contains `AppleLLM` and links `FoundationModels`. |
| Real inference on iPhone 17 Pro Max, external internet disabled, unseen input | BLOCKED | No build installed on the phone (install failed: device locked). Needs Apple Intelligence enabled and the model downloaded. |
| `fil-PH` transcription probe | NOT STARTED | — |
| Embeddings probe on each device | NOT STARTED | — |
