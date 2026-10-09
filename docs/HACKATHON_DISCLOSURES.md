# Hackathon disclosures

Event: AppBuildersPH 2026, theme "Local AI". Last updated: 2026-10-09.

**Current state:** the project is at the start of development. Nothing described below as planned has been built or demonstrated yet. This document will be updated to state only what was actually shown.

## What PULSE is and is not

PULSE 2.0 is a prototype for coordinating assistance between nearby iPhones without internet. It is not an emergency service, not a medical device, and not a guaranteed rescue channel. Demonstrations use synthetic personas and synthetic incidents only.

## What runs locally (planned)

| Function | Where it runs | Implementation |
| --- | --- | --- |
| Incident text interpretation, clarification, conflict notes, task proposals | On the iPhone | Apple's built-in on-device model (Apple Foundation Models), through Callstack `@react-native-ai/apple` |
| Text embeddings | On the iPhone | Apple `NLContextualEmbedding`, through the same package |
| Speech to text | On the iPhone | Apple `SpeechAnalyzer`, through the same package |
| Text to speech (optional) | On the iPhone | Apple `AVSpeechSynthesizer`, through the same package |
| Conflict detection for explicit fields | On the iPhone | Deterministic TypeScript, no model |
| Storage | On the iPhone | SQLite |
| Peer discovery and transfer | Between iPhones, local link | Apple Network framework and Bonjour, PULSE Swift module |
| Encryption and signatures | On the iPhone | Apple CryptoKit and Keychain, PULSE Swift module |

The on-device text model is expected to be available only on the iPhone 17 Pro Max. The iPhone 14 Pro Max and iPhone 13 act as responders and relays and do not run it.

## What needs a network

**Nothing in the live path.** There is no server, no account, no cloud inference, no cloud sync and no analytics. There is no remote fallback when the local model is unavailable; the app sends the original report instead.

One-time setup that needs internet, outside the app's own behaviour:

- Installing dependencies and building the app on the development Mac.
- Apple Intelligence model download by iOS on the eligible phone.
- Speech and language assets that iOS may download during `prepare()`.

## Models

| Model | Provider | Bundled with the app? |
| --- | --- | --- |
| Apple on-device language model | Apple, part of iOS (Apple Intelligence) | No. Supplied by the operating system. |
| Apple contextual embedding model | Apple, part of iOS | No. |
| Apple speech recognition | Apple, part of iOS | No. |

No third-party or open-source model weights are shipped. If that changes, this table will list the model, size, licence and source.

## Frameworks and licences

The "confirmed" column records whether the licence has been checked against the installed package metadata. That check is scheduled for Phase 9.

| Component | Role | Licence | Confirmed |
| --- | --- | --- | --- |
| Expo SDK 57, Expo Router, Expo modules | App framework | MIT | No |
| React Native 0.86, React 19 | UI runtime | MIT | No |
| `@react-native-ai/apple` (Callstack) | Apple on-device AI provider | MIT | No |
| `ai` (Vercel AI SDK v6) | Model invocation API | Apache-2.0 | No |
| Zod | Runtime validation | MIT | No |
| NativeWind, Tailwind CSS | Styling | MIT | No |
| Zustand | UI state | MIT | No |
| React Native Reanimated, SVG, Gesture Handler, Screens | UI libraries | MIT | No |
| Material Symbols Rounded | Icon font | Apache-2.0 | Yes |
| Apple frameworks (Foundation Models, Speech, NaturalLanguage, Network, CryptoKit, Security) | Platform | Apple SDK terms | n/a |

## Design

- The interface was designed with **Claude Design**. The export is kept in `design/` as a reference and is not shipped in the app.
- The visual direction is a general minimal light style. No assets, icons, images or branding from Cal AI or any other product are used.
- Icons are Material Symbols Rounded.

## AI coding tools

- The code and documentation are written with **Claude Code**, an AI coding tool by Anthropic, under the direction and review of the repository owner.
- By project decision, commit messages carry no AI trailers. This section is the disclosure of AI-tool use.
- Claude Code is a development tool only. It is not part of the app and the app makes no calls to it or to any Anthropic service.

## Demo Lab is simulated

The app will contain a Demo Lab with scripted personas (Alex, Mika, Noah) and scripted scenarios. Everything in Demo Lab is simulated: the AI responses, the transport and the encryption. Every Demo Lab screen carries a SIMULATED banner. No performance number comes from Demo Lab.

## Pre-existing work

The repository started from one commit containing only a README; there was no existing app code. The only material that predates the code is the owner's Claude Design export of the PULSE interface, kept in `design/`.

## What was actually demonstrated

To be filled in after the demonstration, with one line per scene: live or simulated, devices used, and outcome.

| Scene | Live or simulated | Devices | Outcome |
| --- | --- | --- | --- |
| — | — | — | — |
