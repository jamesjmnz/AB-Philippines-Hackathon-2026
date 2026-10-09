# Demo runbook

Status: script only. **No scene has been rehearsed and none of the features shown exists yet** (2026-10-09). Each scene carries its own status line. A scene is presented as live only after it has been run on the physical devices and recorded in [AGENTIC_PROGRESS.md](AGENTIC_PROGRESS.md).

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

1. Development build installed on all phones; same app commit on each. Record the commit hash.
2. Phone A: Apple Intelligence enabled and model downloaded (done earlier, while online).
3. Phones paired with each other in the app, with the short code compared by a person on each side.
4. External internet disabled on all phones: airplane mode on, then turn Wi-Fi and Bluetooth back on. Do not join an internet-connected Wi-Fi network.
5. Show the audience the airplane-mode indicator and say which radios are on.
6. Apps in the foreground on all phones.

## Scene A — Unseen input, real local AI

- **Goal:** show real on-device extraction of a new report.
- **Steps:** On phone A, ask a judge for a new English sentence describing a non-sensitive synthetic situation. Type it. Open the Intelligence tab. Show the original text, each proposed field with its evidence span, fields left `unknown`, the capability state and the elapsed time on the diagnostics screen.
- **Say:** "This ran on this phone through the Callstack Apple provider. There is no network. The app did not invent anything it could not point to in the text."
- **Optional:** a Filipino sentence, only if `fil` support has been tested and recorded.
- **Status:** not yet rehearsed.
- **Honest fallback:** if the model is unavailable, show the unavailable state and the original report being sent unchanged. That is Scene B. Do not show a simulated extraction as real.

## Scene B — SOS is never blocked

- **Goal:** show that manual SOS persists and queues with AI unavailable.
- **Steps:** Make the text model unavailable (a genuine unavailable state if one can be produced, otherwise the explicit failure-injection switch in Demo Lab). Press SOS on phone A. Show the incident saved and queued with the raw report.
- **Say:** if injection is used, "the AI failure here is injected and labelled; the persistence is real."
- **Status:** not yet rehearsed.
- **Honest fallback:** run SOS on phone B or C, where the text model is not available at all.

## Scene C — Offline trust and Rescue Capsule

- **Goal:** show an encrypted packet A→B over local transport, a receipt, and visibility by permission.
- **Steps:** On A, review recipients and send the capsule to B. Show A moving from queued to delivered only when the receipt arrives. On B, show the summary. Then B's human taps Acknowledge; show that as a separate timeline entry on A. Show a relay-only view that contains routing data and ciphertext only.
- **Say:** "Delivered means B's phone stored it and signed a receipt. Acknowledged means Mika tapped."
- **Status:** not yet rehearsed.
- **Honest fallback:** if transport fails, show A's capsule as `QUEUED` and explain that this is the correct state when no peer is reachable. Show the encryption tests' recorded output instead of a live transfer.

## Scene D — CareChain handoff

- **Goal:** show voluntary, specific task acceptance by different people.
- **Steps:** Mika (B) declines the in-person task and offers to contact staff. Noah (C) accepts meeting the requester. Show A's Coordination tab with each task, who accepted it and its state.
- **Status:** not yet rehearsed.
- **Honest fallback:** if three-phone relay has not passed its physical test, run the live flow with two phones (A and B) and show Noah's step in Demo Lab with the SIMULATED banner, saying so.

## Scene E — Contradiction and proof

- **Goal:** show that conflicting statements are both kept and a human resolves.
- **Steps:** Alex's report says Building B, second floor. Mika reports first floor. On A, show the conflict flagged, both statements with source and time, and the local AI note if the model is ready. Alex confirms the correct floor. Show the timeline with every entry retained.
- **Say:** "The conflict was detected by a deterministic rule. The model may add a note. Neither one decided the answer."
- **Status:** not yet rehearsed.
- **Honest fallback:** if the model is unavailable, show the rules-engine flag alone.

## Scene F — No assumptions

- **Goal:** show the distinct states and the product's limits.
- **Steps:** On the Timeline, point to each state as a separate entry with its evidence: `QUEUED`, `DELIVERED`, `ACKNOWLEDGED`, `ACCEPTED`, `ARRIVAL REPORTED`, `RESOLVED`.
- **Say:** "A reachable peer is not an emergency dispatcher. This is a prototype for coordinating help between people who are nearby and connected. It does not guarantee rescue."
- **Status:** not yet rehearsed.
- **Honest fallback:** none needed; if a state was not reached live, say which ones were not.

## Deliverables checklist

| Item | Status |
| --- | --- |
| 60 to 90 second backup recording of real steps | NOT STARTED |
| Rehearsal of scenes A to F on physical devices | NOT STARTED |
| Measured inference time ([LOCAL_AI_BENCHMARKS.md](LOCAL_AI_BENCHMARKS.md)) | NOT STARTED |
| Disclosures ([HACKATHON_DISCLOSURES.md](HACKATHON_DISCLOSURES.md)) | IN PROGRESS |
| List of Swift-native gaps and why Callstack does not cover them ([ARCHITECTURE.md](ARCHITECTURE.md)) | IN PROGRESS |

Recordings are kept out of the repository (`demo-recordings/` is git-ignored).

## Rehearsal log

| Date | Scene | Devices | Live or simulated | Outcome | Notes |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — |
