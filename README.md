# SAGIP

**When networks fail, intelligence stays. Help stays connected.**

SAGIP is an offline, camera-free assistance-coordination app for iPhone, built for AppBuildersPH 2026
(theme: Local AI). A person raises a manual SOS, optionally describes what happened, and on-device AI
structures the report. The details are sealed into an encrypted Rescue Capsule and exchanged with
trusted nearby iPhones without internet. Responders acknowledge, voluntarily take non-medical tasks,
and everything is recorded on a CareChain timeline.

> SAGIP is a hackathon prototype. It is not an emergency service, a medical device, or a guaranteed
> rescue channel. It never contacts emergency services. It only reaches trusted iPhones that are
> nearby, running the app, and reachable.

Earlier documents and code identifiers use the working name **PULSE**. They refer to the same project.

## Status

Work in progress. Nothing has run on an iPhone yet.

| Area | State |
| --- | --- |
| App scaffold (Expo 57, React Native 0.86, Expo Router, NativeWind) | Typecheck, lint and `expo-doctor` pass |
| CareChain domain engine and SQLite ledger | Unit-tested (180 tests) |
| On-device AI adapter (`@react-native-ai/apple`) | Unit-tested against a fake model (24 tests); no real model call yet |
| Peer transport (Swift, Network framework + Bonjour) | Frame codec tested on macOS; never run on a device |
| Capsule encryption (Swift, CryptoKit + Keychain) | Core tested on macOS with software keys (15 tests); Keychain path never run |
| Sync engine, pairing, relay, live and demo app services | In progress |
| Screens | In progress |
| Native build and on-device verification | Blocked: the build Mac is missing the Xcode iOS platform component |

The authoritative, per-feature status is in [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)
and the gate log is in [docs/AGENTIC_PROGRESS.md](docs/AGENTIC_PROGRESS.md).

## What makes it different

**CareChain.** Reports from distressed people are incomplete and sometimes contradictory. SAGIP keeps
every statement with its source, marks what is unknown instead of guessing, asks at most one optional
clarifying question, flags contradictions without resolving them, and suggests simple non-medical
tasks that people may choose to take.

**Rescue Capsules.** Each recipient gets only what the requester approved. A relay-only device carries
ciphertext it cannot open. A trusted responder reads a summary. An authorized responder reads the
detail. Delivery is shown only after the receiving phone returns a signed receipt.

## How Local AI is used

- All inference runs on the device through Callstack's [`@react-native-ai/apple`](https://github.com/callstackincubator/ai)
  and the Vercel AI SDK: Apple Foundation Models for text and structured output, with Apple's
  on-device embeddings and transcription where the device supports them.
- There is no cloud model anywhere in the live app.
- Model output is a proposal. Every proposed field must quote the words in the original report that
  support it, or it is discarded. Nothing becomes a fact until a person confirms it.
- The app never infers a diagnosis, severity or medical action.
- A manual SOS is saved and queued before any AI runs, and works when the model is unavailable.
- Apple's text model needs an Apple Intelligence-capable iPhone on iOS 26. Older phones still act as
  responders and relays.

## Rules the app holds itself to

- Queued, delivered, seen, role taken, on the way, done and resolved are separate states. One is never
  shown as another.
- Unknown stays unknown. A contradiction keeps both statements until the requester resolves it.
- Privacy is enforced by encryption and deterministic checks, never by AI-written redactions.
- Demo Lab is a separate, simulated mode and every simulated screen is labelled.

## Tech stack

- Expo SDK 57 development builds (not Expo Go), React Native 0.86 New Architecture, TypeScript strict
- Expo Router, NativeWind v4, Zustand, Zod 4, `expo-sqlite`
- `@react-native-ai/apple` 0.12.0 with `ai` 6.x
- Swift modules only where no library covers the need: `modules/pulse-peer` and `modules/pulse-crypto`

Details and version reasoning: [docs/TECH_STACK.md](docs/TECH_STACK.md).

## Getting started

Requirements: macOS with Xcode 26 and its iOS platform component installed, Node 22, CocoaPods, an
Apple Development signing identity, and a physical iPhone. There is no simulator workflow.

```bash
npm install
npm run typecheck
npm run lint
npm test

# Swift cores (run on macOS)
(cd modules/pulse-peer && swift test)
(cd modules/pulse-crypto && swift test)

# Build and install on a connected iPhone
npm run prebuild
npm run ios
```

Device setup, signing and Apple Intelligence notes: [docs/EAS_IOS_SETUP.md](docs/EAS_IOS_SETUP.md).

## Repository layout

```
src/app/          routes
src/domain/       events, reducers, policies (pure TypeScript)
src/storage/      SQLite ledger, outbox, inbox
src/ai/           LocalAIService and the Callstack Apple adapter
src/transport/    peer transport interface and native adapter
src/crypto/       capsule crypto interface and native adapter
src/services/     the contract screens talk to
src/ui/           design tokens and primitives
modules/          Swift Expo modules
design/           Claude Design export the UI is ported from
docs/             architecture, decisions, test plan, demo runbook
```

## Documentation

Start at [docs/README.md](docs/README.md). Most useful first:
[ARCHITECTURE](docs/ARCHITECTURE.md), [LOCAL_AI](docs/LOCAL_AI.md),
[SECURITY_PRIVACY](docs/SECURITY_PRIVACY.md), [KNOWN_LIMITATIONS](docs/KNOWN_LIMITATIONS.md),
[HACKATHON_DISCLOSURES](docs/HACKATHON_DISCLOSURES.md).

Contribution and commit rules: [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclosures

The UI design was made with Claude Design and the code was written with Claude Code, an AI coding
tool, under the repository owner's direction. Icons are Material Symbols (Apache-2.0). Demo personas
and incidents are synthetic.
