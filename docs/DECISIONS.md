# Decisions

Dated log. Newest entries are appended at the bottom of the table. Larger decisions have an ADR in [ADR/](ADR/). A decision here records intent; it does not mean the thing is implemented.

## Log

| # | Date | Decision | Reason | Status |
| --- | --- | --- | --- | --- |
| D-01 | 2026-10-09 | Work on a feature branch (`feat/pulse-2`) and reach `main` through a pull request merged by the owner. Normal pushes only; never push to `main` directly. | Owner's instruction. | In force |
| D-02 | 2026-10-09 | No AI trailers in commit messages. AI-tool use is disclosed in `HACKATHON_DISCLOSURES.md`. | Owner's instruction; contribution policy. | In force |
| D-03 | 2026-10-09 | npm, single lockfile. | One package manager is required; npm is already installed. | In force |
| D-04 | 2026-10-09 | Expo SDK 57 / React Native 0.86.3 / React 19.2.3, New Architecture on, CNG with `expo-dev-client`. Fallback to Expo SDK 54 / RN 0.81.5 if the Apple package cannot be built after three distinct attempts. | Current SDK; upstream tests the Apple package only on SDK 54, so a fallback is defined in advance. | In force; build UNVERIFIED |
| D-05 | 2026-10-09 | `ai@6.0.302` (the `ai-v6` dist-tag), not `latest`. | `latest` is v7, built on a newer provider specification than `@react-native-ai/apple` 0.12 targets. | In force |
| D-06 | 2026-10-09 | `@react-native-ai/apple` 0.12.0 from npm, not GitHub `main`. | `main` needs the iOS 26.4 SDK; Xcode 26.3 ships 26.2. Cost: no typed errors, so errors are classified by message. | In force |
| D-07 | 2026-10-09 | NativeWind 4.2.7 with Tailwind CSS 3.4.19. | Tailwind 4 is not compatible with NativeWind v4. | In force |
| D-08 | 2026-10-09 | Expo Router routes live in `src/app/`, not a top-level `app/`. | Expo SDK 57 template convention. Agent ownership tables use `src/app/`. | In force |
| D-09 | 2026-10-09 | Bundle identifier `com.jamesjmnz.pulse`. | Owner's namespace; can be changed on request. | In force |
| D-10 | 2026-10-09 | The iPhone 14 Pro Max and iPhone 13 will be updated to iOS 26. Per-feature runtime gating stays regardless. | Owner's plan; gating is needed because hardware eligibility differs even on the same OS. | Pending owner action |
| D-11 | 2026-10-09 | iOS deployment target 17.0, with runtime gating for features that need iOS 26. | Lets the app install on devices before they are updated; text model and transcription are gated. | In force |
| D-12 | 2026-10-09 | Callstack `@react-native-ai/apple` is the primary and only planned AI provider; no custom Swift Foundation Models wrapper. | Master specification; [ADR 0001](ADR/0001-callstack-primary-provider.md). | Accepted, implementation pending |
| D-13 | 2026-10-09 | Peer transport is a Swift Expo module on Network framework with Bonjour `_pulse-sos._tcp`. | [ADR 0002](ADR/0002-peer-transport-native-swift.md). | Accepted, implementation pending |
| D-14 | 2026-10-09 | Capsule crypto in a Swift Expo module with CryptoKit and Keychain; pairing by human-compared short code. | [ADR 0003](ADR/0003-capsule-crypto-and-trust.md). | Accepted, implementation pending |
| D-15 | 2026-10-09 | Append-only event ledger with per-device sequence and causal parents; sync by exchanging events. | [ADR 0004](ADR/0004-offline-event-synchronization.md). | Accepted, implementation pending |
| D-16 | 2026-10-09 | Only `src/ai/callstack/` may import `@react-native-ai/apple` or `ai`; enforced by ESLint. | Keeps one adapter and prevents UI code from calling the model directly. | In force (rule present in `eslint.config.js`) |
| D-17 | 2026-10-09 | Phase 1 is a fresh scaffold plus a port of the Claude Design export, not an in-place migration. | The audit found the repository contained only a README; there was no existing app to migrate. | In force |
| D-18 | 2026-10-09 | Jest with `jest-expo` as the test runner. | Matches the Expo SDK; the specification allows Vitest or Jest. | In force |
| D-19 | 2026-10-09 | The "Medical severity" field in the design export is removed in the port. | Invariant 2: never infer severity. | In force |

## Open questions

| # | Question | Needed by |
| --- | --- | --- |
| Q-01 | Does `@react-native-ai/apple` 0.12.0 build on RN 0.86? | P1 |
| Q-02 | Is `fil-PH` transcription available on-device? How does the text model handle Filipino and Taglish? | P4 |
| Q-03 | Do embeddings and transcription work on the iPhone 14 Pro Max and iPhone 13 after the iOS 26 update? | P4 |
| Q-04 | The 20-event vocabulary has no event for pairing, for relay forwarding, or for a human "arrival" distinct from task progress. Add events, or model these as payload variants (for example "arrival reported" as a kind of `TASK_PROGRESS_REPORTED`)? | P2 |
| Q-05 | Which result state should a context-overflow error map to? | P4 |
| Q-06 | Frame format details: prefix width, maximum frame size. | P5 |
| Q-07 | Should a duplicate packet be re-receipted? (Proposed: yes.) | P5 |
| Q-08 | Short-code length and format; pairing revocation. | P6 |
| Q-09 | Retention defaults, export format and delete semantics for content already delivered. | P6 |
| Q-10 | The design export has access labels "Basic alert only" and "No access" beyond the three disclosure levels. Keep three levels and treat these as recipient-selection states? | P3 / P6 |
| Q-11 | Which build configuration is used for offline device tests, so the app does not need the development bundler? | P1 |
| Q-12 | `ITSAppUsesNonExemptEncryption` is set to `false` in `app.config.ts` while the app will use CryptoKit for capsule encryption. Confirm this is the correct export-compliance answer before any distribution beyond development builds. | P6 / P9 |
| Q-13 | Ownership of `src/demo/` and `src/transport/` among agents (currently assigned to `pulse-mobile-ui` and `pulse-swift-bridge` in the profiles as a working assumption). | P2 |

## How to add an entry

Append a row with the date, the decision in one sentence, the reason and the status. If a decision is reversed, add a new row that references the old number; do not edit history.

## Decisions recorded after Phase 2 (2026-10-10)

| ID | Decision | Why |
| --- | --- | --- |
| D-P2-1 | Two event types added to the 20-event vocabulary: `CLARIFICATION_SKIPPED` and `RESPONDER_DECLINED`. | A skipped question must stop being asked while the field stays unknown; declining the whole request is different from declining one task. |
| D-P2-2 | Well-formed remote events that fail authorization are stored in the ledger but never applied. Only malformed, wrong-incident and bad-signature events are quarantined. | An event refused today (an acceptance that arrives before its offer) can become valid when its context arrives. Keeping it lets devices converge. |
| D-P2-3 | Recipients are named in `INCIDENT_CREATED`; a device not named there or in a later capsule policy is not a participant. | Delivery state needs a recipient to attach to, and outsiders must not be able to author events. |
| D-P2-4 | Accepting a task does not imply acknowledgment, and `in_progress` requires an in-person task. | The design export merged these; the product rules require them to stay distinct. |
| D-P2-5 | The Swift crypto cores are tested with `swift test` on macOS. JS tests use an in-memory test double for `CapsuleCrypto` rather than a second real implementation. | One real implementation to audit; the JS layer is tested for policy, replay and expiry handling. |
| D-P2-6 | Every packet between devices is a signed, encrypted capsule envelope. Events that carry the requester's own words or symptom travel only in the `detail` section; coordination events travel in `summary`. | Relay-only devices must never hold readable incident content, and trusted responders must not receive what is reserved for authorized ones. |

Known gaps accepted for the prototype: event ordering trusts the author's Lamport value; an event id reused with different content is not detected; quarantined bodies have no retention rule.

| D-NAME | 2026-10-10: the product is named **SAGIP**. README title and the app display name use it. "PULSE" remains as the working name in older docs and in code identifiers (module names, bundle id, design export) until a full rename is requested. | Owner decision. |
