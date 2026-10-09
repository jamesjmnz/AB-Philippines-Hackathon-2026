# Known limitations

Last updated: 2026-10-10. At this date the largest limitation is that nothing has run on a physical iPhone. The code is written and unit-tested and a device build exists (EAS `fbc85457`), but the build has not been installed, LIVE mode has not been observed anywhere, and every test of delivery, relay, disclosure and pairing used an in-memory radio and a simulated crypto. The items below are limits of the design and platform, limits of the code as built, and the areas that are currently unverified.

## Safety scope

- PULSE is a prototype. It is not an emergency service, a medical device, a certified fall detector, a background guardian or a guaranteed rescue channel.
- It never contacts public emergency services on its own. Calling an emergency number is always the user's own action.
- It does not diagnose, rate severity, prioritise or give medical instructions.
- A delivered packet means a device stored it. It does not mean a person saw it, agreed to help, or arrived.

## Reach

- Only participating iPhones that are nearby, running the app in the foreground and paired as trusted can exchange content.
- If no trusted peer is reachable, an SOS stays `QUEUED`. It may never be delivered.
- Range depends on the local radio link between the devices. It is not a long-distance channel.
- Relay is a store-and-forward step with a hop limit. It is not a universal mesh. A packet crosses at most one relay: a relay never forwards to another relay. Multi-hop is claimed only if the three-phone test is run and recorded.
- A relay forwards only between two devices it has itself paired with, because it verifies the envelope against the origin's key.
- A responder sends its events directly only to participants it has paired with. Everyone else gets them from the reporter's rebroadcast, so two responders who never paired depend on the reporter being reachable.

## iOS lifecycle

- Foreground only. Discovery and connections are not expected to work while the app is suspended or the phone is locked.
- The app has no background/foreground handling. Nothing stops discovery when the app is backgrounded or restarts it on return; what the Swift module does across that transition has not been observed.
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

## Sync and ledger (as built)

From the Phase 2 and Phase 7 handoffs ([P2-domain](agent-handoffs/P2-domain.md), [P7-integration](agent-handoffs/P7-integration.md)).

- **The whole ledger is resent every time.** The reporter's device puts the whole eligible ledger in every packet, so traffic grows with the square of the event count. Sync cursors exist in the repository and are unused.
- **A large incident stops syncing silently.** A packet over 512 KiB is not built, and a section with more than 1000 events fails the receiver's schema. Either way the outbox row stays pending and nothing tells the user.
- **The native frame limit is smaller than the packet limit.** `modules/pulse-peer` rejects frames over 256 KiB (`FrameCodec.maxFrameLength`), while `src/sync/packet.ts` allows packets up to 512 KiB. A packet between the two sizes would pass the TypeScript check and be refused by the Swift module. Never exercised; packet sizes have not been measured.
- **Ordering trusts the author's `lamport` value.** A device can pick a low value so its event sorts earlier, for example to win a concurrent task acceptance. Nothing checks `lamport` against `parents`.
- **Same id, different content is not detected.** Each device keeps whichever copy of an event id it stored first, so two devices could diverge.
- **Tightening a disclosure policy recalls nothing.** Content already delivered stays on the recipient's device; only what the screens show changes.
- **Delete all is local.** It also clears the duplicate-packet table, so an incident still active elsewhere reappears the next time its reporter syncs.
- **Outbox rows cannot be cancelled one at a time.** Rows addressed to a peer that was removed or downgraded to `relay` stay pending and are skipped.
- **No ledger compaction or deletion**, and no retention rule for quarantined packet bodies (up to 8 KB each, stored as received).
- Every read replays the incident's full ledger. Not measured beyond the 24-event test history.
- If the key-value store module fails to load in LIVE, the profile, pairings and settings fall back to memory and are lost on restart, with no indication on screen.
- The rules that extract floors and buildings are narrow: floors above the tenth in words, "basement", "mezzanine", "itaas/ibaba" and named buildings are not recognised.

## Unverified today

| Item | Why it matters |
| --- | --- |
| The app launching on any iPhone | Build `fbc85457` exists; its install failed because the phone was locked. |
| LIVE mode end to end (`createLiveApp`) | Jest covers the composition only with the native modules failing to load. Nothing about LIVE has been observed, on a phone or in the simulator. |
| `expo-sqlite` driver (`src/storage/expoDriver.ts`) | Tests use `better-sqlite3`. Triggers, `INSERT OR IGNORE` change counts, exclusive-transaction rollback and WAL mode are unchecked on a device. |
| Real on-device inference, refusals, and the error wording the classifier matches | The adapter is tested with a fake runtime only. |
| That `PulsePeer` reports a peer under the id that peer passed to `start(deviceId)` | The sync layer looks trusted peers up by that id, and pairing rejects key material whose id differs from the link's id. |
| What happens when both phones call `connect` at once, and whether `stop()` emits `disconnected` | Both sides auto-connect to trusted peers on discovery. |
| That native `verifyPeerPairing` returns the same code on both phones and that signatures round-trip between two devices | Receipts and pairing confirmations depend on it. |
| Native `encryptForRecipients` with a recipient that has no sections; native error text mapping to `not_a_recipient` | Used for relay-level recipients and for the "ciphertext only, still receipt" path. |
| `expo-sqlite/kv-store`, `expo-crypto` `randomUUID`, `expo-device`, `expo-file-system` file reading, `TextEncoder` / `TextDecoder` under Hermes | All typecheck; none has executed. |
| Voice recording (`expo-audio`, 16 kHz mono WAV) and whether the file suits transcription | Never run. |
| iOS version on the iPhone 14 Pro Max and iPhone 13 | Not yet paired; planned update to iOS 26. |
| Embeddings and transcription on the older phones | Requires per-feature probes on each device. |
| Which radio path peer connections use with no infrastructure Wi-Fi | Must be observed on devices. |
| Secure Enclave and Keychain use through `modules/pulse-crypto` | `swift test` uses software keys on macOS. Must be observed on devices. |
| Timing values: 5 s retry timer, 6 h envelope lifetime, 8 s pairing wait, 2.5 s startup bound | Chosen, not measured. |
| VoiceOver order, Dynamic Type, Reduce Motion | Never exercised. |

Answered since 2026-10-09: `@react-native-ai/apple` 0.12.0 does build on React Native 0.86.3 (EAS build `fbc85457`, Xcode 26.6, iOS 26.5 SDK). Whether it runs is still unverified. The SDK 54 fallback was not triggered.

## Security

- The design has had no external security review.
- **Events are not signed individually.** An event is authenticated only by the envelope it arrived in. A receiver accepts an event if its author is the device that sealed the envelope, or if the sealing device is the incident's reporter, who passes on everyone's events. A malicious reporter can therefore forge a responder's event, for example an acknowledgment. A responder cannot forge the reporter's events or another responder's.
- **`hops` is not signed.** A relay can understate it. The signed `hopLimit` still bounds honest hops.
- **Pairing can end one-sided.** If the last `pair_confirm` is lost, one phone trusts and the other does not. Nothing retransmits; the people have to pair again.
- Removing a trusted peer is local. The other phone is not told and keeps its own record.
- The domain does not verify receipt signatures itself; it relies on the sync layer having done so before the receipt is recorded.
- No forward secrecy. A compromised device key exposes capsules addressed to that device.
- A compromised or unlocked device is out of scope.
- Metadata (that a PULSE device is nearby, packet sizes, timing) is visible to observers on the local link.
- Content delivered to an authorized recipient cannot be recalled from their device.

## Development environment

- One simulator runtime is installed (iOS 26.3). The EAS simulator build runs there. The simulator has no Apple Intelligence model, no second device to connect to and no Secure Enclave, so it shows the screens in Demo mode and proves nothing about LIVE.
- Local Xcode device builds fail: Xcode 26.3 has no iOS 26.2 platform component installed, so `expo run:ios --device` stops before compiling. Device builds go through EAS, which needs the owner's Expo and Apple credentials.
- The development build needs Metro on the Mac. The `preview` profile, which embeds the bundle for offline runs, has never been built.
- Xcode 26.3 has the iOS 26.2 SDK, which is why the package's GitHub `main` (needing the 26.4 SDK) is not used.
- Jest does not run the NativeWind transform, so styling defects are not caught by tests (one was found only in the simulator).
- Expo Go cannot run the app.

## Platform coverage

iOS only. No Android build, no web build, no iPad layout.
