# Implementation status

Last updated: 2026-10-09.

**Summary: nothing is implemented.** Phase 0 (audit and documentation) and the Phase 1 scaffold install are in progress. No feature code, no tests, no native build and no device verification exist.

Status words: `NOT STARTED`, `IN PROGRESS`, `IMPLEMENTED`, `UNIT-TESTED`, `BUILT`, `VERIFIED ON DEVICE`, `MOCKED`, `MISSING`, `BLOCKED`. See [README.md](README.md) for definitions. A feature may hold several at once (for example `IMPLEMENTED`, `UNIT-TESTED`); list all that have evidence.

## Feature matrix

| Area | Feature | Status | Verified on device | Phase | Evidence |
| --- | --- | --- | --- | --- | --- |
| Foundation | Repository audit and docs | IN PROGRESS | n/a | P0 | — |
| Foundation | Subagent profiles | IN PROGRESS | n/a | P0 | — |
| Foundation | Expo SDK 57 scaffold, TypeScript strict, Router, NativeWind, ESLint, Jest | IN PROGRESS | No | P1 | — |
| Foundation | EAS build profiles | NOT STARTED | No | P1 | — |
| Foundation | Native build with `@react-native-ai/apple` on RN 0.86 | NOT STARTED | No | P1 | — |
| Domain | Zod contracts | NOT STARTED | n/a | P2 | — |
| Domain | Append-only event ledger (SQLite) | NOT STARTED | No | P2 | — |
| Domain | Reducers and deterministic replay | NOT STARTED | n/a | P2 | — |
| Domain | Idempotent apply, duplicate and out-of-order handling | NOT STARTED | n/a | P2 | — |
| Domain | Outbox and inbox with retry | NOT STARTED | No | P2 | — |
| Domain | Manual SOS persists and queues without AI | NOT STARTED | No | P2 | — |
| Domain | Task and resolution authorization | NOT STARTED | n/a | P2 | — |
| UI | Theme tokens and primitives | NOT STARTED | No | P3 | — |
| UI | Onboarding | NOT STARTED | No | P3 | — |
| UI | Tabs: Home, Network, SOS, Activity, Settings | NOT STARTED | No | P3 | — |
| UI | Incident detail: Intelligence, Coordination, Timeline, Capsule | NOT STARTED | No | P3 | — |
| UI | Pairing screen | NOT STARTED | No | P3 / P6 | — |
| UI | Accessibility (VoiceOver, Dynamic Type, 44pt targets) | NOT STARTED | No | P3 | — |
| Demo Lab | Simulated adapters and six scenarios | NOT STARTED | No | P3 | — |
| Demo Lab | Persistent SIMULATED banner | NOT STARTED | No | P3 | — |
| Local AI | `LocalAIService` and `CallstackAppleAIAdapter` | NOT STARTED | No | P4 | — |
| Local AI | Structured extraction with evidence-span check | NOT STARTED | No | P4 | — |
| Local AI | Clarification (at most one) | NOT STARTED | No | P4 | — |
| Local AI | Conflict notes | NOT STARTED | No | P4 | — |
| Local AI | Non-medical task proposals | NOT STARTED | No | P4 | — |
| Local AI | Deterministic conflict rules engine | NOT STARTED | n/a | P4 | — |
| Local AI | Embeddings for duplicate hints | NOT STARTED | No | P4 | — |
| Local AI | Transcription (`en-US`; `fil-PH` UNVERIFIED) | NOT STARTED | No | P4 / P8 | — |
| Local AI | Diagnostics screen | NOT STARTED | No | P4 | — |
| Local AI | Text to speech readout | NOT STARTED | No | P8 | — |
| Transport | `modules/pulse-peer` (Network framework, Bonjour) | NOT STARTED | No | P5 | — |
| Transport | App-level receipts | NOT STARTED | No | P5 | — |
| Transport | Reconnect flush and dedupe | NOT STARTED | No | P5 | — |
| Transport | Store-and-forward relay with hop limit | NOT STARTED | No | P5 / P7 | — |
| Crypto | `modules/pulse-crypto` (CryptoKit, Keychain) | NOT STARTED | No | P6 | — |
| Crypto | Pairing with human-compared short code | NOT STARTED | No | P6 | — |
| Crypto | Per-recipient capsule encryption, signed envelope | NOT STARTED | No | P6 | — |
| Crypto | Disclosure levels relay / trusted / authorized | NOT STARTED | No | P6 | — |
| Integration | Two-phone live CareChain flow | NOT STARTED | No | P7 | — |
| Integration | Three-phone relay | NOT STARTED | No | P7 | — |
| Optional | Core Motion check-in | NOT STARTED | No | P8 | — |
| Release | Demo runbook rehearsed | NOT STARTED | No | P9 | — |
| Release | Benchmarks measured | NOT STARTED | No | P9 | — |

## Mocked

Nothing is mocked yet because no code exists. When Demo Lab is built, its simulated AI, transport and crypto will be listed here as `MOCKED` and will stay `MOCKED` regardless of what the live adapters achieve.

## Blocked

Nothing is formally blocked yet. Human-only prerequisites that will be needed are listed in [PHASE_PLAN.md](PHASE_PLAN.md).

## Verified on device

Nothing.

## Not in scope

Camera features, Android, cloud inference, App Store release, background operation.
