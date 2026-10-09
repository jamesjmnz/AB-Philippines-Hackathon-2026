# Network protocol

Status: **planned design**. No transport code exists and no packet has been exchanged between devices (2026-10-09). Items marked "proposed" are not frozen and will be settled in Phase 5.

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

```
PeerTransport:
  requestPermissions(), startDiscovery(), stopDiscovery(), connectTrustedPeer(),
  sendOpaquePacket(), onOpaquePacket(), onConnectionState(), stop()
```

The native module will emit typed events to JavaScript. Every event is validated with Zod before use.

## Discovery and identity

- Bonjour advertises that a PULSE device is nearby. An advertised name is not an identity.
- A discovered peer is treated as trusted only after its key has been matched to a paired `TrustedPeer` (see [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md)).
- Proposed: the advertisement carries no personal name and no incident data.

## Framing

Planned: each message is a length prefix followed by opaque bytes. Proposed details, not frozen: prefix width, maximum frame size, and the "packet too large" error returned above that size.

The transport does not parse the payload. The payload is a signed, encrypted envelope defined in [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md).

## Three different acknowledgments

These must never be conflated.

| Level | What it is | What it proves | Event |
| --- | --- | --- | --- |
| Transport ack | The Network framework send completion. | Bytes were handed to the connection. Nothing more. | `PACKET_SENT_ATTEMPT` |
| App-level receipt | A signed receipt created by the receiving device **after** it validated and persisted the packet. | The recipient device has the packet durably. | `PACKET_RECEIVED_BY_PEER` |
| Human acknowledgment | A responder tapped acknowledge. | A person saw it. | `RESPONDER_ACKNOWLEDGED` |

"Delivered" in the UI is driven only by a verified app-level receipt.

## Receive path (planned)

1. Read a frame.
2. Decode the envelope; reject unknown versions.
3. Verify the signature against a trusted peer key.
4. Check expiry, hop limit and replay (packet ID already seen).
5. Persist to the inbox in one transaction.
6. Send the signed receipt.
7. If addressed to this device and authorized, decrypt and apply events.

A duplicate packet is not applied twice. Proposed: a duplicate still gets a receipt, because the earlier receipt may have been lost.

## Send path, retries and reconnect

- Every outbound packet is an outbox row before any send is attempted.
- A row leaves the pending set only on a verified receipt, on expiry, or on explicit cancellation.
- Proposed: retries use backoff while a peer is connected, and the outbox is flushed when a trusted peer reconnects.
- Retried packets keep the same packet ID so the receiver can deduplicate.
- On disconnect, nothing is lost: the outbox row remains.

## Relay (store-and-forward)

Relay is an explicit application mechanism. The transport API does not provide it.

- A relay holds a packet it cannot decrypt and forwards it to a peer it can reach.
- Each forward decrements the hop limit in the envelope. A packet with no hops left is not forwarded.
- A relay deduplicates by packet ID and does not forward a packet back to the peer it came from.
- A relay sees routing metadata and ciphertext only.
- Receipts travel back along whatever path is available when the peers are reachable.

Multi-hop is claimed only if the three-phone test is run and recorded. Until then it is `NOT STARTED` and will be shown in the demo as simulated.

## Lifecycle

- Foreground only for the first demonstration. Discovery and connections are not expected to work while the app is suspended.
- On background: stop discovery, close connections, keep the outbox.
- On foreground: restart discovery, reconnect, flush the outbox.

## Error states surfaced to the UI

No peer, permission denied, peer not trusted, expired credentials, packet too large, failed decryption, duplicate, out-of-order update, lost connection.

## Test evidence

| Item | Status | Evidence |
| --- | --- | --- |
| Synthetic packet A↔B, external internet disabled | NOT STARTED | — |
| Receipt observed on sender | NOT STARTED | — |
| Disconnect and reconnect flush | NOT STARTED | — |
| Duplicate suppression | NOT STARTED | — |
| Three-phone relay | NOT STARTED | — |
