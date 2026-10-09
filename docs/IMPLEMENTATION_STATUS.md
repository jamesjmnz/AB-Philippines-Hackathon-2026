# Implementation status

Last updated: 2026-10-10.

**Summary: the code for phases P2 to P7 is committed and unit-tested; nothing has run on a physical iPhone.**

- Code: domain and storage, screens, the Callstack AI adapter, both Swift modules, the sync engine, pairing, relay, and the LIVE and DEMO app services exist on the branch.
- Tests (2026-10-10): `npm run typecheck` clean, `npm run lint` clean, `npm test` 42 suites, 450 tests passed. `swift test` (recorded 2026-10-09): 6 passed in `modules/pulse-peer`, 15 passed in `modules/pulse-crypto`. Every Jest test of delivery, relay, disclosure and pairing runs against an in-memory radio and a simulated `CapsuleCrypto`; every AI test runs against a fake runtime.
- Builds: EAS development build `fbc85457` finished (device binary containing `PulsePeerModule`, `PulseCryptoModule`, `AppleLLM`). Its install on the iPhone 17 Pro Max failed because the phone was locked. EAS simulator build `66901962` runs in an iOS 26.3 simulator (iPhone 17 Pro Max).
- Observed: simulator, Demo mode only. A simulator observation is not device verification.
- Not observed anywhere: any LIVE-mode behaviour, real model inference, a real radio link, real Keychain or Secure Enclave use, `expo-sqlite` behaviour.
- Gates: G0 is passed. No other gate is passed. Gate status is tracked in [AGENTIC_PROGRESS.md](AGENTIC_PROGRESS.md) and is separate from the code status below.

Status words: `NOT STARTED`, `IN PROGRESS`, `IMPLEMENTED`, `UNIT-TESTED`, `BUILT`, `VERIFIED ON DEVICE`, `MOCKED`, `MISSING`, `BLOCKED`. See [README.md](README.md) for definitions. A feature may hold several at once (for example `IMPLEMENTED`, `UNIT-TESTED`); list all that have evidence.

How the words are used here:

- `BUILT` is written only for native code compiled into EAS build `fbc85457`. That build is a development client: the JavaScript is served by Metro and is not part of the binary, so TypeScript features are not marked `BUILT`.
- `UNIT-TESTED` means the Jest or `swift test` output is recorded. Where the test double matters it is named in the Evidence column.
- "Simulator, Demo mode" in the Evidence column means the screen was looked at in the iOS 26.3 simulator with the DEMO bundle. It says nothing about LIVE.

Test paths are relative to `src/`. Counts are from `npx jest` on 2026-10-10.

## Feature matrix

| Area | Feature | Status | Verified on device | Phase | Evidence |
| --- | --- | --- | --- | --- | --- |
| Foundation | Repository audit and docs | IMPLEMENTED | n/a | P0 | G0 passed; commits `5daff31` `b5242b2` `a98a621` `7cb9ab4`. |
| Foundation | Subagent profiles | IMPLEMENTED | n/a | P0 | Eight profiles in `.claude/agents/` (`b5242b2`). |
| Foundation | Expo SDK 57 scaffold, TypeScript strict, Router, NativeWind, ESLint, Jest | IMPLEMENTED, UNIT-TESTED, BUILT | No | P1 | `21226be`; typecheck, lint and `npm test` clean 2026-10-10; `expo-doctor` 21/21 on 2026-10-09 (not re-run since); build `fbc85457`. |
| Foundation | EAS build profiles | IMPLEMENTED, BUILT | No | P1 | `eas.json` (`bd98790`, `5451416`). `development` built as `fbc85457`, `simulator` as `66901962`. The `preview` (offline, embedded bundle) profile has never been built. |
| Foundation | Native build with `@react-native-ai/apple` on RN 0.86 | BUILT | No | P1 | Build `fbc85457` FINISHED; binary contains `AppleLLM` and links `FoundationModels`. Install on the iPhone 17 Pro Max FAILED (device locked). Local `expo run:ios --device` still fails (no iOS 26.2 platform component). |
| Domain | Zod contracts, 22-event vocabulary | IMPLEMENTED, UNIT-TESTED | n/a | P2 | `domain/__tests__/schema.test.ts`; domain total 11 suites, 136 tests. |
| Domain | Append-only event ledger (SQLite) | IMPLEMENTED, UNIT-TESTED | No | P2 | `storage/__tests__/sqliteRepository.test.ts`, `memoryRepository.test.ts` (2 suites, 44 tests) through `better-sqlite3` in Jest. The `expo-sqlite` driver (`storage/expoDriver.ts`) typechecks and has no test and no recorded run. |
| Domain | Reducers and deterministic replay | IMPLEMENTED, UNIT-TESTED | n/a | P2 | `domain/__tests__/replay.test.ts`, `scenario.test.ts`. |
| Domain | Idempotent apply, duplicate and out-of-order handling | IMPLEMENTED, UNIT-TESTED | n/a | P2 | `domain/__tests__/replay.test.ts`, `sync.test.ts`. |
| Domain | Outbox and inbox with retry | IMPLEMENTED, UNIT-TESTED | No | P2 | Storage contract suite; `domain/__tests__/delivery.test.ts`; `services/__tests__/delivery.test.ts`. |
| Domain | Manual SOS persists and queues without AI | IMPLEMENTED, UNIT-TESTED | No | P2 | `domain/__tests__/sos.test.ts`; `services/__tests__/sos.test.ts` (AI, transport and crypto hanging or throwing); `components/__tests__/sos.test.tsx`. |
| Domain | Task and resolution authorization | IMPLEMENTED, UNIT-TESTED | n/a | P2 | `domain/__tests__/authorization.test.ts`, `tasks.test.ts`, `claims.test.ts`. |
| Domain | Disclosure projection (`projectForLevel`, `canReadItem`) | IMPLEMENTED, UNIT-TESTED | n/a | P2 | `domain/__tests__/projection.test.ts`. |
| Domain | Deterministic floor and building rules, conflict detection | IMPLEMENTED, UNIT-TESTED | n/a | P2 | `domain/__tests__/rules.test.ts`; `services/__tests__/conflict.test.ts`. |
| UI | Theme tokens and primitives | IMPLEMENTED | No | P3 | `tailwind.config.js`, `src/ui/`. No dedicated primitive suites except the map card (`components/__tests__/map.test.tsx`); primitives are exercised through the screen suites. Simulator, Demo mode. |
| UI | Onboarding (splash, welcome, five steps) | IMPLEMENTED, UNIT-TESTED | No | P3 | `components/__tests__/onboarding.test.tsx`. Simulator, Demo mode: welcome and steps 1 and 2 compared with the export; steps 3 to 5 not compared. |
| UI | Tabs: Home, Network, SOS, Activity, Settings | IMPLEMENTED, UNIT-TESTED | No | P3 | `components/__tests__/home-design.test.tsx`, `home-network.test.tsx`, `screens.test.tsx`, `sos.test.tsx`, `tabbar.test.tsx`. Simulator, Demo mode: all five compared with the export. |
| UI | Incident detail: Intelligence, Coordination, Timeline, Capsule | IMPLEMENTED, UNIT-TESTED | No | P3 | `components/__tests__/incident.test.tsx`, `incident-design.test.tsx`, `status.test.tsx`. Simulator, Demo mode. Four segments are an owner decision (D-20). Sheets and dialogs not compared with the export. |
| UI | Report screen (typed or voice, analysis, proposal, clarification) | IMPLEMENTED, UNIT-TESTED | No | P3 / P4 | `components/__tests__/report.test.tsx`. Not looked at in the simulator. Voice recording (`components/report/voice.ts`) has never executed. |
| UI | Incident map card | IMPLEMENTED, UNIT-TESTED | No | P3 | `components/__tests__/map.test.tsx`. LIVE draws the card veiled with no pins; pins exist only in Demo. |
| UI | Pairing screen | IMPLEMENTED, UNIT-TESTED | No | P3 / P6 | `components/__tests__/home-network.test.tsx` (Pairing). Not looked at in the simulator. |
| UI | Accessibility (VoiceOver, Dynamic Type, 44pt targets) | IMPLEMENTED | No | P3 | Labels and roles are asserted in the screen suites. VoiceOver order, Dynamic Type and Reduce Motion have never been exercised. |
| UI | `AppRoot` mode swap, Expo Router layouts and redirects | IMPLEMENTED | No | P3 | No test (routes are mocked in Jest). The app launched and navigated in the simulator; one redirect loop was found and fixed there (`012e1d4`). |
| Demo Lab | Simulated adapters and six scenarios | MOCKED, UNIT-TESTED | No | P3 / P7 | `demo/__tests__/demoApp.test.ts`, `memoryHub.test.ts`, `SimulatedAI.test.ts` (3 suites, 27 tests). See Mocked. |
| Demo Lab | Persistent SIMULATED banner | IMPLEMENTED, UNIT-TESTED | No | P3 | `components/__tests__/shell.test.tsx`. Simulator, Demo mode. Known gap: sheets and dialogs use `Modal` and cover the bar. |
| Demo Lab | Safety Session and unusual-movement sheet | MOCKED, UNIT-TESTED | No | P3 | `components/__tests__/session.test.tsx`, `shell.test.tsx`. Timer only; reads no sensor. Not looked at in the simulator. |
| Local AI | `LocalAIService` and `CallstackAppleAIAdapter` | IMPLEMENTED, UNIT-TESTED | No | P4 | `ai/__tests__/CallstackAppleAIAdapter.test.ts` (24 tests, fake runtime). The native `AppleLLM` pod is `BUILT` (`fbc85457`). No real inference has been run. |
| Local AI | Structured extraction with evidence-span check | IMPLEMENTED, UNIT-TESTED | No | P4 | Same suite (fake runtime). |
| Local AI | Clarification (at most one) | IMPLEMENTED, UNIT-TESTED | No | P4 | Same suite; `services/__tests__/ai.test.ts`. |
| Local AI | Conflict notes | IMPLEMENTED, UNIT-TESTED | No | P4 | Same suite. In the app the path runs only when text is `ready`, and no test shows it adding a flag the deterministic rules had not already raised. |
| Local AI | Non-medical task proposals | IMPLEMENTED, UNIT-TESTED | No | P4 | Same suite (fake runtime). |
| Local AI | Deterministic conflict rules engine | IMPLEMENTED, UNIT-TESTED | n/a | P2 / P4 | Lives in `src/domain/rules/`; `domain/__tests__/rules.test.ts`. |
| Local AI | Embeddings for duplicate hints | IN PROGRESS | No | P4 | `compareSemanticReports` exists in the adapter and is unit-tested with fake vectors. Nothing in the app calls it, so there is no duplicate hint. |
| Local AI | Transcription (`en-US`; `fil-PH` UNVERIFIED) | IMPLEMENTED, UNIT-TESTED | No | P4 / P8 | Adapter suite; `services/__tests__/ai.test.ts` with an injected file reader. Recording and the real file reader have never executed. |
| Local AI | Diagnostics screen | IMPLEMENTED, UNIT-TESTED | No | P4 | `components/__tests__/screens.test.tsx` (local AI diagnostics). Not looked at in the simulator. |
| Local AI | Text to speech readout | NOT STARTED | No | P8 | The capability matrix reports system speech; `LocalAIService` has no speech call. |
| Transport | `modules/pulse-peer` (Network framework, Bonjour) | IMPLEMENTED, UNIT-TESTED, BUILT | No | P5 | `swift test`: 6 passed (frame codec only). The listener, browser and connection code is compiled in `fbc85457` and has never run. |
| Transport | App-level receipts | IMPLEMENTED, UNIT-TESTED | No | P5 | `services/__tests__/delivery.test.ts`, `disclosure.test.ts` (in-memory radio, simulated crypto). |
| Transport | Reconnect flush and dedupe | IMPLEMENTED, UNIT-TESTED | No | P5 | `services/__tests__/delivery.test.ts` (same doubles). |
| Transport | Store-and-forward relay with hop limit | IMPLEMENTED, UNIT-TESTED | No | P5 / P7 | `services/__tests__/relay.test.ts` (same doubles). One relay hop only. |
| Transport | Foreground/background lifecycle handling | NOT STARTED | No | P5 | Nothing stops or restarts discovery on app state changes. |
| Crypto | `modules/pulse-crypto` (CryptoKit, Keychain) | IMPLEMENTED, UNIT-TESTED, BUILT | No | P6 | `swift test`: 15 passed with software keys on macOS. Keychain and Secure Enclave paths are compiled in `fbc85457` and have never run. |
| Crypto | Pairing with human-compared short code | IMPLEMENTED, UNIT-TESTED | No | P6 | `services/__tests__/pairing.test.ts` (simulated crypto); pairing-code case in the Swift suite. |
| Crypto | Per-recipient capsule encryption, signed envelope | IMPLEMENTED, UNIT-TESTED | No | P6 | Swift suite (seal/open, tamper, wrong key, expiry, relay-only). The JS adapter `crypto/NativeCapsuleCrypto.ts` has no test and has never run. |
| Crypto | Disclosure levels relay / trusted / authorized | IMPLEMENTED, UNIT-TESTED | No | P6 | `crypto/__tests__/capsule.test.ts` (12 tests); `services/__tests__/disclosure.test.ts` (simulated crypto). |
| Integration | LIVE composition (`createLiveApp`) | IMPLEMENTED | No | P7 | `services/__tests__/live.test.ts` covers only the case where the native modules fail to load. No LIVE behaviour has been observed. |
| Integration | Two-phone live CareChain flow | IMPLEMENTED, UNIT-TESTED, BLOCKED | No | P7 | Jest only: `services/__tests__/delivery.test.ts`, `conflict.test.ts` (several cores on the in-memory radio). On phones: BLOCKED, see Blocked. |
| Integration | Three-phone relay | IMPLEMENTED, UNIT-TESTED, BLOCKED | No | P7 | Jest only: `services/__tests__/relay.test.ts`. On phones: BLOCKED, see Blocked. |
| Optional | Core Motion check-in | NOT STARTED | No | P8 | The Demo Lab Safety Session is a timer simulation and is not this feature. |
| Release | Demo runbook rehearsed | NOT STARTED | No | P9 | — |
| Release | Benchmarks measured | NOT STARTED | No | P9 | — |

Jest totals by directory (2026-10-10): `domain` 11 suites / 136 tests; `storage` 2 / 44; `components` 13 / 156; `ai` 1 / 24; `services` 9 / 41; `demo` 3 / 27; `crypto` 1 / 12; `sync` 1 / 7; `transport` 1 / 3. Total 42 / 450.

Handoffs with the detail behind these rows: [P2-domain](agent-handoffs/P2-domain.md), [P3-ui](agent-handoffs/P3-ui.md), [P7-integration](agent-handoffs/P7-integration.md). The UI has changed since the P3 handoff was written; [UI_REFERENCE.md](UI_REFERENCE.md) has the current port status.

## Mocked

These exist only as simulations in `src/demo/` and stay `MOCKED` regardless of what the live adapters achieve.

| Simulation | File | What it is |
| --- | --- | --- |
| Simulated AI | `src/demo/SimulatedAI.ts` | Keyword extraction ported from the design export. Reports `source: 'simulated'` and `latencyMs: 0`. |
| Simulated radio | `src/demo/memoryHub.ts` | In-memory `PeerTransport` hub with link and fault switches. No bytes leave the process. |
| Simulated crypto | `src/demo/simulatedCrypto.ts` | Not cryptography. Enforces who may read which section so access tests mean something. |
| Demo world | `src/demo/personas.ts`, `world.ts`, `scenarios.ts`, `createDemoApp.ts` | Three in-memory devices (Alex, Mika, Noah), three seeded incidents, six scenarios. |
| Safety Session, unusual-movement sheet | `src/components/demo/` | Local timer state. Reads no sensor and calls no service; refuses to render outside Demo mode. |
| Map pins | `src/components/map/IncidentMap.tsx` | Pins and the highlighted building are drawn only in Demo. |

The same simulated radio and crypto are the test doubles behind every `UNIT-TESTED` row for receipts, relay, disclosure and pairing. Those rows prove the TypeScript protocol logic, not the Swift modules.

## Blocked

Nothing in the code is blocked. Every device gate is blocked on a person, because no build has been installed on a phone.

| Blocked | Gate | What the human must do |
| --- | --- | --- |
| Install and launch build `fbc85457` on the iPhone 17 Pro Max | G1 (device part) | Unlock the phone and keep it unlocked during install; Developer Mode on; trust the developer certificate on first launch (Settings > General > VPN & Device Management). |
| Real on-device text inference | G4 | On the iPhone 17 Pro Max: Apple Intelligence enabled and the model downloaded while online. Then, with external internet disabled, enter an unseen report and report what the phone shows. |
| A↔B packet and receipt | G5 | Update the iPhone 14 Pro Max and iPhone 13 to iOS 26, pair them with the Mac, register them for internal distribution (`eas device:create`) and install a build. Run the offline scene (airplane mode, Wi-Fi and Bluetooth radios back on) and report what both phones show. |
| Relay-only phone holds ciphertext only; trusted recipient reads exactly its level | G6 (device part) | Same phones and build as G5; pair in the app, comparing the six-digit code on both phones. |
| Two-phone flow; three-phone relay | G7 | Same as G5 and G6, with the third phone for the relay. |
| Offline (no Metro) runs | G5, G7, G9 | The `preview` profile has never been built. A person must start `eas build -p ios --profile preview` (needs the owner's Expo and Apple credentials). |
| Local Xcode device builds | none (EAS is used instead) | `xcodebuild -downloadPlatform iOS` to install the iOS 26.2 platform component (several GB). |

Gate wording is in [PHASE_PLAN.md](PHASE_PLAN.md), "What needs the human".

## Verified on device

Nothing.

The only run of the app so far is in the iOS 26.3 simulator from build `66901962`, observed in Demo mode. The app starts with the LIVE bundle before Demo is selected, so `createLiveApp` must have started in that simulator session; nothing about it was checked or recorded, and it is not evidence for any LIVE row.

## Not in scope

Camera features, Android, cloud inference, App Store release, background operation.
