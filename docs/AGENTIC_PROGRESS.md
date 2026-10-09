# Agentic progress

Last updated: 2026-10-10.

Nothing has run on a physical iPhone yet. The app runs in the iOS 26.3 simulator (iPhone 17 Pro Max) from the EAS simulator build, in Demo mode only. Code for P2 to P7 is committed with unit tests, but none of their gates has been verified on a device; the rows below still describe gate status, not code status. See the evidence log.

## Phase tracker

Push status is one of `PUSHED`, `NOT_ATTEMPTED`, `BLOCKED`. `PUSHED` is written only after Git confirms.

| phase | gate/tests | local commits | branch | push status | blocker |
| --- | --- | --- | --- | --- | --- |
| P0 Audit and contracts | G0: PASSED (audit recorded, docs and agent profiles written, versions selected). No code tests apply. | `5daff31` `b5242b2` `a98a621` `7cb9ab4` | `feat/pulse-2` | see P1 row | — |
| P1 Scaffold and native spike | G1: native build VERIFIED on EAS (2026-10-10); install on device still pending. Local history: `tsc --noEmit`, `expo lint`, `expo-doctor` (21/21) pass; `expo prebuild` and `pod install` succeed with `AppleLLM 0.12.0` autolinked. Native build: BLOCKED, not verified. | see `git log` | `feat/pulse-2` | recorded in evidence log | Xcode 26.3 has no iOS 26.2 platform component installed, so `xcodebuild` rejects every iOS destination. Needs `xcodebuild -downloadPlatform iOS` (several GB); the Mac had about 11 GB free, so this was left for the owner. |
| P2 Domain and SQLite | G2: NOT STARTED | — | — | NOT_ATTEMPTED | — |
| P3 UI and Live/Demo | G3: IN PROGRESS. Screens ported from the 2.6 export and checked in the simulator (Demo mode) for Welcome, onboarding steps 1 and 2, Home, Network, Activity, Settings, SOS countdown and incident detail. Not compared yet: report flow, Demo Lab, Safety Session, sheets and dialogs, onboarding steps 3 to 5. | see `git log` | `feat/pulse-2` | recorded in evidence log | Incident detail uses four segments where the export has one scroll (owner decision pending). Tab bar has no backdrop blur (needs `expo-blur` and a new build). |
| P4 Callstack Apple AI | G4: NOT STARTED | — | — | NOT_ATTEMPTED | — |
| P5 Peer transport | G5: NOT STARTED | — | — | NOT_ATTEMPTED | — |
| P6 Crypto and capsules | G6: NOT STARTED | — | — | NOT_ATTEMPTED | — |
| P7 Multi-device integration | G7: NOT STARTED | — | — | NOT_ATTEMPTED | — |
| P8 Optional enhancements | G8: NOT STARTED | — | — | NOT_ATTEMPTED | — |
| P9 Verification and handoff | G9: NOT STARTED | — | — | NOT_ATTEMPTED | — |

## Repository facts (audited)

| Item | Value |
| --- | --- |
| Remote | `origin` = `github.com/jamesjmnz/AB-Philippines-Hackathon-2026` (public) |
| Default branch | `main` (one commit: "Initial commit") |
| Working branch | `feat/pulse-2` |
| Publishing rule | Feature branch, then pull request to `main`. No direct pushes to `main`. |
| Pull request | #1 merged into `main` on 2026-10-10 (`f17dccf`) |

## Known upcoming human-only steps

These are not blockers yet because the phases that need them have not reached their gates.

- iPhone 17 Pro Max: unlocked, Developer Mode on, Apple Intelligence enabled and model downloaded, developer certificate trusted on first install.
- iPhone 14 Pro Max and iPhone 13: update to iOS 26 and pair with the Mac.
- Offline scenes must be run and observed by a person.

## Evidence log

Append one entry per verified item: date, phase, command or device action, and a short summary of the real output. Empty until evidence exists.

| Date | Phase | What was run or observed | Result summary |
| --- | --- | --- | --- |
| 2026-10-09 | P1 | `npx tsc --noEmit`; `npx expo lint`; `npx expo-doctor` | No type errors; lint clean; 21/21 doctor checks passed. |
| 2026-10-09 | P1 | `npx expo prebuild --platform ios --clean` | Completed; `Podfile.lock` contains `AppleLLM (0.12.0)` from `@react-native-ai/apple`. App target deployment target 17.0. |
| 2026-10-09 | P1 | `npx expo run:ios --device <iPhone 17 Pro Max>` | FAILED before compiling: `xcodebuild` exit 70, "iOS 26.2 is not installed. Please download and install the platform from Xcode > Settings > Components." Signing team was resolved automatically. |
| 2026-10-10 | P1 | `eas build -p ios --profile development` (build `fbc85457`) | FINISHED. Built with Xcode 26.6 against the iOS 26.5 SDK. The app binary contains `PulsePeerModule`, `PulseCryptoModule`, `AppleLLM` and links `FoundationModels`; bundle id `com.jamesjmnz.sagip`, minimum iOS 17.0. This is the first successful compile of `@react-native-ai/apple` 0.12.0 on React Native 0.86.3 and of both Swift bridges. |
| 2026-10-10 | P1 | `xcrun devicectl device install app` to the iPhone 17 Pro Max | FAILED: device was locked (`kAMDMobileImageMounterDeviceLocked`). Not yet installed or launched. |
| 2026-10-10 | P1 | `eas build -p ios --profile simulator` (build `66901962`, from `b759539`) installed with `xcrun simctl install` on an iPhone 17 Pro Max simulator, iOS 26.3; Metro dev client | Installed and launched; bundle loaded without errors. Simulator only, Demo mode only. No physical device run. |
| 2026-10-10 | P3 | Simulator screenshots compared with the 2.6 export rendered in a browser | Found and fixed: function-form `style` on `Pressable` is dropped by the NativeWind JSX transform, so pills and both SOS buttons rendered unstyled on device; presence dots, Home badge and Welcome orbit discs were smaller than the export (CSS content-box borders); status bar text unreadable over the SIMULATED bar. Tab bar made opaque because the build has no blur module. |
| 2026-10-10 | P3 | `npm run typecheck`; `npm run lint`; `npm test` | No type errors; lint clean; 42 suites, 450 tests passed. Jest does not run the NativeWind transform, so it did not catch the `Pressable` style defect. |
| 2026-10-10 | Git | `git push origin feat/pulse-2` (`5451416..9b4f7b6`); `gh pr merge 1 --merge` | PUSHED, confirmed by Git. Pull request #1 merged into `main` as merge commit `f17dccf`. The repository has no CI checks, so the merge is not evidence of any gate. |
| 2026-10-09 | P4 (code only) | `npx jest src/ai` | 24 passed, 0 failed (adapter with a fake runtime; no real model involved). |
| 2026-10-09 | P5 (code only) | `swift test` in `modules/pulse-peer` | 6 passed (frame codec). Network code typechecks against the iOS SDK; not run on a device. |
| 2026-10-09 | P6 (code only) | `swift test` in `modules/pulse-crypto` | 15 passed (capsule seal/open, tamper, wrong key, expiry, relay-only, pairing code) using software keys on macOS. Keychain and Secure Enclave paths typecheck only. |

## Agents

No delegated agent has produced a handoff yet. Handoffs are stored in [agent-handoffs/](agent-handoffs/README.md).
