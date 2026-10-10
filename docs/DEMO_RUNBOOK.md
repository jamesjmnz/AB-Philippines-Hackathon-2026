# Demo runbook

Status (2026-10-10): script only. **No scene has been rehearsed.** The code behind every scene is written and unit-tested, and a device build exists (EAS `512bf15c`; the older `fbc85457` lacks the pairing fixes), but it has not been installed on any phone: nothing in this script has run live. What has been run and looked at is the iOS 26.3 simulator only: Demo mode, and on 2026-10-10 LIVE mode in two simulators on one Mac (pairing and the SOS to resolved chain; see the evidence log). A simulator run is not a rehearsal and is never shown as a live scene. Each scene carries its own status line. A scene is presented as live only after it has been run on the physical devices and recorded in [AGENTIC_PROGRESS.md](AGENTIC_PROGRESS.md).

## What can be shown today

| What | State |
| --- | --- |
| Demo Lab scenarios (Normal SOS; CareChain Intelligence; Multi-Responder Assistance; Rescue Capsule Privacy; Offline Network Recovery; Complete PULSE Experience) | `MOCKED`. Run in Jest to their end states (`src/demo/__tests__/demoApp.test.ts`). In the simulator, Demo mode was opened and "Complete PULSE Experience" was started and seen to advance; the other five have not been stepped through there. Always under the SIMULATED bar. |
| Any live scene A to F | `BLOCKED`: no build installed on a phone. Human steps are in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), Blocked. |
| Recorded test output (Jest, `swift test`) | Available in the evidence log. It is test output, not a demonstration. |

## Rules for the operator

- Synthetic messages and synthetic personas only. No real incident, health or location data.
- No cameras.
- Say what is real and what is simulated, every time. Demo Lab screens show a SIMULATED banner; do not crop it out of recordings.
- Never say that help was dispatched, that someone arrived, or that rescue is guaranteed.
- If a live step fails on stage, say so and use the listed fallback. Do not switch to Demo Lab silently.

## Devices and roles

| Phone | Persona | Role |
| --- | --- | --- |
| A: iPhone 17 Pro Max | Alex | Reporter; only device expected to run the text model |
| B: iPhone 14 Pro Max | Mika | Trusted responder and relay |
| C: iPhone 13 | Noah | Trusted responder |

## Setup before the demo

1. Build installed on all phones; same app commit on each. Record the commit hash and the build id. The `development` profile needs Metro on the Mac, which the offline scenes cannot have; use a `preview` build (embedded bundle). No `preview` build has been made yet.
2. Phone A: Apple Intelligence enabled and model downloaded (done earlier, while online).
3. Phones paired with each other in the app, with the six-digit code compared by a person on each side. A relay only forwards between two phones it is itself paired with, so B must be paired with both A and C.
4. External internet disabled on all phones: airplane mode on, then turn Wi-Fi and Bluetooth back on. Do not join an internet-connected Wi-Fi network.
5. Show the audience the airplane-mode indicator and say which radios are on.
6. Apps in the foreground on all phones.

## Scene A — Unseen input, real local AI

- **Goal:** show real on-device extraction of a new report.
- **Steps:** On phone A, ask a judge for a new English sentence describing a non-sensitive synthetic situation. Type it. Open the Intelligence tab. Show the original text, each proposed field with its evidence span, fields left `unknown`, the capability state and the elapsed time on the diagnostics screen.
- **Say:** "This ran on this phone through the Callstack Apple provider. There is no network. The app did not invent anything it could not point to in the text."
- **Optional:** a Filipino sentence, only if `fil` support has been tested and recorded.
- **Status:** not yet rehearsed. Code: extraction and the Intelligence segment are unit-tested with a fake runtime; no real inference has been run.
- **Honest fallback:** if the model is unavailable, show the unavailable state and the original report being sent unchanged. That is Scene B. Do not show a simulated extraction as real.

## Scene B — SOS is never blocked

- **Goal:** show that manual SOS persists and queues with AI unavailable.
- **Steps:** Use a genuine unavailable state: run SOS on a phone where the text model is not available. Press SOS. Show the incident saved and queued with the raw report.
- **Say:** "The model is not available on this phone. The request was saved and queued anyway."
- **Note:** the only AI off switch is "Main local AI ready" in Demo Lab, and it exists only in Demo mode, where storage is in memory and everything is simulated. If it is used, the whole scene is simulated, including the persistence; say so and keep the SIMULATED bar in frame. There is no failure injection in LIVE.
- **Status:** not yet rehearsed. Code: unit-tested (`src/services/__tests__/sos.test.ts`).
- **Honest fallback:** if no phone has the build, there is no live version of this scene; show it in Demo Lab as simulated, or show the recorded test output (`src/services/__tests__/sos.test.ts`) and say it is a test.

## Scene C — Offline trust and Rescue Capsule

- **Goal:** show an encrypted packet A→B over local transport, a receipt, and visibility by permission.
- **Steps:** On A, review recipients and send the capsule to B. Show A moving from queued to delivered only when the receipt arrives. On B, show the summary. Then B's human taps Acknowledge; show that as a separate timeline entry on A. Show a relay-only view that contains routing data and ciphertext only.
- **Say:** "Delivered means B's phone stored it and signed a receipt. Acknowledged means Mika tapped."
- **Status:** not yet rehearsed. Code: unit-tested with an in-memory radio and simulated crypto. Observed between two simulators on one Mac (2026-10-10, real Swift transport and CryptoKit module): queued, then delivered on the signed receipt, then "Seen" as a separate entry. No packet has passed between two phones.
- **Honest fallback:** if transport fails, show A's capsule as `QUEUED` and explain that this is the correct state when no peer is reachable. Show the encryption tests' recorded output instead of a live transfer.

## Scene D — CareChain handoff

- **Goal:** show voluntary, specific task acceptance by different people.
- **Steps:** Mika (B) declines the in-person task and offers to contact staff. Noah (C) accepts meeting the requester. Show A's Coordination tab with each task, who accepted it and its state.
- **Status:** not yet rehearsed. Code: unit-tested as above. Relaying is automatic: A's packet for C goes through B as soon as B is connected to both.
- **Honest fallback:** if three-phone relay has not passed its physical test, run the live flow with two phones (A and B) and show Noah's step in Demo Lab with the SIMULATED banner, saying so.

## Scene E — Contradiction and proof

- **Goal:** show that conflicting statements are both kept and a human resolves.
- **Steps:** Alex's report says Building B, second floor. Mika reports first floor. On A, show the conflict flagged, both statements with source and time, and the local AI note if the model is ready. Alex confirms the correct floor. Show the timeline with every entry retained.
- **Say:** "The conflict was detected by a deterministic rule. The model may add a note. Neither one decided the answer."
- **Status:** not yet rehearsed. Code: unit-tested (`src/services/__tests__/conflict.test.ts`). No test shows the model adding a note beyond what the rule already flags.
- **Honest fallback:** if the model is unavailable, show the rules-engine flag alone.

## Scene F — No assumptions

- **Goal:** show the distinct states and the product's limits.
- **Steps:** On the Timeline, point to each state as a separate entry with its evidence: queued, delivered, acknowledged ("Seen"), role taken, progress reported, completion reported, completion confirmed, resolved. There is no "arrival" state: a responder reporting progress on an in-person task shows as "on the way" with "Arrival is not confirmed".
- **Say:** "A reachable peer is not an emergency dispatcher. This is a prototype for coordinating help between people who are nearby and connected. It does not guarantee rescue."
- **Status:** not yet rehearsed.
- **Honest fallback:** none needed; if a state was not reached live, say which ones were not.

## Deliverables checklist

| Item | Status |
| --- | --- |
| Build installed on phone A | BLOCKED (build `512bf15c` exists; install failed twice on 2026-10-10, phone locked) |
| Builds installed on phones B and C | BLOCKED (phones not on iOS 26, not paired with the Mac, not registered for internal distribution) |
| `preview` build for offline runs | NOT STARTED |
| 60 to 90 second backup recording of real steps | NOT STARTED |
| Rehearsal of scenes A to F on physical devices | BLOCKED (no build on any phone) |
| Measured inference time ([LOCAL_AI_BENCHMARKS.md](LOCAL_AI_BENCHMARKS.md)) | NOT STARTED |
| Disclosures ([HACKATHON_DISCLOSURES.md](HACKATHON_DISCLOSURES.md)) | IN PROGRESS |
| List of Swift-native gaps and why Callstack does not cover them ([ARCHITECTURE.md](ARCHITECTURE.md)) | IMPLEMENTED (table "TypeScript / native boundary") |

Recordings are kept out of the repository (`demo-recordings/` is git-ignored).

## Rehearsal log

| Date | Scene | Devices | Live or simulated | Outcome | Notes |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — |
