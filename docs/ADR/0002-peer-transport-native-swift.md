# ADR 0002 — Peer transport is a native Swift module on Network framework

- Date: 2026-10-09
- Status: **Accepted, implementation pending**
- Phase: P5

## Context

Rescue Capsules must move between nearby iPhones with no internet connection. The Callstack AI package does not provide device-to-device networking, so this is a genuine native gap. The master specification directs the use of Apple's Network framework with Bonjour discovery, in a minimal Expo module, proven first in the foreground on two physical iPhones.

Constraints:

- iOS only; three physical test phones.
- Discovery and connections cannot be relied on while the app is suspended.
- iOS requires a Local Network usage description and a declared Bonjour service type.
- The transport's own send completion is not proof that the peer stored anything.
- Multi-hop relay is not something the platform API provides.

## Decision

1. Build `modules/pulse-peer` as an Expo module in Swift.
2. Use `NWListener` and `NWBrowser` over Bonjour service type `_sagip-sos._tcp`, with `includePeerToPeer` enabled.
3. The module transports length-framed opaque bytes and emits typed connection and packet events. It contains no domain, crypto or policy logic.
4. Declare `NSLocalNetworkUsageDescription` and `NSBonjourServices` through `app.config.ts`.
5. Foreground only.
6. Delivery is established by an application-level signed receipt sent after the receiver validated and persisted the packet, never by the send callback.
7. Relay is an explicit application-level store-and-forward mechanism in TypeScript, with a hop limit and deduplication.
8. Expose the module to the app through the `PeerTransport` interface so a simulated transport can replace it in Demo Lab and in tests.

## Consequences

- A small amount of Swift must be written and maintained, and it can only be verified on physical devices.
- Keeping the module payload-agnostic means all security properties come from the envelope, not the link.
- Foreground-only operation limits real-world usefulness and is stated as a limitation.
- Which radio path is used without infrastructure Wi-Fi is not known in advance and must be observed.
- If Network framework proves unsuitable on the target devices, an alternative native API would need a superseding ADR.

## Verification

Not yet verified. Evidence required: a synthetic packet and its receipt exchanged between two physical iPhones with external internet disabled, plus disconnect/reconnect and duplicate handling observed (gate G5). Three-phone relay is verified separately. See [NETWORK_PROTOCOL.md](../NETWORK_PROTOCOL.md).
