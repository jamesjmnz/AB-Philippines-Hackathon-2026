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
| D-09 | 2026-10-09 | Bundle identifier `com.jamesjmnz.sagip`. | Owner's namespace; can be changed on request. | In force |
| D-10 | 2026-10-09 | The iPhone 14 Pro Max and iPhone 13 will be updated to iOS 26. Per-feature runtime gating stays regardless. | Owner's plan; gating is needed because hardware eligibility differs even on the same OS. | Pending owner action |
| D-11 | 2026-10-09 | iOS deployment target 17.0, with runtime gating for features that need iOS 26. | Lets the app install on devices before they are updated; text model and transcription are gated. | In force |
| D-12 | 2026-10-09 | Callstack `@react-native-ai/apple` is the primary and only planned AI provider; no custom Swift Foundation Models wrapper. | Master specification; [ADR 0001](ADR/0001-callstack-primary-provider.md). | Accepted, implementation pending |
| D-13 | 2026-10-09 | Peer transport is a Swift Expo module on Network framework with Bonjour `_sagip-sos._tcp`. | [ADR 0002](ADR/0002-peer-transport-native-swift.md). | Accepted, implementation pending |
| D-14 | 2026-10-09 | Capsule crypto in a Swift Expo module with CryptoKit and Keychain; pairing by human-compared short code. | [ADR 0003](ADR/0003-capsule-crypto-and-trust.md). | Accepted, implementation pending |
| D-15 | 2026-10-09 | Append-only event ledger with per-device sequence and causal parents; sync by exchanging events. | [ADR 0004](ADR/0004-offline-event-synchronization.md). | Accepted, implementation pending |
| D-16 | 2026-10-09 | Only `src/ai/callstack/` may import `@react-native-ai/apple` or `ai`; enforced by ESLint. | Keeps one adapter and prevents UI code from calling the model directly. | In force (rule present in `eslint.config.js`) |
| D-17 | 2026-10-09 | Phase 1 is a fresh scaffold plus a port of the Claude Design export, not an in-place migration. | The audit found the repository contained only a README; there was no existing app to migrate. | In force |
| D-18 | 2026-10-09 | Jest with `jest-expo` as the test runner. | Matches the Expo SDK; the specification allows Vitest or Jest. | In force |
| D-19 | 2026-10-09 | The "Medical severity" field in the design export is removed in the port. | Invariant 2: never infer severity. | In force |
| D-20 | 2026-10-10 | Incident detail keeps four segments (Intelligence / Coordination / Timeline / Capsule) instead of the export's single scroll. | Owner decision. The export's sections map onto the segments unchanged; Capsule holds the Privacy page. | In force; implemented (`src/components/incident/`) |
| D-21 | 2026-10-10 | Capsule event tiers are `summary`, `detail` and a third, `withheld`. A detail item the policy shares with nobody (report text while "share symptoms" is off; floor claims while detailed location is off) stays with the reporter and is sent to no recipient. Tiering follows `canReadItem`. | The policy can share a detail item with nobody, and such an event must not be put in any recipient's section. Recorded as built from the P7 handoff, deviation 4. | In force; implemented and unit-tested (`src/crypto/capsule.ts`) |
| D-22 | 2026-10-10 | Relaying is automatic. A packet for a recipient that is not directly connected is handed to every connected trusted peer, and a relay forwards it without a human step, if relaying is enabled in its settings. In the design Mika forwards to Noah by hand. | Recorded as built from the P7 handoff, deviation 7; the handoff states the behaviour and gives no further reason. A relay still holds ciphertext only and forwards at most one hop. | In force; implemented and unit-tested with simulated adapters; not verified on devices |
| D-23 | 2026-10-10 | The simulated AI, radio and crypto live in `src/demo/`, not in `testing/` folders. `src/crypto/testing` and `src/transport/testing` re-export them for tests. | ESLint forbids app code from importing `**/testing/*`, and Demo Lab needs the simulations at runtime. Recorded from the P7 handoff, deviation 2. Refines D-P2-5. | In force |
| D-24 | 2026-10-10 | `createLiveApp()` returns a promise; `createDemoApp()` is synchronous. The promise resolves once the SQLite ledger is open and rejects only when storage cannot be opened. | A storage failure then reaches the app root's error screen instead of leaving a snapshot that is never ready. Recorded from the P7 handoff, deviation 1. | In force; LIVE path not yet observed running |

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

### Answers recorded 2026-10-10

Questions above are kept as asked. A question not listed here is still open.

| # | Answered | Answer | Evidence |
| --- | --- | --- | --- |
| Q-01 | Yes | `@react-native-ai/apple` 0.12.0 builds on React Native 0.86.3. Whether it runs is still unverified. The SDK 54 fallback in D-04 was not triggered. | EAS development build `fbc85457` FINISHED; the binary contains `AppleLLM` and links `FoundationModels`. |
| Q-04 | Yes | The vocabulary is 22 events (D-P2-1). Pairing has no ledger event; it is handled in `src/sync/pairing.ts` and stored outside the ledger. A relay's forward is a `PACKET_SENT_ATTEMPT` with `viaDeviceId`, not a new event. There is no arrival event: progress on an in-person task (`TASK_PROGRESS_REPORTED`, `inPerson`) gives `in_progress`, shown as "on the way" with "Arrival is not confirmed". | `src/domain/events.ts`; [agent-handoffs/P2-domain.md](agent-handoffs/P2-domain.md). |
| Q-05 | As built | Context overflow has no pattern of its own and falls through to `native_error`. | `src/ai/classifyError.ts`; the adapter suite tests "Exceeded model context window size" as `native_error`. Wording not confirmed on a device. |
| Q-06 | Partly | Prefix: 4 bytes, big-endian. Maximum native frame: 256 KiB. Still open: the sync layer's packet cap is 512 KiB, so the two limits disagree. | `modules/pulse-peer/ios/Core/FrameCodec.swift`; `src/sync/packet.ts`. |
| Q-07 | Yes | A duplicate packet is not ingested again and is receipted again, because the first receipt may have been lost. | `src/sync/SyncEngine.ts`; `src/services/__tests__/delivery.test.ts`. |
| Q-08 | Partly | The code is six decimal digits derived from a SHA-256 over both devices' ids and public keys. Still open: revocation. Removing a peer is local only, the other device is not told, and no screen calls the native `resetIdentity`. | `modules/pulse-crypto/ios/Core/Identity.swift`; `src/sync/pairing.ts`. |
| Q-11 | Partly | The `preview` profile in `eas.json` (Release configuration, embedded bundle) is the one intended for offline tests. It has never been built. | `eas.json`; [EAS_IOS_SETUP.md](EAS_IOS_SETUP.md). |

Status notes on earlier rows, which are left as written: D-04's build is no longer unverified (see Q-01). D-12 to D-15 are implemented and unit-tested in code; none is verified on a device.

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

| D-NAME | 2026-10-10: the product is named **SAGIP**. README, app display name, slug, URL scheme, bundle id (`com.jamesjmnz.sagip`), EAS project (`@jamesjimenezzz/sagip`) and Bonjour service (`_sagip-sos._tcp`) use it. Swift module names (`pulse-peer`, `pulse-crypto`), the branch name and the design export keep the working name. | Owner decision. |

## Recorded during the overnight run (2026-10-10)

| ID | Decision | Why |
| --- | --- | --- |
| D-25 | Either device may dial; a simultaneous dial is settled by keeping the link dialed by the lower device id. Supersedes the "only the lower id dials" rule in `PeerService`. | With the old rule, pairing started on the higher-id phone never connected (seen in the two-simulator run). |
| D-26 | Native frame cap is 1 MiB; the sync packet cap stays 512 KiB. Answers the open part of Q-06. | The native cap was below the packet cap. |
| D-27 | `pair_confirm` carries an optional `answer: true`, and confirmations are re-sent until both sides trust. | A lost confirmation left pairing one-sided. |
| D-28 | Overnight work is on `feat/pulse-2-overnight`, cut from `feat/pulse-2`; no pull request is opened and nothing is merged without the owner. | Owner's instruction before the run. |

## Recorded for Incident Delta Intelligence (2026-10-10)

| ID | Decision | Why |
| --- | --- | --- |
| D-29 | Incident Delta Intelligence is deterministic first: `classifyStatementDelta` derives at replay how a new statement relates to earlier evidence, on every device, and is never persisted. The conflict rule compares only each author's latest statement per field, so a self-correction no longer flags. The on-device model is an optional second stage whose verdict is one new event, `STATEMENT_ASSESSED` (the 23rd type), a restricted-tier proposal that changes no claim or contradiction. Evaluation lives in a root `ml/` workspace. | Owner decision; [ADR 0005](ADR/0005-incident-delta-intelligence.md). Accepted, implementation in progress; nothing built to completion or measured, model behaviour unverified on a device. |
