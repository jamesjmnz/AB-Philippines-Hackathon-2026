# SAGIP

**Offline AI that brings nearby help.**

SAGIP keeps people connected to those around them when internet or cellular service becomes
unreliable or disappears, whether in a disaster, a crowded event or a remote area. Built for
AppBuildersPH 2026 (theme: Local AI).

One tap raises an SOS. Describe what happened by text or voice, and local AI does the rest: Apple's
on-device language model transcribes and structures the report, asks a clarifying question, and
suggests non-medical tasks for responders, all on the phone with no cloud. The report is sealed into an
encrypted Rescue Capsule and reaches trusted nearby iPhones over a local peer-to-peer link, where
responders coordinate on a shared CareChain timeline.

No internet, no server, no account. Just the people around you, and the intelligence already in your
pocket.

> SAGIP is not an emergency service, a medical device, or a guaranteed rescue channel. It never
> contacts emergency services. It only reaches trusted iPhones that are nearby, running the app, and
> reachable.

Code identifiers and some documents use the working name **PULSE**. They refer to the same project.

## Status

Last updated 2026-10-10. The app is implemented and unit-tested. On-device AI has run on an iPhone 17
Pro Max, and the full SOS-to-resolved flow has run between two iOS simulators. Transfer between
physical iPhones has not been observed yet.

| Area | State |
| --- | --- |
| Automated checks | Typecheck and lint clean; 57 Jest suites, 1049 tests pass; 21 Swift tests pass |
| CareChain domain engine and SQLite ledger | Implemented and unit-tested |
| On-device AI (`@react-native-ai/apple`) | Run on an iPhone 17 Pro Max in Airplane Mode: a typed report was structured on the device in about 1.4 s. Model quality has not been scored yet |
| Peer transport (Swift, Network framework + Bonjour) | Discovery, pairing and delivery observed between two iOS simulators; not yet between phones |
| Capsule encryption (Swift, CryptoKit + Keychain) | Core tested on macOS with software keys; pairing code and signed receipts observed in the simulators |
| Sync engine, pairing, relay | Implemented and unit-tested against an in-memory radio; one relay hop |
| Screens (onboarding, five tabs, incident detail, report, pairing, Demo Lab) | Implemented and unit-tested; checked in the simulator |
| Builds | EAS development and simulator builds succeed; the offline `preview` build has not been made |

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

Requirements: Node 22, an Expo account for EAS builds, and an iPhone on iOS 26. The on-device text
model needs an Apple Intelligence-capable iPhone. Never Expo Go.

```bash
npm install
npm run typecheck
npm run lint
npm test

# Swift cores (run on macOS)
(cd modules/pulse-peer && swift test)
(cd modules/pulse-crypto && swift test)

# Build with EAS, install the result, then serve the JavaScript
eas build -p ios --profile development   # physical iPhone
eas build -p ios --profile simulator     # iOS simulator: no AI model, no peer-to-peer radio
npm start
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
src/sync/         packet codec, sync engine, pairing
src/services/     the contract screens talk to
src/demo/         simulated adapters and scenarios for Demo Lab
src/ui/           design tokens and primitives
src/components/   feature components
modules/          Swift Expo modules
ml/               evaluation scenarios, scoring and results
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
