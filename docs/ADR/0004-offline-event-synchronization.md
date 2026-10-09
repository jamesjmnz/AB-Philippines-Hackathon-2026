# ADR 0004 — Offline event synchronization

- Date: 2026-10-09
- Status: **Accepted, implementation pending**
- Phase: P2 (ledger), P5 and P7 (sync between devices)

## Context

Several phones contribute to one incident while intermittently connected and with no server. Packets may arrive late, twice or out of order. Device clocks drift. People make conflicting statements, and the product must keep all of them rather than pick a winner. The master specification requires a local append-only ledger with idempotent application, duplicate suppression, deterministic replay and conflict preservation, and forbids resolving conflicts by trusting cross-device timestamps.

## Decision

1. Each device keeps an append-only event ledger in SQLite. Events are never edited or deleted in place.
2. Every event has a globally unique ID, the incident ID, the authoring device's public identifier, a per-device monotonic sequence number, a wall-clock timestamp, a causal parent or version reference, a type from the 20-event vocabulary, a typed validated payload, and signature metadata.
3. All displayed state is derived by pure reducers folding the ledger. No separately stored status.
4. Applying an event is idempotent, keyed by event ID.
5. Ordering across devices uses per-device sequence and causal parents. Wall-clock time is for display only.
6. An event whose causal parent is missing is stored and applied when the parent arrives.
7. Concurrent claims about the same field are both kept and surfaced as a contradiction. Only an explicit event from an authorized human resolves it.
8. Sync is the exchange of signed events inside capsules. A per-peer `SyncCursor` tracks what each peer is known to hold.
9. Outbound work is an outbox row written in the same transaction as the event that caused it. A row is cleared only by a verified receipt, expiry or cancellation. An inbox records received packet IDs for duplicate suppression.

## Consequences

- Devices that receive the same set of events derive the same state regardless of arrival order.
- History is complete and auditable; corrections add entries.
- Storage grows with every event. No compaction is planned for the prototype.
- Deleting data requires a deliberate design, since the ledger is append-only and copies exist on other devices (open question).
- Reducers must be total over partial histories, because a device may hold only some events of an incident.
- No server means no global order and no guarantee that all devices ever converge if they never reconnect.
- The exact causal-reference representation and cursor format are to be fixed in Phase 2.

## Verification

Not yet verified. Evidence required: Jest output for replay, replay after restart, duplicate and out-of-order application, and conflict preservation (gate G2); then observed convergence between two physical phones (gate G7). See [DOMAIN_MODEL.md](../DOMAIN_MODEL.md).
