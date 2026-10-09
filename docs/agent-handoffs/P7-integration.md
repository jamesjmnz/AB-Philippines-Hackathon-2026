# Handoff: PulseApp integration (LIVE and DEMO), sync engine, relay, pairing

- Agent: integration engineer
- Phase: P7
- Date: 2026-10-10
- Outcome: complete in Jest. Nothing here has run on a phone. Every claim below about the radio, the keychain, CryptoKit, SQLite on device or the Apple model is unverified.

## Changed files

Nothing was staged or committed. Nothing in `src/domain`, `src/storage`, `src/ai`, `src/ui`, `src/app`, `src/components`, `modules/`, `package.json` or any config was edited. `src/services/api.ts` is unchanged.

| Path | What it is |
| --- | --- |
| `src/sync/types.ts` | `KeyValueStore`, `Timers`, `PeerRecord` (a paired device: id, local name, default level, key material) |
| `src/sync/packet.ts` | Wire format: strict Zod schema, encode/decode, 512 KiB cap, `capsuleIdFor`, `incidentRefFor` |
| `src/sync/pairing.ts` | `PairingManager`: hello / compare / confirm handshake |
| `src/sync/relay.ts` | `RelayStore`: kv-backed queue of ciphertext carried for others |
| `src/sync/SyncEngine.ts` | Outbox sending, routing, receive path, receipts, relay, retries, peer reachability |
| `src/crypto/capsule.ts` | `eventTier`, `sectionsForLevel`, `buildCapsuleSections`, `parseCapsuleSections`, projection schema |
| `src/services/PulseCore.ts` | One device's core: every `PulseAction` and the snapshot |
| `src/services/views.ts` | `IncidentView` / `FactView` builders, `shortIdFor`, policy input mapping |
| `src/services/kv.ts` | In-memory kv, key prefixing, JSON helpers |
| `src/services/live.ts` | `createLiveApp()` and the lazy native wiring |
| `src/services/index.ts` | Exports `createLiveApp`, `createDemoApp`, the api types and `PulseProvider` hooks |
| `src/demo/simulatedCrypto.ts` | SIMULATED `CapsuleCrypto` that enforces access |
| `src/demo/memoryHub.ts` | SIMULATED radio: in-memory `PeerTransport` hub with link and fault control |
| `src/demo/SimulatedAI.ts` | SIMULATED `LocalAIService` (port of the design's keyword extraction) |
| `src/demo/personas.ts`, `world.ts`, `scenarios.ts`, `createDemoApp.ts` | Personas, the three-device world, the seed, the six scenarios, the DEMO `PulseApp` |
| `src/crypto/testing/index.ts`, `src/transport/testing/index.ts` | Re-exports of the two simulations under test-facing names |
| `src/services/testing/harness.ts` | Jest harness: N cores on the hub with the fake crypto, manual clock, inert timers |
| `src/**/__tests__/*.test.ts` (14 files) | See Tests |
| `docs/NETWORK_PROTOCOL.md` | Rewritten from "planned" to what `src/sync/` does; native parts still marked as plan |

## Commands run

| Command | Exit | Summary lines |
| --- | --- | --- |
| `npx tsc --noEmit` | 0 | no output |
| `npx expo lint` | 0 | no errors, no warnings |
| `npx jest` (whole repo) | 0 | `Test Suites: 37 passed, 37 total` / `Tests: 377 passed, 377 total` / `Snapshots: 0 total` |
| `npx jest src/sync src/services src/demo src/crypto` | 0 | `Test Suites: 14 passed, 14 total` / `Tests: 87 passed, 87 total` |

Not run: `expo run`, `expo prebuild`, pod, Xcode, anything on a device.

Two mutations were applied and reverted to check the tests bite: giving the `trusted` level the `detail` section failed 5 tests; removing the relay's hop check together with clearing the outbox row on send (instead of on receipt) failed 20.

## How to mount

```ts
import { createLiveApp, createDemoApp } from '@/services';
```

- `createLiveApp(): Promise<PulseApp>`. Await it once in the composition root. It resolves as soon as the SQLite ledger is open, with `snapshot.ready === false`; identity, capabilities and discovery finish in the background and `ready` flips (bounded at 2.5 s, so a stuck keychain cannot hold the UI). It rejects only when storage cannot be opened. `src/components/AppRoot.tsx` already accepts a factory that returns a promise.
- `createDemoApp(options?): DemoApp` is synchronous. Its snapshot is `ready: false` with empty lists until the simulated world is seeded, then `ready: true`. Options: `aiDelayMs` (default 900; tests pass 0), `stepScale`, `timers`, `now`.
- Call `dispose()` on the app you replace. Live and Demo share no storage, no identity and no adapters.
- Importing `@/services` loads no native module. LIVE adapters are `require`d inside `createLiveApp`.

## Architecture as built

`PulseCore` takes `{ mode, repo, ai, transport, crypto, kv, clock, ids, deviceInfo, timers?, readFile?, config?, seed? }` and is itself a `PulseApp`. LIVE is one core on real adapters. DEMO is three cores (Alex, Mika, Noah) with in-memory repositories and kv, the simulated crypto and AI, joined by the simulated radio; the Demo app decorates the viewed core's snapshot with `mode: 'demo'` and `demo` state and forwards actions to the viewed device.

- **Ledger lock.** Every replay-then-commit section runs under one promise-chain lock per core. No await on AI, crypto or transport ever happens inside it.
- **SOS.** `sendSOS` awaits local storage, takes the lock, runs `createManualSOS` + `repo.commit`, releases, kicks delivery without awaiting it, rebuilds the snapshot, returns. If there is no device identity yet (keychain slow or broken on first launch) it mints a provisional `dev-…` id rather than wait; when the real identity arrives the provisional id is kept as an alias so the incident stays this device's own.
- **Recipients.** A new SOS names every trusted peer whose default level is not `relay`. Relay-level peers never get a packet of their own and nothing is ever "delivered" to them.
- **Snapshot.** Frozen; replaced only when a piece changed; unchanged pieces (`me`, `settings`, `peers`, `incidents`, each `IncidentView`) keep their reference. Actions resolve after the snapshot reflecting them is published.
- **Facts.** On the reporter's device `facts` come from the replayed state. On any other device they come from the reporter's latest projection (stored in kv), because that device may not hold the detail events; a field the projection lacks is `protected: true` with `value: null`. `state` on a non-owner device is still correct for status, tasks, recipients and timeline. Its `state.claims` and `state.contradictions` can be incomplete: use `facts` for field values.

Wire format, receive path, receipts, retries, relay and pairing are specified in `docs/NETWORK_PROTOCOL.md`, which now matches the code. In short: one JSON packet `{ v, packetId, kind, hops, to, envelope }` per recipient; `summary` and `detail` sections built from `projectForLevel` and the tiered ledger; a receipt is sent only after the packet was verified and stored in one transaction; a relay stores and forwards ciphertext it has no key for, for at most one hop.

## What the tests cover

| Brief item | Where |
| --- | --- |
| (a) queued with no peer; delivered only after a receipt (a resolved send with a lost receipt stays `send_attempted`) | `services/__tests__/delivery.test.ts` |
| (b) A→B, ack ≠ accept, offer ≠ accept, progress, completion reported, confirmed by reporter only, resolved; both devices compared at each step | same |
| (c) link down → queued; reconnect → delivered once; replayed packet is a no-op and is receipted again; duplicated and reordered packets | same |
| (d) A→B→C relay: relay's repository, snapshot, kv and relay queue hold no incident content, its key opens nothing it carried, receipt returns through it; store until the link returns; relay switched off; hop limit at relay and recipient | `services/__tests__/relay.test.ts` |
| (e) trusted gets summary only (`protected` symptom, `originalReport === null`, restricted events absent from its ledger and kv); authorized gets both; nothing restricted before a capsule is reviewed; sharing switched off | `services/__tests__/disclosure.test.ts` |
| (f) tampered ciphertext, header, hop limit and wraps; envelope under another packet id; wrong version; oversized; expired; untrusted sender; receipt forged by a third device. None is ingested or receipted | same |
| (g) conflicting floor from a responder (authorized and trusted variants): both kept, flagged, responders refused, reporter resolves, all three devices converge | `services/__tests__/conflict.test.ts` |
| (h) pairing: both confirm → trusted and usable; one-sided → not trusted; cancel; material that does not belong to the link; forged confirmation; unreachable peer | `services/__tests__/pairing.test.ts` |
| (i) SOS with AI, transport and crypto all hanging or all throwing, with zero peers and with one; provisional identity | `services/__tests__/sos.test.ts` |
| (j) Demo: seed, each of the six scenarios to its end status on all three devices with no refused step, demo/simulated labelling, AI switch, link switch, reset | `demo/__tests__/demoApp.test.ts` |
| (k) snapshot reference stability, restart from storage, delete all, discovery on/off | `services/__tests__/snapshot.test.ts` |
| AI actions, clarification, transcription with an injected reader | `services/__tests__/ai.test.ts` |
| LIVE wiring with native modules failing to load | `services/__tests__/live.test.ts` |
| Packet codec, relay store, tiers and sections, fake crypto, hub, SimulatedAI | `sync/`, `crypto/`, `demo/` test folders |

Scenario end states: `normal` → `role_taken`; `intelligence` → `delivered` with the floor confirmed and one resolved contradiction; `multi-responder` → `in_progress`; `privacy` → `delivered`; `offline-recovery` → `acknowledged`; `complete` → `resolved`.

Not tested: the AI-flagged conflict path producing a flag (see Deviations 6); two relays in range of each other; a kv or repository that fails mid-operation; more than three devices; timer-driven behaviour of the LIVE app beyond one retry tick; anything native.

## Deviations from the brief and from `api.ts`

1. **`createLiveApp` returns a promise.** `api.ts` does not define the factories. A promise lets a storage failure reach `AppRoot`'s error screen instead of leaving a snapshot that is never ready.
2. **The simulations live in `src/demo/`, not in `testing/` folders.** ESLint forbids app code from importing `**/testing/*`, and the Demo Lab needs both. `src/crypto/testing` and `src/transport/testing` re-export them for tests.
3. **Packets carry a `to` field, and pairing packets carry `pairing` instead of `envelope`.** Pairing happens before any shared key exists, so those three kinds are not sealed.
4. **A third tier, `withheld`.** When the policy shares a detail item with nobody (report text while "share symptoms" is off; floor claims while detailed location is off) the event goes only to the reporter. Tiering follows `canReadItem`, so a floor confirmation is summary-tier only when detailed location is shared.
5. **An observation the reporter adds themselves is detail-tier**, like their report. Only responders' observations are summary-tier.
6. **AI conflict flagging is implemented but has nothing to add today.** A flag needs two human revisions with different values; the deterministic rules already flag every such pair in the same command. The path runs only when the device's text capability is `ready`, maps the model's statement ids to revisions, skips anything already covered, and never resolves. One test asserts it does not duplicate or resolve; none shows it adding a flag.
7. **Relaying is automatic.** In the design Mika forwards to Noah by hand. Here Alex's packet for Noah goes through Mika as soon as Mika is connected. The `multi-responder` and `complete` scenarios keep the step as a delivery retry.
8. **Seeded history is three incidents, not five.** The design's incidents reported by Sofia and Daniel would need two more simulated devices. Seeded: Alex's open request, a request from Mika that Alex helped resolve, and an SOS Alex cancelled. Ids are generated (`PULSE-91EA` style short ids), not the design's fixed `PULSE-2048`.
9. **Demo radio topology is Alex — Mika — Noah**, as in the design's `reach()`: `links.mika` is Alex↔Mika, `links.noah` is Mika↔Noah. Alex sees Noah as `unreachable`; `PeerReach` has no "through relay" value.
10. **`answerClarification` normalises a floor or building answer with the domain's deterministic rules** before confirming, so "nasa ikalawang palapag ako" becomes `Second floor`. `skipClarification` records a question and its skip together when none was open, so the model stops asking.
11. **`SimulatedAI` reports `latencyMs: 0`** on every result, since a simulated call has no measured latency.

## Gaps in `api.ts` worth a decision

- There is no action to change a paired peer's default disclosure level. New pairings start at `trusted`; per-incident levels are set through `updateCapsule`. `PulseCore.setPeerLevel(deviceId, level)` exists but no screen can reach it.
- `startPairing` waits up to 8 s for the peer's key material. `snapshot.pairing` is null until then, because a `PairingSession` needs a code.
- `PeerReach` cannot say "reachable through a relay".
- `IncidentView` has no conflict id for a device that cannot read the conflicting statements. `requestConflictClarification` accepts the reporter-side id (its format names the field), but a trusted responder's UI has no list to take it from.

## Domain and storage changes that would help (not made)

| Where | Change | Why |
| --- | --- | --- |
| `IncidentRepository` | `getOutbox(packetId)` | A receipt is matched by scanning `getPendingOutbox()`. |
| `IncidentRepository` | cancel or expire a single outbox row | Rows addressed to a peer that was removed, or downgraded to `relay`, cannot be cleared. They are skipped (no key material) or sent as unreadable ciphertext. |
| `src/domain/commands` | per-event signatures at build time | Events are authenticated only by the envelope they arrived in. See Security notes. |
| `docs/SECURITY_PRIVACY.md` | Status, pairing and envelope sections | They still say "planned". Not in my write set. |

## Security notes for the reviewer

- **A reporter can forge a responder's event.** Events are unsigned; a receiver accepts an event if its author is the device that sealed the envelope, or if the sealing device is the incident's reporter (who passes on everyone's events). A malicious reporter could therefore invent an acknowledgment. A responder cannot forge the reporter's events or another responder's.
- **`hops` is not signed.** A relay can understate it. The signed `hopLimit` still bounds honest hops, and a relay here never forwards to another relay.
- **Pairing can end one-sided** if the last `pair_confirm` is lost: one phone trusts, the other does not, and the second ignores the first. Nothing retransmits.
- **Tightening a policy does not recall anything.** Content already delivered stays on the recipient's device; only the stored projection, and so what the screens show, changes.
- **`deleteAllIncidents` is local.** It also clears the duplicate-packet table, so an incident that is still active elsewhere reappears the next time its reporter syncs.
- The simulated crypto is not cryptography. It exists so access tests mean something: plaintext is kept in a private per-realm vault, never in the envelope, and signatures are keyed digests over the whole envelope.
- No `console.*` call exists in `src/sync`, `src/services`, `src/demo` or `src/crypto/capsule.ts`. Results returned to screens carry codes and fixed messages; this is by construction, not by a test.

## Known limits

- The reporter sends the whole eligible ledger in every packet. Traffic grows with the square of the event count, and an incident whose packet exceeds 512 KiB or 1000 events per section stops syncing silently (the row stays pending). Sync cursors exist in the repository and are unused.
- One relay hop only.
- A responder sends its events directly only to participants it has paired with; everyone else gets them from the reporter's rebroadcast, so two responders who never paired depend on the reporter being reachable.
- Every snapshot rebuild reads all incidents; replay is skipped for incidents whose event count, pending count and projection are unchanged.
- If the kv store module fails to load in LIVE, profile, pairings and settings fall back to memory and are lost on restart, with no indication in the snapshot.
- No app background/foreground handling: discovery is not stopped or restarted on lifecycle changes.

## LIVE behaviour that is unverified

All of it. Specifically:

- `createLiveApp` end to end on a device. Jest covers the composition with storage replaced by the in-memory repository and the three native adapters replaced by modules that throw on load.
- That `PulsePeer` reports a peer by the same id that peer passed to `start(deviceId)`. The sync layer relies on this: it looks trusted peers up by that id, and pairing rejects key material whose device id differs from the link's id.
- What `PulsePeer` does when both phones call `connect` at once (both sides auto-connect to trusted peers on discovery), and whether it emits `disconnected` on `stop()`.
- That native `verifyPeerPairing` returns the same code on both phones, and that `signEvent` / `verifyEventSignature` round-trip between two devices. Receipts and pairing confirmations depend on them.
- That native `encryptForRecipients` accepts a recipient with an empty section list (used for a recipient downgraded to `relay`), and its behaviour for a section with no recipient.
- Native rejection messages mapping to `not_a_recipient` (the receive path treats that one reason as "ciphertext only, still receipt").
- `expo-sqlite/kv-store` (`Storage.getItemAsync` / `setItemAsync` / `removeItemAsync`), `expo-crypto` `randomUUID`, `expo-device` `modelName` / `osVersion`, and `expo-file-system` `new File(uri).arrayBuffer()` for the WAV reader. All typecheck against the installed packages; none has executed.
- `TextEncoder` / `TextDecoder` under Hermes (used by the existing `src/transport/base64.ts`, which the packet codec calls).
- Packet sizes against the native frame limit, and timing: the 5 s retry timer, 6 h envelope lifetime, 8 s pairing wait and 2.5 s startup bound were chosen, not measured.
- Seeding the Demo world takes about 0.2 s in Node; on a phone it has not been measured, and the Demo app shows `ready: false` for that long.

## Blockers

None.
