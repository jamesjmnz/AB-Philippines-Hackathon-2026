# Domain model

Status: **implemented and unit-tested in Phase 2** (2026-10-10). This document describes the code in `src/domain/` and `src/storage/`. Evidence is in [agent-handoffs/P2-domain.md](agent-handoffs/P2-domain.md). The Expo SQLite driver (`src/storage/expoDriver.ts`) typechecks but has not been run on a device.

`src/domain/` is pure TypeScript. It imports only `zod` and its own files; a test fails if any file imports React Native, Expo, AI, transport, crypto or storage code. Time and ids are injected (`Clock`, `IdGenerator`).

## Entities

Wire contracts are strict Zod schemas (unknown keys are rejected). Derived state is plain TypeScript interfaces produced by the reducer.

| Group | Zod contracts (validated) | Derived types (from replay) |
| --- | --- | --- |
| People and devices | `Actor`, `User`, `DeviceIdentity`, `TrustedPeer` | |
| Incident and evidence | `ClaimInput`, `AIFindingInput` | `Incident`, `OriginalReport`, `Claim`, `ClaimSource`, `ClaimRevision`, `AIFinding`, `ClarificationQuestion`, `Contradiction` |
| Coordination | `TaskKind` | `AssistanceTask`, `TaskStatus`, `RecipientState`, `PacketState` |
| Disclosure | `DisclosureLevel`, `DisclosurePolicy` | `IncidentProjection` |
| Ledger and sync | `DomainEvent`, `EventClock`, `EventSignature`, `EventBatch`, `OutboxMessage`, `InboxMessage`, `SyncCursor`, `PacketReceipt` | `IncidentState`, `LedgerMeta` |

Not defined in Phase 2 (they belong to later phases): `RescueCapsule`, `EncryptedPayload`, `PacketEnvelope`, `CapabilitiesByDevice`, `SafetyPreferences`. `TaskOffer`, `TaskAcceptance` and `Authorization` are not separate types: an offer and an acceptance are events, and authorization is the set of `can*` policy functions.

### Claims

Claim fields: `incidentType`, `building`, `floor`, `locationText`, `symptom`, `assistanceRequested`. `symptom` holds the person's own words. There is no severity, priority, triage or diagnosis field, and the schemas reject those keys.

- An `OriginalReport` is verbatim text and is never edited. A reporter's account has kind `report`; a statement from another participant has kind `observation`.
- A `ClaimRevision` is one statement about one field with a `ClaimSource` (actor, role, kind `report | observation | answer | ai_proposal`, event id), how it was extracted (`explicit | rule | ai`) and the evidence span when there is one. Revisions are only appended.
- A `Claim` is the field's full revision history plus the displayed value and tag, both derived.

Displayed value, highest rank first; within a rank the latest in replay order wins:

| Rank | Source | Tag |
| --- | --- | --- |
| 1 | Reporter's `CLAIM_CONFIRMED` or `CONFLICT_RESOLVED` | `user_confirmed` |
| 2 | Reporter's statement | `user_reported` |
| 3 | Another participant's statement | `responder_reported` |
| 4 | AI proposal | `ai_proposed` |
| | No statement | `unknown` (value `null`) |

While any contradiction on the field is open the tag is `unresolved`, the value is `null`, and `candidates` lists the competing values. An AI proposal can never outrank or replace a human claim; only the reporter's `CLAIM_CONFIRMED` promotes one.

### Contradictions

Two human statements with different values for a field are both kept. `CONFLICT_FLAGGED` (from the deterministic rule or from an AI proposal) opens a `Contradiction`; only human statements can be in one. Only the reporter's `CONFLICT_RESOLVED` closes it, and it adds a confirmation revision; nothing is removed. A responder can request clarification or leave it open. A plain `CLAIM_CONFIRMED` does not close a contradiction.

The rule (`detectFieldConflicts`) derives the conflict id from the two revision ids, so two devices that flag the same pair concurrently produce one contradiction.

## Event ledger

Append-only. `DomainEvent`:

| Field | Purpose |
| --- | --- |
| `id` | Globally unique; the idempotency key. |
| `incidentId` | The incident the event belongs to. |
| `type` | One of the vocabulary below. |
| `actor` | `{ deviceId, userName }`. The device id is the identity used for authorization; the name is for display. |
| `clock` | `{ seq, lamport, wallClockMs }`. `seq` is monotonic per authoring device (per incident by default). `lamport` is one more than the highest the author had seen. `wallClockMs` is display-only. |
| `parents` | Ids of the ledger heads the author had seen. Empty only for `INCIDENT_CREATED`. |
| `payload` | Strict, discriminated by `type`. |
| `signature` | Optional `{ alg, keyId, value }`. Filled and verified by the crypto layer in Phase 6. |

Replay order is `(lamport, deviceId, id)`. Wall-clock time is never consulted.

## Event vocabulary

The 20 events of the master specification, with these names:

| # | Event | Authored by | Effect |
| --- | --- | --- | --- |
| 1 | `INCIDENT_CREATED` | Reporter | Creates the incident, its recipients and one basic-alert packet per recipient. |
| 2 | `REPORT_ADDED` | Reporter (`report`) or any participant (`observation`) | Stores verbatim text and the claims stated in it. |
| 3 | `AI_PROPOSAL_CREATED` | A participant's device | Stores findings as `ai_proposal` revisions. No authority. |
| 4 | `CLARIFICATION_REQUESTED` | Any participant (origin `ai`, `rule` or `human`) | Opens a question for the reporter. |
| 5 | `CLAIM_CONFIRMED` | Reporter | Confirms a value, optionally answering a question or promoting a revision. |
| 6 | `CONFLICT_FLAGGED` | Any participant (detected by `rule` or `ai`) | Opens a contradiction between human statements. |
| 7 | `CONFLICT_RESOLVED` | Reporter | Closes a contradiction with a confirmed value. |
| 8 | `CAPSULE_PREPARED` | Reporter | Sets the disclosure policy. A later one replaces it. |
| 9 | `CAPSULE_QUEUED` | Reporter | Declares one capsule packet per recipient. |
| 10 | `PACKET_SENT_ATTEMPT` | Any participant (sender or relay) | Packet becomes `send_attempted`. Never a delivery. |
| 11 | `PACKET_RECEIVED_BY_PEER` | Any participant holding the receipt | Packet becomes `delivered`. Requires a receipt naming the packet and its recipient. |
| 12 | `RESPONDER_ACKNOWLEDGED` | A recipient | Marks that recipient as having acknowledged. |
| 13 | `TASK_OFFERED` | Any participant | Creates a task, or re-offers an open one. |
| 14 | `TASK_ACCEPTED` | The person accepting | Payload names the assignee, which must equal the actor. |
| 15 | `TASK_DECLINED` | A participant | Declines an open task, or releases a task the actor holds. |
| 16 | `TASK_PROGRESS_REPORTED` | Assignee | Task becomes `in_progress`; optional human note. |
| 17 | `TASK_COMPLETION_REPORTED` | Assignee | Task becomes `completion_reported`. |
| 18 | `TASK_COMPLETION_CONFIRMED` | Reporter | Task becomes `completion_confirmed`. |
| 19 | `INCIDENT_RESOLVED` | Reporter, or a responder holding an accepted task | Closes the incident. |
| 20 | `INCIDENT_CANCELLED` | Reporter | Closes the incident. |

Two additions:

| Event | Why it was needed |
| --- | --- |
| `CLARIFICATION_SKIPPED` | The reporter can decline a question. Without an event the question would stay open forever and the UI would keep asking. The field is left as it was, including unknown. |
| `RESPONDER_DECLINED` | A responder can say they cannot help with the whole request. `TASK_DECLINED` is per task and cannot express this. Roles only offered to that responder reopen. |

Not added: pairing, relay-forward and arrival events. A relay forwarding a packet is a `PACKET_SENT_ATTEMPT` with `viaDeviceId`. Changing a recipient's disclosure level is a new `CAPSULE_PREPARED`. Arrival is never inferred; `TASK_PROGRESS_REPORTED` carries a human note.

Task kinds are `communicate`, `go_to_requester`, `confirm_location`, `other`.

## State derivation

`replay(incidentId, events)` deduplicates by id, sorts into replay order, and folds the events into an `IncidentState`. There is no incremental mutation path and no stored status.

- **Idempotent.** A repeated event id is ignored.
- **Order-independent.** Any arrival order of the same set of events gives a deeply equal state.
- **Total over partial histories.** An event that cannot be applied yet (its task, revision, packet or the incident itself has not arrived) is kept in the ledger and listed in `state.notApplied` with a code. The next replay applies it if its context has arrived. `state.ledger.missingParents` lists parent ids not yet held.
- **Validated.** Every event, local or remote, passes the same authorization policy inside the reducer. An unauthorized event is listed in `notApplied` and has no effect.
- After `INCIDENT_RESOLVED` or `INCIDENT_CANCELLED`, later events are refused except `PACKET_SENT_ATTEMPT` and `PACKET_RECEIVED_BY_PEER`, which record transport facts.

### Delivery and human states

Per packet and per recipient, delivery is `none | queued | send_attempted | delivered`. `delivered` comes only from `PACKET_RECEIVED_BY_PEER`. Human acknowledgment (`recipient.acknowledged`), the request-level decline (`recipient.declined`) and task state are tracked separately; none implies another. Accepting a task does not acknowledge, and acknowledging does not deliver.

Only packets declared in `INCIDENT_CREATED` or `CAPSULE_QUEUED` have delivery state in the ledger.

### Incident status

`state.status` is `{ status, reason }`. Precedence, first match wins:

| Status | Evidence | Reason |
| --- | --- | --- |
| `cancelled` | `INCIDENT_CANCELLED` | `cancelled_by_reporter` |
| `resolved` | `INCIDENT_RESOLVED` | `resolved_by_authorized_person` |
| `in_progress` | A non-reporter holds an in-person task in `in_progress` | `in_person_task_in_progress` |
| `role_taken` | A non-reporter holds a task (`accepted` or later) | `task_accepted` |
| `acknowledged` | A recipient acknowledged | `acknowledged_by_responder` |
| `delivered` | A recipient has a delivered packet | `delivered_with_receipt` |
| `queued` | Nothing delivered | `no_trusted_peer` (no recipients), `send_attempted_no_receipt`, or `awaiting_peer` |

Differences from the design export's `st()`: a recipient who declined still counts toward `delivered` and `acknowledged`, and acknowledgment does not require a delivered packet.

### Task state machine

```
unassigned / offered  --TASK_ACCEPTED-->  accepted  --TASK_PROGRESS_REPORTED-->  in_progress
accepted / in_progress  --TASK_COMPLETION_REPORTED-->  completion_reported
completion_reported  --TASK_COMPLETION_CONFIRMED (reporter)-->  completion_confirmed
offered  --TASK_DECLINED by the offeree / RESPONDER_DECLINED-->  unassigned
accepted / in_progress  --TASK_DECLINED by the assignee-->  unassigned
unassigned / offered  --TASK_OFFERED (same task id)-->  offered or unassigned
```

When two devices accept the same task concurrently, the first in replay order holds it and the other is listed in `notApplied` with `task_not_open`.

## Authorization policy

`src/domain/policy.ts`: pure functions returning `{ ok: true } | { ok: false, code }`, used by the commands, the reducer and the UI. `canAddReport`, `canRecordAIProposal`, `canRequestClarification`, `canSkipClarification`, `canConfirmClaim`, `canFlagConflict`, `canResolveConflict`, `canPrepareCapsule`, `canQueueCapsule`, `canRecordTransport`, `canAcknowledge`, `canDeclineRequest`, `canOfferTask`, `canAcceptTask`, `canDeclineTask`, `canReportProgress`, `canReportCompletion`, `canConfirmCompletion`, `canResolveIncident`, `canCancelIncident`.

A participant is the reporter or a listed recipient.

## Disclosure

Levels: `relay`, `trusted`, `authorized`, plus `owner` for the reporter. `canReadItem(level, item, policy)` is the access matrix:

| Item | relay | trusted | authorized |
| --- | --- | --- | --- |
| `incidentType`, `building`, `assistanceRequested` | no | yes | yes |
| `floor`, `locationText` | no | if `shareDetailedLocation` | if `shareDetailedLocation` |
| `symptom`, original report text | no | no | if `shareSymptoms` |

`projectForLevel(state, level, policy)` returns only what the level may read. Restricted fields are absent from the result, not blanked. The relay projection is routing metadata only (incident id, reporter device id, recipient device ids). Projections below `owner` never contain revision history, evidence spans, AI findings or events.

Before any capsule is prepared both share switches are off. A device not listed in the policy is a relay.

## Deterministic rules

`src/domain/rules/`:

- `extractFloor` / `extractFloors`: English ("ground floor", "second floor", "2nd floor", "floor 4", "5/F") and Tagalog ("unang palapag", "ikalawang palapag", "ikatlong palapag", "ika-6 na palapag"), returning the canonical label, the level and the exact span. Ground and first are distinct. A text naming two different floors yields no floor. A directly negated mention is skipped.
- `extractBuilding`: "Building B", "bldg 4", "gusali 3", with the span.
- `detectFieldConflicts`: explicit-field conflict detection with no model.

## Commands

`src/domain/commands/`. Each takes the current state and a `CommandContext` (`actor`, `clock`, `ids`), validates through the reducer, and returns `{ events, outbox, state }`. A refused intent throws `DomainError` with a stable `code`.

`createManualSOS`, `addReport`, `addObservation`, `recordAIProposal`, `requestClarification`, `skipClarification`, `confirmClaim`, `flagConflict`, `flagDetectedConflicts`, `resolveConflict`, `acknowledge`, `declineRequest`, `offerTask`, `acceptTask`, `declineTask`, `reportProgress`, `reportCompletion`, `confirmCompletion`, `prepareCapsule`, `queueCapsule`, `recordSendAttempt`, `recordPeerReceipt`, `resolveIncident`, `cancelIncident`.

### `createManualSOS`

Needs the reporter's identity, a recipient list (may be empty) and the injected clock and id generator. Returns `INCIDENT_CREATED` and one pending outbox row per recipient. `IncidentRepository.commit` writes them in one transaction. It imports only domain files. With no recipients the incident persists with status `queued`, reason `no_trusted_peer`.

## Sync

`EventBatch` is `{ version: 1, incidentId, fromDeviceId, events: unknown[] }`. `mergeRemoteEvents(localEvents, batch, { verifySignature? })` returns `{ applied, duplicates, rejected, toStore, state }`:

- Events failing the schema, naming another incident, or failing the supplied signature check are rejected and never enter the ledger. The repository writes them to the quarantine table.
- Well-formed events the reducer refuses are reported as rejected with stage `policy`. They are stored in the ledger so every device replays the same set, and they are never applied.

`SyncCursor` is a version vector: `seqByDevice[d] = n` means the peer holds every event of the incident authored by `d` with `seq <= n`. `advanceCursor` moves only across gap-free runs.

## Repository

`IncidentRepository` (`src/storage/incidentRepository.ts`), all async:

```
appendEvents, commit, ingestRemote, eventsForIncident, allIncidentIds, replay, transaction,
enqueue, getPendingOutbox, markSendAttempt, acknowledgeReceipt, retryDue, cancelPendingOutbox,
recordInbound, getSyncCursor, setSyncCursor, quarantined, reset
```

- One repository implementation runs over a `LedgerStore`. There are two stores: SQLite (`createSqliteIncidentRepository(driver)`) and in-memory for the Demo bundle (`createMemoryIncidentRepository()`). Both pass the same contract tests.
- The SQLite store talks to a small `SqlDriver` (`exec`, `run`, `all`, `transaction`). `src/storage/expoDriver.ts` implements it over `expo-sqlite`; `src/storage/testing/betterSqliteDriver.ts` implements it over `better-sqlite3` for Jest only.
- Tables: `schema_migrations`, `events`, `quarantine`, `outbox`, `inbox`, `sync_cursors`. `events` is insert-only: inserts are `INSERT OR IGNORE` by id and triggers abort `UPDATE` and `DELETE`. There is no status column.
- `appendEvents` for local events validates schema and reducer acceptance and throws `DomainError` without writing anything if one event is refused.
- Outbox rows are insert-or-ignore by packet id. `markSendAttempt` keeps the row pending and schedules the next retry at 2 s, 4 s, 8 s, 16 s, 32 s, then 60 s. A row leaves the pending set only through `acknowledgeReceipt`, expiry (in `retryDue`) or `cancelPendingOutbox`.
- `recordInbound(packetId)` returns `'new'` once and `'duplicate'` after.
- `reset()` drops and recreates every table.

## Invariants

| # | Invariant | Phase 2 coverage |
| --- | --- | --- |
| 1 | Manual SOS persists without AI. | `sos.test.ts`, repository contract |
| 2 | Never infer a diagnosis, injury severity, emergency priority or required medical action. | `schema.test.ts` (no field exists; schemas reject the keys) |
| 3 | AI proposals never mutate confirmed human claims without human approval. | `claims.test.ts` |
| 4 | Unknown is not false and is not invented; a contradiction is not automatically resolved. | `claims.test.ts`, `rules.test.ts` |
| 5 | A responder cannot accept a task on behalf of a different person. | `tasks.test.ts`, `sync.test.ts` |
| 6 | A relay-only node cannot decrypt restricted content. | Access projection only (`projection.test.ts`). Encryption is Phase 6. |
| 7 | Delivery requires a verified recipient receipt; queued or attempted is not delivered. | `delivery.test.ts`. Receipt signature verification is Phase 6. |
| 8 | Packet state recovers without duplicates on reconnection and tolerates out-of-order and duplicate receipt. | `replay.test.ts`, `sync.test.ts`, repository contract, `sqliteRepository.test.ts` |
| 9 | All domain mutations and privacy decisions are validated locally in deterministic code. | Reducer validates every event; `authorization.test.ts`, `projection.test.ts` |
| 10 | Resolution requires an explicit authorized human event. | `authorization.test.ts` |
| 11 | The app does not disclose personal incidents through debug logs, crashes or analytics. | Domain and storage contain no logging and error messages carry codes only. Not otherwise tested here. |
| 12 | Safety-critical communication works when the local AI model refuses an input, is missing, or errors. | The SOS path has no AI dependency (`sos.test.ts`). End-to-end coverage is Phase 4. |

See [ADR/0004](ADR/0004-offline-event-synchronization.md) for synchronization.
