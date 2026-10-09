# Device capabilities

Last updated: 2026-10-09. **No feature has been tested on any device.** The "Expected" column is a prediction from platform requirements and package source. The "Tested" column records only what has been observed.

## Devices

| Device | Demo role | iOS | Paired with the Mac | Note |
| --- | --- | --- | --- | --- |
| iPhone 17 Pro Max | Reporter (Alex) | 26.6 | Yes | Only device expected to be eligible for the on-device text model. |
| iPhone 14 Pro Max | Responder and relay (Mika) | not confirmed | No | Owner plans to update to iOS 26. |
| iPhone 13 | Responder (Noah) | not confirmed | No | Owner plans to update to iOS 26. |

There are no Android test devices and no simulator runtimes installed. The app's deployment target is iOS 17.0, with per-feature runtime gating.

## Platform requirements (from package source and the master specification)

| Feature | Requirement |
| --- | --- |
| Text model (Apple Foundation Models) | iOS 26, Apple Intelligence-capable hardware, Apple Intelligence enabled, model downloaded, supported language. |
| Embeddings (`NLContextualEmbedding`) | iOS 17+, `prepare()`, supported language (not `tl` / `fil`). |
| Transcription (`SpeechAnalyzer`) | iOS 26, per-locale availability and `prepare()`. |
| Text to speech | System synthesizer. |
| Peer transport | Network framework, Bonjour, Local Network permission. |
| Crypto | CryptoKit, Keychain; Secure Enclave when available. |

## Feature matrix

Status words follow [README.md](README.md). "Not tested" means exactly that.

### iPhone 17 Pro Max (iOS 26.6)

| Feature | Expected | Tested | Evidence |
| --- | --- | --- | --- |
| Text LLM, structured output | Available if Apple Intelligence is enabled and the model is downloaded | Not tested | — |
| Embeddings (`en`) | Available | Not tested | — |
| Transcription `en-US` | Available | Not tested | — |
| Transcription `fil-PH` | UNVERIFIED | Not tested | — |
| TTS | Available | Not tested | — |
| Peer transport | Available in foreground | Not tested | — |
| Crypto and Keychain | Available | Not tested | — |

### iPhone 14 Pro Max (iOS version not confirmed)

| Feature | Expected | Tested | Evidence |
| --- | --- | --- | --- |
| Text LLM, structured output | **Not available.** The app must not call it or claim it. | Not tested | — |
| Embeddings (`en`) | UNVERIFIED | Not tested | — |
| Transcription `en-US` | UNVERIFIED; needs iOS 26 | Not tested | — |
| Transcription `fil-PH` | UNVERIFIED | Not tested | — |
| TTS | Available | Not tested | — |
| Peer transport | Available in foreground | Not tested | — |
| Crypto and Keychain | Available | Not tested | — |

### iPhone 13 (iOS version not confirmed)

| Feature | Expected | Tested | Evidence |
| --- | --- | --- | --- |
| Text LLM, structured output | **Not available.** The app must not call it or claim it. | Not tested | — |
| Embeddings (`en`) | UNVERIFIED | Not tested | — |
| Transcription `en-US` | UNVERIFIED; needs iOS 26 | Not tested | — |
| Transcription `fil-PH` | UNVERIFIED | Not tested | — |
| TTS | Available | Not tested | — |
| Peer transport | Available in foreground | Not tested | — |
| Crypto and Keychain | Available | Not tested | — |

## Rules

- Eligibility is checked per feature and per locale at runtime. There is no single "AI available" flag.
- A device that receives a structured finding from another device shows it as received, not as its own local inference.
- A row moves to `VERIFIED ON DEVICE` only with the date, iOS version, what was done and what was observed written in the Evidence column.
- Responder and relay roles do not depend on any AI capability.

## How to fill this in

For each row, on the named device: open `Demo Lab > Local AI` (planned), read the reported state, run the probe once with external internet disabled, and record date, iOS version, locale and the observed result.
