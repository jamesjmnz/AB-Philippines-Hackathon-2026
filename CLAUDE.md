# PULSE 2.0

Offline, camera-free assistance coordination for iPhone. A person raises a manual SOS, optionally
describes what happened, on-device AI structures the report, and an encrypted Rescue Capsule goes to
trusted nearby iPhones without internet. Responders acknowledge and voluntarily take non-medical
tasks on a CareChain timeline. Hackathon prototype (AppBuildersPH 2026, theme: Local AI). It is not an
emergency service, medical device or guaranteed rescue channel.

Current truth about what works is in `docs/IMPLEMENTATION_STATUS.md` and `docs/AGENTIC_PROGRESS.md`.
Read those before claiming anything works.

## Stack

- Expo SDK 57 (CNG, development builds), React Native 0.86 New Architecture, TypeScript strict, iOS only.
- Expo Router (routes in `src/app/`), NativeWind v4 on Tailwind 3.4, Zustand, Zod 4, `expo-sqlite`.
- On-device AI: `@react-native-ai/apple` 0.12.0 with `ai` 6.x. Do not upgrade `ai` to 7.
- Swift (Expo Modules API) only for gaps: `modules/pulse-peer` (Network framework + Bonjour),
  `modules/pulse-crypto` (CryptoKit + Keychain).
- Never Expo Go. `ios/` is generated and ignored; native config goes in `app.config.ts` and plugins.

## Commands

```bash
npm install
npx expo install <pkg>        # for Expo/RN packages, resolves SDK-compatible versions
npm run typecheck             # tsc --noEmit
npm run lint
npm test
npm run doctor                # expo-doctor
npm run prebuild              # regenerate ios/
npm run ios                   # build and install on a connected iPhone
npm start                     # Metro for the dev client
```

Local Xcode device builds fail on the development Mac (no iOS 26.2 platform component); builds go
through EAS (`eas build -p ios --profile development|simulator|preview`). An iOS 26.3 simulator runtime
is installed and runs the simulator build, with no Apple Intelligence model and no peer-to-peer radio,
so a simulator run never passes a device gate.

## Layout

```
src/app/          routes only
src/domain/       Zod contracts, events, reducers, invariants, policies (pure TS, no React Native imports)
src/storage/      SQLite migrations, IncidentRepository, outbox/inbox
src/ai/           LocalAIService, rules engine; src/ai/callstack/ is the Callstack adapter
src/transport/    PeerTransport interface, native adapter
src/crypto/       CapsuleCrypto interface, native adapter, capsule sections
src/sync/         packet codec, SyncEngine (outbox, receipts, relay), pairing
src/services/     PulseApp contract (api.ts), PulseCore, LIVE wiring, provider hooks
src/demo/         SIMULATED adapters and scenarios
src/ui/           theme tokens and primitives
src/components/   feature components
modules/          Swift Expo modules
design/           Claude Design export the UI is ported from (reference, not bundled)
docs/             all documentation; index in docs/README.md
```

## Rules that must hold

AI
- `@react-native-ai/apple` is the first choice for every Apple AI capability it exposes: text,
  structured output, embeddings, transcription, speech. Do not write a Swift Foundation Models wrapper.
- Only `src/ai/callstack/` imports `@react-native-ai/apple` or `ai` (ESLint enforces this). UI and
  domain code use `LocalAIService`.
- Availability is per capability and per device. iPhone 14 Pro Max and iPhone 13 do not run the text model.
- No cloud model in any live path. If the model is unavailable the app says so and sends the original report.
- Model output is a proposal. It is validated with Zod and checked against the original text, and it
  never changes a confirmed human claim without a human event.

Safety and truth
- Manual SOS persists and queues before any AI, microphone, permission or radio work, and never waits on them.
- Queued, sent-attempt, delivered (signed receipt), acknowledged (human), accepted (human), completion
  reported, completion confirmed and resolved are different states. Never show one as another.
- No diagnosis, severity, or medical instruction. No claim that emergency services were contacted.
- Unknown stays unknown. Contradictions keep both statements until an authorized human resolves them.
- Relay-only peers handle ciphertext and routing metadata only. Access is enforced by encryption and
  deterministic checks, never by AI-written redactions.
- No incident content in logs, crash output or analytics.

Live vs Demo
- LIVE and DEMO are separate adapter bundles and separate stores. Demo Lab lives under Settings and
  every simulated screen is labelled SIMULATED. Live mode shows only measured state.
- Never report metrics from simulated calls.

UI
- Port from `design/PULSE-2.6.dc.html`; tokens in `tailwind.config.js` and `src/ui/theme.ts`.
  White cards on `#F7F7F9`, near-black text, black pill CTAs, coral only for urgent, amber for pending,
  green for verified. No camera features. See `docs/UI_REFERENCE.md`.

## Git

Full policy: `CONTRIBUTING.md` and `docs/GIT_WORKFLOW.md`.
- Work on `feat/pulse-2`; `main` changes only through a pull request. Normal pushes only; never force,
  rebase published history, or bypass hooks.
- Conventional Commits, one concern per commit, no AI trailers or footers.
- Stage named paths, check `git diff --cached --stat` and `--check`, look for secrets before committing.
- Only the lead orchestrator stages, commits, pushes and opens PRs. Subagents never do.
- A push is not proof of a gate. Record gate evidence and push results in `docs/AGENTIC_PROGRESS.md`.

## Agents

Profiles in `.claude/agents/`: `pulse-architect`, `pulse-domain-engineer`, `pulse-mobile-ui`,
`pulse-callstack-ai`, `pulse-swift-bridge`, `pulse-security`, `pulse-qa-reviewer`,
`pulse-release-engineer`. Each owns specific paths. Shared files (`package.json`, lockfile,
`app.config.ts`, `CLAUDE.md`, `src/domain/` schemas) have one editor at a time: the lead. Handoffs go in
`docs/agent-handoffs/`.

## References

- Callstack: https://github.com/callstackincubator/ai and https://react-native-ai.dev/docs/apple/getting-started
  (the docs describe unreleased APIs; trust the installed 0.12.0 types, see `docs/LOCAL_AI.md`).
- Expo SDK 57 docs: https://docs.expo.dev/versions/v57.0.0/
- Docs index: `docs/README.md`. Phase tracker: `docs/PHASE_PLAN.md`, `docs/AGENTIC_PROGRESS.md`.
