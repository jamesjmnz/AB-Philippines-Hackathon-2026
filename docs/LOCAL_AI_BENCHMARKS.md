# Local AI benchmarks

**No measurements yet.** As of 2026-10-10 no inference has been run on any device or simulator; the adapter has only been run against a fake runtime in Jest, which produces no numbers. This document defines how measurements will be taken. Numbers are added only when they come from a real call on a named physical iPhone.

## Rules

- Measured numbers only. No estimates, no vendor figures, no numbers from Demo Lab or from tests using a fake model.
- Each row names the device, iOS version, package versions, locale, network state and the date.
- Inputs are synthetic and previously unseen by the code (no hardcoded matching strings).
- External internet is disabled during measurement (airplane mode; Wi-Fi and Bluetooth radios re-enabled only if the scene needs peer transport).
- Report text is not logged. The benchmark records input length, not input content, except for the published synthetic test inputs listed below.

## What will be measured

| Metric | Definition |
| --- | --- |
| Availability check time | Wall time of `inspectCapabilities()`. |
| Extraction latency | Wall time from calling `extractIncidentReport` to a validated result, measured in app code. |
| Clarification latency | Same, for `suggestClarification`. |
| Embedding latency | Wall time of one `embed` call after `prepare()`. |
| `prepare()` time | Wall time of model or locale preparation, first and subsequent calls. |
| Transcription latency | Wall time for one complete audio file, with the audio duration recorded. |
| Outcome | Result state (`ready`, `guardrail_refusal`, and so on). |
| Fields dropped | Count of extracted fields removed by the evidence-span check. |

Memory will be recorded only if a reliable reading is available from Xcode instruments; otherwise the cell stays empty.

## Procedure

1. Install the development build on the device. Record device model, iOS version and app commit hash.
2. Confirm Apple Intelligence is enabled and the model is downloaded (text model only).
3. Enable airplane mode. Confirm no external connectivity.
4. Open `Demo Lab > Local AI` (planned diagnostics screen). Confirm the source reads "real", not "simulated".
5. For each test input: run once cold (first call after launch), then several times warm. Record each run; do not report only the best.
6. Copy the values shown by the diagnostics screen into the table below.

## Planned synthetic inputs

To be finalised in Phase 4. At minimum: one short English report, one longer English report, one Filipino or Taglish report (support UNVERIFIED), one report with no location, one report that should be refused or is off-topic.

## Results

No measurements yet.

| Date | Device | iOS | App commit | Capability | Input (id, length) | Locale | Network | Cold / warm | Latency | Outcome | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — | — | — | — | — | — |

## Environment at time of writing

| Item | Value |
| --- | --- |
| `@react-native-ai/apple` | 0.12.0 (selected) |
| `ai` | 6.0.302 (selected) |
| Eligible device for the text model | iPhone 17 Pro Max, iOS 26.6 |
