# Local AI

Status: **planned design**. No adapter code exists and no inference has been run (2026-10-09). The package facts in "Verified package behaviour" come from reading the `@react-native-ai/apple` 0.12.0 source, not from running it.

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

**UNVERIFIED:** `fil-PH` transcription support (unknown until probed on a phone). Whether the package builds on RN 0.86. Embeddings and transcription on the iPhone 14 Pro Max and iPhone 13.

## Planned architecture

```
UI / store
   |
LocalAIService            (interface, src/ai)
   |
   +-- rules engine       (deterministic; explicit floor/building conflicts; no model)
   +-- evidence check     (deterministic; verbatim span must exist in the report)
   +-- error classifier   (maps provider errors to typed states)
   |
CallstackAppleAIAdapter   (src/ai/callstack; only importer of @react-native-ai/apple and ai)
```

The DEMO bundle supplies a scripted implementation of the same interface, labelled SIMULATED.

## `LocalAIService` interface

From the PULSE master specification. Exact TypeScript shapes will be frozen in Phase 2 (contracts) and Phase 4 (adapter).

```
LocalAIService:
  inspectCapabilities(): Promise<CapabilityMatrix>
  extractIncidentReport(raw: OriginalReport): Promise<AIResult<IncidentProposal>>
  suggestClarification(context: IncidentContext): Promise<AIResult<ClarificationProposal>>
  findConflicts(statements: Claim[]): Promise<AIResult<ConflictProposal[]>>
  proposeNonMedicalTasks(context: IncidentContext): Promise<AIResult<TaskProposal[]>>
  compareSemanticReports?(a: string, b: string): Promise<SimilarityResult>
  transcribeLocal?(audio: LocalAudioInput, language: string): Promise<AIResult<Transcript>>
```

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

Because 0.12.0 gives only `MODEL_UNAVAILABLE` a distinct code, the adapter will classify by message text:

1. Code `MODEL_UNAVAILABLE` → `unavailable`.
2. Code `AppleLLM` with a message matching known refusal or language wording → `guardrail_refusal` or `unsupported_locale`.
3. Code `AppleLLM` with context-overflow wording → state to be decided in Phase 4 (there is no dedicated overflow state; `native_error` is the default until then).
4. Anything unmatched → `native_error`.

This is fragile by nature: message wording can change between OS releases. The match patterns will live in one file with tests, and the fallback is always `native_error`, never a guess.

## Structured-output constraints

- One short task per call, because 4096 tokens covers instructions, schema and response.
- Non-streaming calls only for structured output.
- Two schemas per task:
  - a **model-facing** schema that avoids `.nullable()`, `z.literal`, `$ref`, `oneOf`, `multipleOf` and combined min + max; uses `.optional()` and string enums;
  - a **strict** application schema applied afterwards in app code.
- Extraction, clarification, conflict notes and task proposals are separate small calls.
- No provider tool calling for actions. Domain mutations happen only in deterministic code after a human event.

## Evidence-span check

Planned for extraction:

1. Each extracted field must carry a verbatim span quoted from the original report.
2. A deterministic check looks for that span in the original text.
3. If the span is not found, the field is dropped to `unknown`.
4. The model is never asked for, and the schema has no field for, diagnosis, injury severity, priority, age or coordinates.

Example the tests will cover: for "Nadulas ako sa hagdan sa Building B. Masakit paa ko." the floor must remain `unknown`.

## Other capabilities

| Capability | Planned use | Constraint |
| --- | --- | --- |
| Clarification | At most one optional question at a time; skipping leaves the field `unknown`. | Non-blocking. |
| Conflict notes | Model may describe a possible contradiction. | The deterministic rules engine detects explicit floor/building conflicts without the model. Nothing is auto-resolved. |
| Task proposals | Simple non-medical coordination tasks. | A human must accept voluntarily. |
| Embeddings | Possible-duplicate hints, language `en`. | Tagalog will be reported as unsupported unless probing shows otherwise. No percent-confidence UI. |
| Transcription | `expo-audio` records to WAV; `prepare()` per locale. | `fil-PH` is UNVERIFIED; fallback is typed text. |
| Text to speech | Optional readout (P8). | Never blocks SOS. |

## Privacy

- Raw reports, prompts and model output will not be written to logs, crash reports or analytics.
- Diagnostics will show package version, per-feature state, measured latency and whether the source is real or simulated, with no report text.
- A proposal received from another device will be labelled as received, not as local inference on this device.

## Diagnostics screen (planned)

`Demo Lab > Local AI`: provider name, package version, per-capability state, measured latency of the last real call, device model, real or simulated source.

## Test evidence

No tests exist and no on-device inference has been run.

| Item | Status | Evidence |
| --- | --- | --- |
| Adapter unit tests with a fake model (refusal, malformed output, timeout, invented floor or severity) | NOT STARTED | — |
| Error classifier tests | NOT STARTED | — |
| Evidence-span check tests | NOT STARTED | — |
| Real inference on iPhone 17 Pro Max, external internet disabled, unseen input | NOT STARTED | — |
| `fil-PH` transcription probe | NOT STARTED | — |
| Embeddings probe on each device | NOT STARTED | — |
