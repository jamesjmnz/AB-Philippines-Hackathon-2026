# SAGIP documentation

SAGIP (working name PULSE 2.0, still used in older documents and in code identifiers) is an iOS-first, camera-free, offline assistance-coordination prototype built for the AppBuildersPH 2026 hackathon (theme: Local AI). It is not an emergency service, a medical device or a guaranteed rescue channel.

**Current state (2026-10-10):** the code for phases P2 to P7 is committed and unit-tested (typecheck and lint clean; 42 Jest suites, 450 tests passed; `swift test` 6 passed in `modules/pulse-peer` and 15 in `modules/pulse-crypto`). An EAS development build for devices finished (`fbc85457`), and an EAS simulator build (`66901962`) runs in the iOS 26.3 simulator, where the app has been looked at in Demo mode only. **Nothing has run on a physical iPhone.** No LIVE-mode behaviour, real model inference, real radio link or real Keychain use has been observed, and no gate other than G0 is passed. Each document says which of its sections describe code that exists and which are still a plan; a plan is written as "will" or marked planned, and an unchecked technical claim is marked `UNVERIFIED`. Start with [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Status vocabulary

All status tables use only these words.

| Word | Meaning |
| --- | --- |
| `NOT STARTED` | No code exists. |
| `IN PROGRESS` | Work has begun; not complete. |
| `IMPLEMENTED` | Code exists; no test evidence yet. |
| `UNIT-TESTED` | Automated tests exist and their real output is recorded. |
| `BUILT` | A native build completed and the command output is recorded. |
| `VERIFIED ON DEVICE` | Observed on a named physical iPhone, with the observation recorded. |
| `MOCKED` | Exists only as a simulation (Demo Lab). |
| `MISSING` | Required and not planned for the current phase. |
| `BLOCKED` | Cannot proceed; the blocker is written down. |

`UNVERIFIED` marks a technical claim that has not been checked.

## Index

| Document | Contents |
| --- | --- |
| [PRD.md](PRD.md) | Problem, synthetic personas, scope, non-goals, core flows, acceptance. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, TypeScript/native boundary, LIVE and DEMO adapter bundles, end-to-end sequence. |
| [TECH_STACK.md](TECH_STACK.md) | Toolchain, selected version matrix and the reasons behind each pin. |
| [LOCAL_AI.md](LOCAL_AI.md) | Callstack-first local AI design, `LocalAIService`, result states, constraints. |
| [DEVICE_CAPABILITIES.md](DEVICE_CAPABILITIES.md) | Per-device, per-feature expected support and what has been tested. |
| [DOMAIN_MODEL.md](DOMAIN_MODEL.md) | Entities, event vocabulary, ledger fields, invariants, state derivation. |
| [NETWORK_PROTOCOL.md](NETWORK_PROTOCOL.md) | Discovery, framing, receipts, retries, relay, lifecycle, permissions. |
| [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md) | Pairing, keys, envelope, disclosure levels, threat model, data lifecycle. |
| [PHASE_PLAN.md](PHASE_PLAN.md) | P0 to P9 deliverables, owners, gates G0 to G9, Git check per phase. |
| [AGENTIC_PROGRESS.md](AGENTIC_PROGRESS.md) | Phase tracker: gate, commits, branch, push status, blocker. |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Feature matrix: implemented, mocked, missing, blocked, verified on device. |
| [TEST_PLAN.md](TEST_PLAN.md) | Unit, integration and adversarial cases; per-device checklist. |
| [LOCAL_AI_BENCHMARKS.md](LOCAL_AI_BENCHMARKS.md) | Measurement methodology and results table (no measurements yet). |
| [UI_REFERENCE.md](UI_REFERENCE.md) | Design source, tokens, primitives, deviations from the export and port status. |
| [EAS_IOS_SETUP.md](EAS_IOS_SETUP.md) | Development-build setup, device prerequisites, signing. |
| [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) | Operator script for scenes A to F with honest fallbacks. |
| [HACKATHON_DISCLOSURES.md](HACKATHON_DISCLOSURES.md) | What runs locally, what needs network, frameworks, AI tools used. |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | Safety scope, platform limits, unverified areas. |
| [DECISIONS.md](DECISIONS.md) | Dated decision log and open questions. |
| [GIT_WORKFLOW.md](GIT_WORKFLOW.md) | Commit and push checklist; feature-branch and PR rule. |
| [ADR/0001-callstack-primary-provider.md](ADR/0001-callstack-primary-provider.md) | Callstack Apple provider is the primary local AI integration. |
| [ADR/0002-peer-transport-native-swift.md](ADR/0002-peer-transport-native-swift.md) | Peer transport is a native Swift module on Network framework. |
| [ADR/0003-capsule-crypto-and-trust.md](ADR/0003-capsule-crypto-and-trust.md) | Capsule encryption, key handling and pairing. |
| [ADR/0004-offline-event-synchronization.md](ADR/0004-offline-event-synchronization.md) | Append-only ledger and event sync between devices. |
| [agent-handoffs/README.md](agent-handoffs/README.md) | Handoff template for delegated agents. Filed: [P2-domain](agent-handoffs/P2-domain.md), [P3-ui](agent-handoffs/P3-ui.md), [P7-integration](agent-handoffs/P7-integration.md). |

Related files outside `docs/`: `CONTRIBUTING.md` (contribution policy), `.claude/agents/` (subagent profiles), `design/` (Claude Design export, reference only).

## How these documents are maintained

- A document is updated in the same change as the feature it describes.
- A status moves forward only when evidence exists: a recorded command output, or a recorded observation on a named device.
- Numbers (latency, memory, counts) appear only if they were measured. Simulated runs never produce numbers.
