# ADR 0001 — Callstack Apple provider is the primary local AI integration

- Date: 2026-10-09
- Status: **Accepted, implementation pending**
- Phase: P4 (spike in P1)

## Context

The hackathon theme is Local AI: inference must run on the device, and the product must stay useful without cloud inference. The PULSE master specification requires `@react-native-ai/apple` (Callstack) with the Vercel AI SDK as the primary integration, and forbids a redundant custom Swift wrapper for capabilities the package already exposes.

Facts established by reading the package source and the npm registry:

- `@react-native-ai/apple` 0.12.0 is the published release and targets AI SDK v6. `ai@latest` is v7.
- GitHub `main` of the package has typed errors but needs the iOS 26.4 SDK. The development Mac has Xcode 26.3 with the 26.2 SDK.
- Structured output works through `generateText` with `Output.object`, non-streaming only.
- Model-facing schemas cannot use `.nullable()`, `z.literal`, `$ref`, `oneOf`, `multipleOf`, or combined min + max.
- The context window is 4096 tokens including instructions, schema and response.
- Only `MODEL_UNAVAILABLE` has a distinct error code; other failures share code `AppleLLM` with a message.
- `apple.isAvailable()` is a single boolean.
- Upstream tests the package on Expo SDK 54 / RN 0.81 only.

## Decision

1. Use `@react-native-ai/apple` 0.12.0 from npm with `ai@6.0.302` for text, structured output, embeddings, transcription and speech.
2. Wrap it in one TypeScript adapter, `CallstackAppleAIAdapter`, behind the `LocalAIService` interface. Only `src/ai/callstack/` may import `@react-native-ai/apple` or `ai`; ESLint enforces this.
3. Do not write a Swift Foundation Models bridge.
4. Return typed result states per capability: `ready`, `unavailable`, `unsupported_locale`, `model_assets_missing`, `guardrail_refusal`, `timeout`, `invalid_output`, `native_error`.
5. Classify provider errors by message text, defaulting to `native_error`.
6. One small non-streaming task per call. Loose model-facing schema, strict Zod validation afterwards, plus a deterministic evidence-span check.
7. No provider tool calling for actions. No cloud fallback.
8. If the package cannot be built on RN 0.86 after three distinct attempts, fall back to Expo SDK 54 / RN 0.81.5 rather than replace the provider.

## Consequences

- The project benefits from a maintained provider and stays aligned with the hackathon's Local AI criterion.
- Error handling is weaker than it would be with typed errors; message matching may break across OS releases and needs tests and a safe default.
- The 4096-token window forces short, separate calls and limits long reports.
- Text-model features exist only on Apple Intelligence-capable hardware; the other two test phones never run it.
- The project is exposed to an untested combination (RN 0.86), mitigated by the predefined fallback.
- A new ADR is required before adding any second model runtime or native AI bridge.

## Verification

Not yet verified. Evidence required: a successful device build, and a real inference on the iPhone 17 Pro Max with external internet disabled (gate G4). See [LOCAL_AI.md](../LOCAL_AI.md).
