# Phase plan

Current status of each phase is tracked in [AGENTIC_PROGRESS.md](AGENTIC_PROGRESS.md). As of 2026-10-09: P0 `IN PROGRESS`, P1 scaffold install `IN PROGRESS`, everything else `NOT STARTED`. No gate has been passed.

## Rules for every phase

- A gate is marked passed only on recorded evidence. Committing or pushing does not pass a gate.
- Device gates that cannot be observed stay `BLOCKED` with exact steps for the human.
- After three substantively different attempts at one problem, record the root cause and the fallback, and move on.
- Only the lead orchestrator runs Git. Delegated agents never stage, commit, push, merge or open PRs.

### Git check (applies at the end of every phase)

1. `git status --short`; preserve unrelated edits.
2. Stage deliberate paths with `git add <paths>`. Never `git add -A`.
3. `git diff --cached --stat` and `git diff --cached --check`; inspect staged content for secrets and stray metadata.
4. Conventional Commits, no AI trailers.
5. Update `docs/AGENTIC_PROGRESS.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/DECISIONS.md` in the same change.
6. Normal `git push` to `feat/pulse-2`. Never force-push. Never push to `main`.
7. Record `phase | gate/tests | local commits | branch | push status | blocker`. `PUSHED` only after Git confirms.

Checks run in every phase once the scaffold exists: `npm run typecheck`, `npm run lint`, `npm test`, `npm run doctor`.

## Phases

### P0 — Audit and contracts

| | |
| --- | --- |
| Owner | `pulse-architect`; review by `pulse-qa-reviewer` |
| Deliverables | Repository, remote and toolchain audit. Version matrix. Contribution policy, `.gitignore`, `.env.example`. Eight subagent profiles. The `docs/` set with ADRs 0001 to 0004. Design export saved to `design/`. |
| **Gate G0** | Source tree inventoried, existing work preserved, Git repository and remote state audited, interfaces agreed, exact library-version selection and device caveats recorded. |
| Git check | Standard. Documentation commits only. |

### P1 — Scaffold and native spike

| | |
| --- | --- |
| Owner | `pulse-release-engineer` (shared config) with `pulse-mobile-ui` |
| Deliverables | Expo SDK 57 app at the repository root, strict TypeScript, Expo Router in `src/app/`, NativeWind, ESLint, Jest, EAS profiles, permission strings. Apple package and `ai@6` installed. `expo prebuild` and `expo run:ios --device` attempted on the iPhone 17 Pro Max with a diagnostics screen calling `apple.isAvailable()` and one `generateText`. Fallback to SDK 54 if the Apple package cannot be built after three distinct attempts. |
| **Gate G1** | Strict TypeScript, lint, tests and Expo doctor checked; a real native-build attempt recorded; reviewed framework changes committed with clean Conventional Commits; a truthful `PUSHED` or `BLOCKED` record. A native build counts only if it actually builds. |
| Git check | Standard, plus: first push sets upstream; open a draft PR from `feat/pulse-2` to `main`. |

### P2 — CareChain domain engine and SQLite

| | |
| --- | --- |
| Owner | `pulse-domain-engineer`; review by `pulse-qa-reviewer` |
| Deliverables | Zod contracts, 20-event vocabulary, append-only ledger, pure reducers and replay, idempotent apply, duplicate suppression, task and resolution authorization, outbox and inbox with retry. `createManualSOS` in one transaction with no AI, transport or permission dependency. |
| **Gate G2** | Complete domain test suite and persistent replay tests pass, with the actual command output recorded. |
| Git check | Standard. Contracts are frozen after this phase. |

### P3 — UI and Live/Demo separation

| | |
| --- | --- |
| Owner | `pulse-mobile-ui`; review by `pulse-qa-reviewer` |
| Deliverables | Onboarding, tabs, SOS sheet, incident detail with Intelligence / Coordination / Timeline / Capsule, sheets, Settings, Demo Lab, all bound to the store and repository. Loading, empty and error states. VoiceOver labels, Dynamic Type, 44pt targets. |
| **Gate G3** | All major routes reachable, visible controls functional, mock scenarios consistent, UI tests pass, design preserved. |
| Git check | Standard. |

### P4 — Callstack Apple AI

| | |
| --- | --- |
| Owner | `pulse-callstack-ai`; dependency and API review by `pulse-architect`; verification by `pulse-qa-reviewer` |
| Deliverables | `LocalAIService`, `CallstackAppleAIAdapter`, per-capability states, extraction with evidence spans, clarification, conflict notes, task proposals, deterministic rules engine, embeddings, transcription with locale probing, diagnostics screen, fake-model tests. |
| **Gate G4** | `@react-native-ai/apple` proves genuine new-input on-device text interpretation on an eligible physical iPhone with external internet disabled, and handles unavailable, refusal and unsupported-locale cases correctly. Without device evidence the code may be complete but G4 stays `BLOCKED`. |
| Git check | Standard. |

### P5 — Peer transport (Swift)

| | |
| --- | --- |
| Owner | `pulse-swift-bridge`; review by `pulse-qa-reviewer` |
| Deliverables | `modules/pulse-peer`: `NWListener` and `NWBrowser` over `_pulse-sos._tcp` with peer-to-peer, length-framed bytes, typed events, foreground lifecycle. App-level receipts, dedupe, reconnect flush, explicit relay with hop limit. |
| **Gate G5** | Physical iPhone A↔B real offline packet and receipt proof. Multi-hop stays unverified unless tested end to end. |
| Git check | Standard. |

### P6 — Crypto, trust and Rescue Capsules

| | |
| --- | --- |
| Owner | `pulse-security` with `pulse-swift-bridge`; review by `pulse-domain-engineer` and `pulse-qa-reviewer` |
| Deliverables | `modules/pulse-crypto`: Keychain-held keys, pairing with a human-compared short code, capsule encryption per recipient, signed envelope, separate summary and detail ciphertexts. `swift test` for the core. Jest policy and envelope tests with a test double. |
| **Gate G6** | Crypto and privacy tests pass; relay-only cannot access content and a trusted recipient can decrypt exactly the approved information. No sensitive real messages before this gate. |
| Git check | Standard. Extra review of staged files for key material. |

### P7 — Multi-device integration

| | |
| --- | --- |
| Owner | Lead orchestrator, with domain, AI, transport and security agents for bounded tasks |
| Deliverables | Live SOS → ledger → optional AI → capsule → queue → transport → receipt → human acknowledgment → task acceptance → conflicting observation → human resolution, converging by event sync. |
| **Gate G7** | Two-device integrated flow first. Three-device relay is a separate, higher gate requiring real verification; if it fails it is labelled blocked and the direct flow is demonstrated honestly. |
| Git check | Standard. |

### P8 — Optional enhancements

| | |
| --- | --- |
| Owner | Bounded tasks to AI, Swift and UI agents |
| Deliverables | Voice report polish, TTS readout, Core Motion check-in inside an explicit safety session. Only after P7 works. |
| **Gate G8** | Only verified extensions are marked functional, and none breaks manual SOS or offline data reliability. |
| Git check | Standard. |

### P9 — Verification and handoff

| | |
| --- | --- |
| Owner | `pulse-qa-reviewer` and `pulse-release-engineer`; lead orchestrator integrates |
| Deliverables | Full typecheck, lint, tests, `expo-doctor`, device build. Adversarial checklist. Demo runbook, disclosures, benchmarks with measured numbers only. Final report. |
| **Gate G9** | A genuine verifiable prototype ready for supported devices, or a candid `BLOCKED` report with maximal completed code and exact blocker reproduction. |
| Git check | Standard. `git log --format='%h %s%n%b'` reviewed for Conventional Commits with no trailers. |

## What needs the human

| Need | Blocks |
| --- | --- |
| iPhone 17 Pro Max unlocked, Developer Mode on, Apple Intelligence enabled and model downloaded; trust the developer certificate on first install | G1 device build, G4 |
| Pair the iPhone 14 Pro Max and iPhone 13 with the Mac once they are on iOS 26 | G5, G6, G7 |
| Run the offline scenes (airplane mode with Wi-Fi and Bluetooth radios on) and report what the phones show | G4, G5, G7 |
| `eas login`, only if cloud builds are wanted | Nothing; local Xcode builds do not need it |

## Delegation

After P2 freezes the contracts, at most three agents work in parallel on disjoint paths (UI, AI adapter, Swift modules). Shared files (`package.json`, lockfile, `app.config.ts`, `CLAUDE.md`, central schemas) have one editor at a time, by default the lead. Every handoff follows [agent-handoffs/README.md](agent-handoffs/README.md) and is reviewed before anything is committed.
