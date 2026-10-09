# Known limitations

Last updated: 2026-10-09. At this date the largest limitation is that nothing has been built or tested. The items below are limits of the design and platform that will remain true after implementation, plus the areas that are currently unverified.

## Safety scope

- PULSE is a prototype. It is not an emergency service, a medical device, a certified fall detector, a background guardian or a guaranteed rescue channel.
- It never contacts public emergency services on its own. Calling an emergency number is always the user's own action.
- It does not diagnose, rate severity, prioritise or give medical instructions.
- A delivered packet means a device stored it. It does not mean a person saw it, agreed to help, or arrived.

## Reach

- Only participating iPhones that are nearby, running the app in the foreground and paired as trusted can exchange content.
- If no trusted peer is reachable, an SOS stays `QUEUED`. It may never be delivered.
- Range depends on the local radio link between the devices. It is not a long-distance channel.
- Relay is an explicit store-and-forward step with a hop limit. It is not a universal mesh. Multi-hop is claimed only if the three-phone test is run and recorded.

## iOS lifecycle

- Foreground only. Discovery and connections are not expected to work while the app is suspended or the phone is locked.
- The Local Network permission must be granted; if denied, there is no peer transport.

## Local AI

- The on-device text model needs iOS 26, Apple Intelligence-capable hardware, Apple Intelligence enabled and the model downloaded. Of the three test phones, only the iPhone 17 Pro Max is expected to qualify.
- The iPhone 14 Pro Max and iPhone 13 do not run the text model.
- The provider reports availability as one boolean with no reason, and most errors arrive as free-text messages. Error classification is therefore by message text and may misclassify after an OS update; the fallback is a generic error state.
- The context window is 4096 tokens including instructions, schema and response. Long reports may not fit in one call.
- Structured output is non-streaming.
- The model may refuse inputs that describe distressing situations. The app then sends the original report without AI interpretation.
- AI output can be wrong. It is always shown as a proposal with its evidence, and a human decides.

## Languages

- **UNVERIFIED:** Filipino (`fil-PH`) transcription.
- **UNVERIFIED:** how well the text model handles Filipino or Taglish input.
- Embeddings reject `tl` / `fil` as a language in the package source; duplicate hints are planned for English only.
- When a language is unsupported, the fallback is the user's original typed text. The app will not display a "multilingual AI" claim.

## Unverified today

| Item | Why it matters |
| --- | --- |
| `@react-native-ai/apple` 0.12.0 building on React Native 0.86 | Upstream tests only Expo SDK 54 / RN 0.81. A failure triggers the SDK 54 fallback. |
| iOS version on the iPhone 14 Pro Max and iPhone 13 | Not yet paired; planned update to iOS 26. |
| Embeddings and transcription on the older phones | Requires per-feature probes on each device. |
| Which radio path peer connections use with no infrastructure Wi-Fi | Must be observed on devices. |
| Secure Enclave key use through the planned module | Must be observed on devices. |

## Security

- The design has had no external security review.
- No forward secrecy. A compromised device key exposes capsules addressed to that device.
- A compromised or unlocked device is out of scope.
- Metadata (that a PULSE device is nearby, packet sizes, timing) is visible to observers on the local link.
- Content delivered to an authorized recipient cannot be recalled from their device.

## Development environment

- No simulator runtimes are installed; UI and native behaviour are checked on physical devices only.
- Xcode 26.3 has the iOS 26.2 SDK, which is why the package's GitHub `main` (needing the 26.4 SDK) is not used.
- Expo Go cannot run the app.

## Platform coverage

iOS only. No Android build, no web build, no iPad layout.
