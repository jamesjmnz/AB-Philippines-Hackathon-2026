# Network protocol

Status (2026-10-10): the application protocol on top of the transport (`src/sync/`) is **implemented and unit-tested in Jest** against an in-memory transport and a simulated `CapsuleCrypto`. **No packet has been exchanged between two real devices.** Everything about the radio, Bonjour, the Swift module and CryptoKit on a phone is unverified. Sections describing `src/sync/` say what the code does; sections about the native transport still describe the plan.

## Scope

Foreground, nearby, iPhone-to-iPhone exchange of opaque encrypted packets with no internet connection. The transport knows nothing about incidents. It moves bytes and reports connection state.

PULSE reaches only participating devices that are connected at that moment, directly or through a tested relay. If no peer is reachable the state is `QUEUED` / undelivered.

## Transport choice

Apple Network framework with Bonjour, in a small Swift Expo module (`modules/pulse-peer`). See [ADR/0002](ADR/0002-peer-transport-native-swift.md).

| Element | Planned value |
| --- | --- |
| Listener | `NWListener` |
| Browser | `NWBrowser` |
| Service type | `_sagip-sos._tcp` |
| Peer-to-peer | `includePeerToPeer` enabled, so devices can connect without shared infrastructure Wi-Fi |
| Payload | Length-framed opaque bytes |
| Lifecycle | Foreground only |

Which radio path a connection actually uses (infrastructure Wi-Fi or peer-to-peer link) will be observed and recorded during device tests, not assumed.

## Permissions and configuration

Declared in `app.config.ts`:

| Key | Value |
| --- | --- |
| `NSLocalNetworkUsageDescription` | Explains that PULSE finds trusted nearby iPhones and exchanges encrypted assistance requests without internet. |
| `NSBonjourServices` | `["_sagip-sos._tcp"]` |

The Local Network prompt appears the first time discovery starts. If the user denies it, discovery fails with a typed error; SOS persistence and queueing are unaffected.

## Interface

`src/transport/types.ts`:

```
PeerTransport:
  startDiscovery(localDeviceId), stopDiscovery(), connect(peerId), disconnect(peerId),
  sendOpaquePacket(peerId, bytes), stop(),
  onPeerFound, onPeerLost, onConnectionState, onOpaquePacket, onError
```

`sendOpaquePacket` resolving means the bytes were handed to the radio stack. It is a send attempt and nothing more. The sync layer assumes a `peerId` is the device id that peer passed to `startDiscovery`; this is true of the in-memory hub and **unverified for the Swift module**.

## Discovery and identity

- Bonjour advertises that a PULSE device is nearby. An advertised name is not an identity.
- A discovered peer is treated as trusted only after its key has been matched to a paired `TrustedPeer` (see [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md)).
- Proposed: the advertisement carries no personal name and no incident data.

## Framing

Planned for the native transport: each message is a length prefix followed by opaque bytes. Prefix width is not frozen. The sync layer refuses to build or accept a packet larger than 512 KiB (`MAX_PACKET_BYTES`).

## Packet format (`src/sync/packet.ts`)

One packet is one JSON object, UTF-8 encoded, validated with a strict Zod schema on receipt (unknown keys, unknown kinds and unknown versions are rejected).

```
{ v: 1, packetId, kind, hops, to, envelope }          kind = "capsule" | "receipt"
{ v: 1, packetId, kind, hops, to, pairing }           kind = "pair_hello" | "pair_confirm"
{ v: 1, packetId, kind, hops, to }                    kind = "pair_cancel"
```

| Field | Meaning | Readable by a relay |
| --- | --- | --- |
| `packetId` | Stable across retries; the receiver deduplicates on it. At most 64 characters. | Yes |
| `to` | Final recipient, a pseudonymous device id (`dev-` + 20 hex). | Yes |
| `hops` | Number of relays that have forwarded the packet. Not signed. | Yes |
| `envelope` | A `CapsuleEnvelope` from `CapsuleCrypto.encryptForRecipients`: signed header (`capsuleId`, `incidentRef`, `senderId`, `createdAtMs`, `expiresAtMs`, `hopLimit`), per-section ciphertexts, per-recipient wrapped keys, signature. | Header only |

`envelope.header.capsuleId` must equal the packet id (padded to 8 characters), so an envelope cannot be re-sent under a new packet id to defeat deduplication. `incidentRef` is the incident id, which is random and carries no content.

The pairing packets are the only unsealed ones. They exist before any shared key does and carry public key material, a self-declared display name and a signature. They never carry incident content.

### What is inside a capsule envelope (`src/crypto/capsule.ts`)

Each packet is sealed for exactly one recipient. Section plaintext is JSON:

```
summary: { incidentId, projection: projectForLevel(state, "trusted")    | null, events: [summary-tier events] }
detail:  { incidentId, projection: projectForLevel(state, "authorized") | null, events: [detail-tier events] }
```

| Recipient level | Sections it holds a wrapped key for |
| --- | --- |
| `relay` | none (the envelope carries a placeholder summary with no events) |
| `trusted` | `summary` |
| `authorized`, and the reporter | `summary`, `detail` (the `detail` section is not put in a packet for a `trusted` recipient at all) |

Event tiers are decided by `eventTier`, a pure function of the event and the incident's current disclosure policy:

| Tier | Events |
| --- | --- |
| `detail` | `REPORT_ADDED` authored by the reporter (their own words, including observations they add), `AI_PROPOSAL_CREATED`, and `CLAIM_CONFIRMED` / `CLARIFICATION_REQUESTED` / `CONFLICT_FLAGGED` / `CONFLICT_RESOLVED` about a field the `trusted` level may not read (always `symptom`; `floor` and `locationText` when detailed location is not shared) |
| `summary` | everything else: incident creation, capsule prepared and queued, send attempts, receipts, acknowledgments, declines, every task event, clarification skips, resolution, cancellation, observations written by responders, and claim or conflict events about fields the `trusted` level may read |
| `withheld` | a `detail` event that the policy shares with nobody (for example the report text while "share symptoms" is off). It is sent only to the reporter. |

Content is read from the ledger when the packet is sealed, not when the outbox row was created. The reporter's device sends the whole eligible ledger plus the projection every time, so a late or reordered packet is self-contained. Any other participant sends only the events it authored and no projection.

A receiver stores the latest projection from the reporter per incident. That projection is what a non-owner device shows as facts, because it may not hold the detail events; a field missing from it is shown as protected.

## Three different acknowledgments

These must never be conflated.

| Level | What it is | What it proves | Recorded as |
| --- | --- | --- | --- |
| Transport ack | `sendOpaquePacket` resolved. | Bytes were handed to the connection. Nothing more. | `PACKET_SENT_ATTEMPT`, outbox `markSendAttempt` |
| App-level receipt | A signed receipt created by the receiving device **after** it verified and stored the packet. | The recipient device has the packet durably. | `PACKET_RECEIVED_BY_PEER`, outbox `acknowledgeReceipt` |
| Human acknowledgment | A responder tapped acknowledge. | A person saw it. | `RESPONDER_ACKNOWLEDGED` |

"Delivered" in the UI is driven only by a verified app-level receipt from the intended recipient.

## Receive path (`SyncEngine.onPacket`)

1. Decode and validate the packet. Malformed, oversized or unknown-version packets are dropped.
2. Pairing packets addressed to this device go to the pairing handshake. Every other packet is dropped unless the link it arrived on belongs to a trusted peer.
3. If `to` is another device, see Relay.
4. Check `capsuleId` binding and `hops <= header.hopLimit`.
5. The envelope's `senderId` must be a trusted peer; `verifyEnvelope` checks signature, version and expiry against that peer's stored key material.
6. `decryptAuthorized`. A device with no wrapped key (`not_a_recipient`) skips to step 8 with nothing to ingest.
7. In one repository transaction: `recordInbound(packetId)`; on `duplicate` nothing else happens; otherwise `ingestRemote`. Events are accepted only if their author is the device that sealed the envelope, or the sealing device is the incident's reporter. Events claiming to be authored by this device are never accepted from outside. If this device is the reporter and something new applied, it runs the deterministic conflict rules and queues an `event_sync` to every other participant.
8. Only after the transaction commits, seal and send a `receipt` packet to the sender. A duplicate packet is receipted again, because the first receipt may have been lost.

Any failure in steps 1 to 7 produces no receipt, so the sender keeps the packet queued.

A receipt packet is an envelope sealed to the original sender whose summary section is `{ receipt: { receiptId, packetId, recipientDeviceId, receivedAtMs }, signature }`, where `signature` is `signEvent` over `pulse-receipt-v1|receiptId|packetId|recipientDeviceId|receivedAtMs`. The sender accepts it only if the envelope verifies against the recipient's key, the signature verifies, `recipientDeviceId` equals the envelope sender, and a pending outbox row with that packet id is addressed to that device.

## Send path, retries and reconnect

- Every outbound packet is an outbox row before any send is attempted. Rows of kind `basic_alert` and `capsule` come from the domain commands and have ledger delivery state. Rows of kind `event_sync` carry later events and are outbox-only.
- A row leaves the pending set only on a verified receipt, on expiry, or on cancellation.
- With no path to the recipient nothing is sent and nothing is recorded as attempted: the incident stays `queued` (`awaiting_peer`).
- When a send resolves, the attempt is recorded and the row is scheduled with backoff (2 s doubling to 60 s).
- `retryDue` runs on a 5 s timer, after every local command, after every received packet, and when a trusted peer connects (rows for that peer, and rows whose recipient is not directly connected, ignore backoff at that moment).
- Retries keep the packet id. The content is re-sealed from the current ledger with a fresh expiry (6 h).
- An `event_sync` row that has not been sealed yet is reused for further events to the same recipient, so an unreachable recipient accumulates one row, not one per event.

## Relay (store-and-forward)

Relay is an application mechanism in `SyncEngine`; the transport API does not provide it.

- If the recipient is not directly connected, the sender hands the packet to every connected trusted peer, addressed (`to`) to the final recipient.
- A relay forwards only if relaying is enabled in its settings, the destination is one of its own trusted peers, `hops + 1 <= header.hopLimit`, and the envelope verifies (signature, version, expiry) against the origin's key. The origin must therefore also be one of the relay's trusted peers.
- The relay stores the packet (routing fields plus ciphertext) in its key-value store, keyed by packet id, and hands it to the recipient when that recipient is directly connected. It drops the stored copy once the transport accepted it, or when it expires. A retried packet replaces the stored copy.
- A relay never forwards to another relay, so a packet crosses at most one relay. The default `hopLimit` is 2.
- A relay holds no wrapped key and cannot open any section.
- Receipts are packets too and travel back the same way, preferring the hop the packet arrived through.
- `hops` is outside the signature. A relay that understates it is caught only by the next honest hop's own limit check.

Multi-hop on real phones is claimed only if the three-phone test is run and recorded. Until then the Demo Lab shows it as simulated.

## Pairing (`src/sync/pairing.ts`)

```
A -> B  pair_hello   { material, name }
B -> A  pair_hello   { material, name }
both    verifyPeerPairing(peer material) -> the same six-digit code
human   compares the codes and confirms on their own phone
X -> Y  pair_confirm { signature }      signEvent(transcript | "confirmed-by" | own device id)
```

The transcript is `pulse-pair-v1|<both devices' id:signKey:agreeKey, sorted>|<code>`. A device stores the peer as trusted only when its own human confirmed **and** a confirmation that verifies against the peer's key arrived. Pairing fails if the material's device id is not the id of the link it arrived on, if `verifyPeerPairing` rejects it, if the material changes mid-session, or if a confirmation does not verify. A new peer starts at the `trusted` disclosure level.

Known gap: if the last `pair_confirm` is lost, one side trusts and the other does not. Nothing retransmits it; the people have to pair again.

## Lifecycle

- Foreground only for the first demonstration. Discovery and connections are not expected to work while the app is suspended.
- On background: stop discovery, close connections, keep the outbox.
- On foreground: restart discovery, reconnect, flush the outbox.

## Error states surfaced to the UI

No peer, permission denied, peer not trusted, expired credentials, packet too large, failed decryption, duplicate, out-of-order update, lost connection.

## Test evidence

| Item | Status | Evidence |
| --- | --- | --- |
| Wire format, strict validation, size cap | UNIT-TESTED | `src/sync/__tests__/packet.test.ts` |
| Section and tier split per level | UNIT-TESTED | `src/crypto/__tests__/capsule.test.ts` |
| Queued without a peer; delivered only after a receipt | UNIT-TESTED (in-memory transport, simulated crypto) | `src/services/__tests__/delivery.test.ts` |
| Reconnect flush, duplicate suppression, duplicate re-receipted, reordering | UNIT-TESTED (same) | `src/services/__tests__/delivery.test.ts` |
| Three-device relay, relay holds no plaintext, hop limit, relay switched off | UNIT-TESTED (same) | `src/services/__tests__/relay.test.ts` |
| Tampered, re-labelled, expired, oversized, untrusted-sender packets; forged receipt | UNIT-TESTED (same) | `src/services/__tests__/disclosure.test.ts` |
| Pairing handshake | UNIT-TESTED (same) | `src/services/__tests__/pairing.test.ts` |
| Synthetic packet A↔B between two iPhones, external internet disabled | NOT STARTED | — |
| Receipt observed on a real sender | NOT STARTED | — |
| Disconnect and reconnect flush on devices | NOT STARTED | — |
| Three-phone relay | NOT STARTED | — |
