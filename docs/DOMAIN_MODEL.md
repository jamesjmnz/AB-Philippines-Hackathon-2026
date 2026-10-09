# Domain model

Status: **planned contract**. No Zod schema, reducer or migration exists yet (2026-10-09). Exact field names and shapes will be frozen in Phase 2; this document will then be updated to match the code in `src/domain/`.

## Entities

All contracts will be strict Zod schemas with discriminated unions, under `src/domain/`.

| Group | Entities |
| --- | --- |
| People and devices | `User`, `DeviceIdentity`, `TrustedPeer`, `CapabilitiesByDevice`, `SafetyPreferences` |
| Incident and evidence | `Incident`, `OriginalReport`, `Claim`, `ClaimSource`, `ClaimRevision`, `AIFinding`, `ClarificationQuestion`, `Contradiction` |
| Coordination | `AssistanceTask`, `TaskOffer`, `TaskAcceptance`, `TaskStatus`, `Authorization` |
| Capsule | `RescueCapsule`, `DisclosurePolicy`, `EncryptedPayload`, `PacketEnvelope`, `PacketReceipt` |
| Ledger and sync | `DomainEvent`, `EventOrigin`, `EventSignature`, `EventClock`, `OutboxMessage`, `InboxMessage`, `SyncCursor` |

Key ideas:

- An `OriginalReport` is the person's own words and is never edited.
- A `Claim` is one statement about one field (for example floor) with a `ClaimSource` (who said it, on which device, when). A later statement creates a new `ClaimRevision`; the earlier one stays.
- An `AIFinding` is a proposal. It carries the evidence span it was derived from and has no authority.
- A `Contradiction` links claims that disagree. It is open until an authorized human resolves it.
- There is no medical severity, diagnosis or priority field anywhere in the model.

### Provenance tags

Each displayed field carries one tag: `user reported`, `AI proposed`, `user confirmed`, `responder reported`, `unresolved`.

## Event ledger

Local, append-only. Events are never updated or deleted in place.

| Field | Purpose |
| --- | --- |
| Event ID | Globally unique; the idempotency key. |
| Incident ID | The incident the event belongs to. |
| Actor / device public identifier | Who authored it, by device key identifier. |
| Local sequence | Monotonic per-device ordering. |
| Wall-clock timestamp | For display only. |
| Causal parent / version reference | The event(s) this one was written after. |
| Type | One of the vocabulary below. |
| Payload | Typed and validated per event type. |
| Signature metadata | Signature over the event by the authoring device. |

Wall clocks drift between devices. Ordering across devices will use per-device sequence and causal parents; cross-device timestamps are never assumed to be correctly ordered.

## Event vocabulary (20 events)

| # | Event | Meaning | Authored by |
| --- | --- | --- | --- |
| 1 | `INCIDENT_CREATED` | Manual SOS persisted. | Reporter (human) |
| 2 | `REPORT_ADDED` | Verbatim typed or transcribed report attached. | Human |
| 3 | `AI_PROPOSAL_CREATED` | Local AI produced a proposal. | Device (AI) |
| 4 | `CLARIFICATION_REQUESTED` | One optional question was put to a human. | Device (AI) or human |
| 5 | `CLAIM_CONFIRMED` | A human confirmed a claim or answered a clarification. | Human |
| 6 | `CONFLICT_FLAGGED` | Two claims disagree. | Rules engine or AI proposal |
| 7 | `CONFLICT_RESOLVED` | An authorized human chose the resolution. | Authorized human |
| 8 | `CAPSULE_PREPARED` | Recipients and disclosure reviewed; capsule encrypted. | Reporter device |
| 9 | `CAPSULE_QUEUED` | Capsule placed in the outbox. | Reporter device |
| 10 | `PACKET_SENT_ATTEMPT` | Transport was asked to send. Not a delivery. | Sending device |
| 11 | `PACKET_RECEIVED_BY_PEER` | A verified receipt arrived from the recipient device. | Recorded by sender on verified receipt |
| 12 | `RESPONDER_ACKNOWLEDGED` | A responder tapped acknowledge. | Responder (human) |
| 13 | `TASK_OFFERED` | A specific non-medical task was offered. | Human |
| 14 | `TASK_ACCEPTED` | A person accepted a task for themselves. | Accepting human |
| 15 | `TASK_DECLINED` | A person declined. | Human |
| 16 | `TASK_PROGRESS_REPORTED` | The assignee reported progress. | Assignee |
| 17 | `TASK_COMPLETION_REPORTED` | The assignee reported completion. | Assignee |
| 18 | `TASK_COMPLETION_CONFIRMED` | An authorized human confirmed completion. | Authorized human |
| 19 | `INCIDENT_RESOLVED` | Explicit resolution. | Authorized human |
| 20 | `INCIDENT_CANCELLED` | Explicit cancellation. | Authorized human |

This is the minimum vocabulary from the master specification. Additions (for example pairing or relay-forward events) are open questions in [DECISIONS.md](DECISIONS.md).

## Invariants

These twelve are mandatory. Each will have at least one test in Phase 2 or the phase that owns it.

| # | Invariant |
| --- | --- |
| 1 | Manual SOS persists without AI. |
| 2 | Never infer a diagnosis, injury severity, emergency priority or required medical action. |
| 3 | AI proposals never mutate confirmed human claims without human approval. |
| 4 | Unknown is not false and is not invented; a contradiction is not automatically resolved. |
| 5 | A responder cannot accept a task on behalf of a different person. |
| 6 | A relay-only node cannot decrypt restricted content. |
| 7 | Delivery requires a verified recipient receipt; queued or attempted is not delivered. |
| 8 | Packet state recovers without duplicates on reconnection and tolerates out-of-order and duplicate receipt. |
| 9 | All domain mutations and privacy decisions are validated locally in deterministic code, not delegated to an LLM tool call. |
| 10 | Resolution requires an explicit authorized human event. |
| 11 | The app does not disclose personal incidents through debug logs, crashes or analytics. |
| 12 | Safety-critical communication works when the local AI model refuses an input, is missing, or errors. |

## State derivation

Planned: all displayed state is computed by pure reducers from the ledger. There is no separately stored "current status" that could disagree with the events.

- **Replay.** Folding the events of an incident, in causal order, always yields the same state. Replay after an app restart yields the same state as before the restart.
- **Idempotent apply.** Applying an event whose ID is already in the ledger is a no-op.
- **Out-of-order tolerance.** An event whose causal parent has not arrived is stored and applied when the parent arrives.
- **Conflict preservation.** Concurrent claims about the same field are both kept and surfaced as a contradiction.

Derived incident delivery state (planned mapping):

| Derived state | Required evidence |
| --- | --- |
| Saved and queued | `INCIDENT_CREATED` and an outbox row |
| Sending | `PACKET_SENT_ATTEMPT` with no receipt |
| Delivered | `PACKET_RECEIVED_BY_PEER` from a verified receipt |
| Acknowledged | `RESPONDER_ACKNOWLEDGED` |
| Accepted | `TASK_ACCEPTED` |
| Arrival / progress reported | `TASK_PROGRESS_REPORTED` |
| Completion reported | `TASK_COMPLETION_REPORTED` |
| Completion confirmed | `TASK_COMPLETION_CONFIRMED` |
| Resolved / Cancelled | `INCIDENT_RESOLVED` / `INCIDENT_CANCELLED` |

Task state machine (planned): `unassigned → offered → accepted → in progress → completion reported → completion confirmed`, with `declined` available from `offered`. Only the accepting person can create `TASK_ACCEPTED` for themselves; only the assignee can report progress or completion.

The status derivation, task state machine and visibility matrix in the design export's script are the behavioural reference for the reducers. They are a reference, not code to copy.

## `createManualSOS`

Planned contract: one SQLite transaction writes `INCIDENT_CREATED` and the outbox row. It calls no AI, transport, crypto or permission API. If it returns, the SOS is durable.

## Repository interface

```
IncidentRepository:
  appendEvent(), eventsForIncident(), replay(), transaction(),
  enqueue(), acknowledgeReceipt(), getPendingOutbox(), retryDue()
```

See [ADR/0004](ADR/0004-offline-event-synchronization.md) for synchronization.
