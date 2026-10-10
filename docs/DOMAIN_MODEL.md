# Domain model

Status: **implemented and unit-tested in Phase 2** (2026-10-10). This document describes the code in `src/domain/` and `src/storage/`. Evidence is in [agent-handoffs/P2-domain.md](agent-handoffs/P2-domain.md). The Expo SQLite driver (`src/storage/expoDriver.ts`) typechecks but has not been run on a device.

`src/domain/` is pure TypeScript. It imports only `zod` and its own files; a test fails if any file imports React Native, Expo, AI, transport, crypto or storage code. Time and ids are injected (`Clock`, `IdGenerator`).

## Entities

Wire contracts are strict Zod schemas (unknown keys are rejected). Derived state is plain TypeScript interfaces produced by the reducer.

| Group | Zod contracts (validated) | Derived types (from replay) |
| --- | --- | --- |
| People and devices | `Actor`, `User`, `DeviceIdentity`, `TrustedPeer` | |
| Incident and evidence | `ClaimInput`, `AIFindingInput`, `AssessmentItemInput` | `Incident`, `OriginalReport`, `Claim`, `ClaimSource`, `ClaimRevision`, `AIFinding`, `StatementAssessment`, `ClarificationQuestion`, `Contradiction` |
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

What the rule compares, per field:

- The statement leading the field (the latest reporter confirmation, otherwise the reporter's latest statement, otherwise the latest statement) against each other author's latest statement since the last confirmation. Statements made before a confirmation were settled by it.
- Only an author's latest statement counts. An earlier one was superseded by its own author, so a different value from the same person is a correction, not a contradiction.
- A statement that differs from a reporter-confirmed value is always compared and flagged, including the reporter's own later statement. A confirmed value never changes silently.
- An explicit move explains an older agreement. When an author said they moved ("I moved from the first floor to the second floor"), another author's plain statement made before that move is not a conflict if it names a floor the mover had stated before the move or the floor the move says they left. It stays explained through the mover's later moves and self-corrections. A statement made after the mover's last move, a floor the mover never stated or left, and anything differing from a confirmed value are still flagged. Floors only.
- One contradiction is recorded per disagreeing value: a statement or a value already in a contradiction is not flagged again.
- The requester's first report is the anchor of the incident. A responder who has not received it writes with a logical clock that can tie with or fall below the report's, so the observation can replay before it. For comparison (`comparisonOrder`) the anchor's revisions are placed ahead of every other statement that replays before them, so "earlier" and "later" in the rules above are read against the anchor first. They are never moved across a reporter confirmation, a second report by the requester is not an anchor, and with no report yet the order is replay order. Replay order itself, and the reducer, are unchanged.

The rule only proposes. It never closes, withdraws or rewrites a recorded contradiction, and the reducer applies a recorded `CONFLICT_FLAGGED` without consulting the rule, so events recorded under an earlier version of the rule replay unchanged.

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

23 events: the 20 of the master specification, with these names, and three additions listed below.

| # | Event | Authored by | Effect |
| --- | --- | --- | --- |
| 1 | `INCIDENT_CREATED` | Reporter | Creates the incident, its recipients and one basic-alert packet per recipient. |
| 2 | `REPORT_ADDED` | Reporter (`report`) or any participant (`observation`) | Stores verbatim text and the claims stated in it. |
| 3 | `AI_PROPOSAL_CREATED` | Reporter's device | Stores findings as `ai_proposal` revisions. No authority. From any other device it is stored and not applied (`not_reporter`). |
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

Three additions:

| Event | Why it was needed |
| --- | --- |
| `CLARIFICATION_SKIPPED` | The reporter can decline a question. Without an event the question would stay open forever and the UI would keep asking. The field is left as it was, including unknown. |
| `RESPONDER_DECLINED` | A responder can say they cannot help with the whole request. `TASK_DECLINED` is per task and cannot express this. Roles only offered to that responder reopen. |
| `STATEMENT_ASSESSED` | The on-device model's verdict on how one statement relates to earlier evidence ([ADR/0005](ADR/0005-incident-delta-intelligence.md)). Authored only by the reporter's device, which runs the analysis, while the incident is open; from any other device it is stored and not applied (`not_reporter`), so a paired device can neither replace what the owner sees nor occupy the owner's assessment id. It is a proposal: the reducer stores it in `state.assessments` and changes no claim, no contradiction and no status. |

`STATEMENT_ASSESSED` carries ids, classes and spans only, with no value and no free text: `assessmentId`, `reportId`, `provider`, `overall` (one of `new_information`, `confirmation`, `correction`, `possible_contradiction`, `unrelated`, `no_meaningful_change`) and up to six `items`, at most one per field, each `{ field, class, againstRevisionId?, evidence? }`. A field class is never `unrelated`. An assessment that assessed nothing is not recorded.

- The id is `assessmentIdFor(reportId, promptVersion)`, so assessing the same statement again with the same prompt records nothing new: the first in replay order is kept and a repeat is listed in `notApplied` with `duplicate_entity`. The id is `assess:<reportId>:<promptVersion>` when that fits in 128 characters and the report id contains no `:`; otherwise it is `assess~<start of reportId>~<16 hex digits>`, where the digits are a deterministic hash of both parts, so two prompt versions of a long report id do not share an id.
- The statement must be in the ledger (`unknown_report` otherwise, and the event is applied by a later replay once the statement arrives). `againstRevisionId`, when given, must be a human revision of that field (`unknown_revision`).
- An evidence span is checked against the stored statement text and kept with `evidenceVerified` true or false; it is never a reason to refuse the event.
- It is never part of a projection sent to a recipient, and in a capsule the event is in the restricted tier, the same as `AI_PROPOSAL_CREATED`.

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

`src/domain/policy.ts`: pure functions returning `{ ok: true } | { ok: false, code }`, used by the commands, the reducer and the UI. `canAddReport`, `canRecordAIProposal`, `canRecordAssessment`, `canRequestClarification`, `canSkipClarification`, `canConfirmClaim`, `canFlagConflict`, `canResolveConflict`, `canPrepareCapsule`, `canQueueCapsule`, `canRecordTransport`, `canAcknowledge`, `canDeclineRequest`, `canOfferTask`, `canAcceptTask`, `canDeclineTask`, `canReportProgress`, `canReportCompletion`, `canConfirmCompletion`, `canResolveIncident`, `canCancelIncident`.

A participant is the reporter or a listed recipient.

## Disclosure

Levels: `relay`, `trusted`, `authorized`, plus `owner` for the reporter. `canReadItem(level, item, policy)` is the access matrix:

| Item | relay | trusted | authorized |
| --- | --- | --- | --- |
| `incidentType`, `building`, `assistanceRequested` | no | yes | yes |
| `floor`, `locationText` | no | if `shareDetailedLocation` | if `shareDetailedLocation` |
| `symptom`, original report text | no | no | if `shareSymptoms` |

`projectForLevel(state, level, policy)` returns only what the level may read. Restricted fields are absent from the result, not blanked. The relay projection is routing metadata only (incident id, reporter device id, recipient device ids). Projections below `owner` never contain revision history, evidence spans, AI findings, model assessments or events.

Before any capsule is prepared both share switches are off. A device not listed in the policy is a relay.

## Deterministic rules

`src/domain/rules/`:

- `extractFloor` / `extractFloors`: English ("ground floor", "second floor", "2nd floor", "floor 4", "5/F") and Tagalog ("unang palapag", "ikalawang palapag", "ikatlong palapag", "ika-6 na palapag"), returning the canonical label, the level and the exact span. Ground and first are distinct. A text naming two different floors yields no floor. A directly negated mention is skipped.
- `extractFloorTransition`: the floor the author says they moved from and the floor they say they are on now, or null. A wrong floor is worse than no floor, so it is a whitelist: exactly two mentions on different levels, in a first-person construction with a completed movement ("I moved from the first floor to the second floor", "I was on the first floor, now I'm on the second floor", "lumipat ako mula first floor papunta sa second floor", "galing ako sa 1st floor, nasa 2nd floor na ako"). Another subject, an object, reported speech, a question, an intention or attempt ("I'm going from ... to ..."), a negation and a reversal afterwards all return null.
- `extractStatedFloor` / `extractStatedBuilding`: what a report (the requester's own statement) is taken to state: the destination of a transition, otherwise the single floor or building left once mentions that are not where the writer is have been set aside (`isNotWriterLocation`). A mention is set aside when its own clause is a question ("Is this the 3rd floor?"), names a place the writer left with no destination ("I left the 3rd floor already", "galing ako sa 3rd floor"), is somewhere to go or not to go ("do not come to the 3rd floor", "huwag kayong pumunta sa 3rd floor"), or has a subject other than the writer: a hazard, another person or a name ("The fire is on the 3rd floor", "My son is on the 3rd floor", "nasa 3rd floor ang apoy"). First-person mentions and bare mentions with no subject still count, and when a text has both kinds the valid one is used ("My son is on the 3rd floor, I am on the 2nd floor" gives Second floor).
- `extractObservedFloor` / `extractObservedBuilding`: what an observation (a responder's statement) is taken to state about the requester. A mention governed by the responder's own first person (`isFirstPersonLocation`: "I'm on the first floor, coming up to you", "nasa 1st floor na ako", "andito ako sa Building A") describes the responder and yields no claim, and so does a first-person move. A mention in a clause about somebody else still counts in the same message ("I'm on the first floor, they are on the second floor" gives Second floor; "I found them on the third floor" gives Third floor). A question and a hazard as the subject yield nothing.
- `extractBuilding`: "Building B", "bldg 4", "gusali 3", with the span. There is no movement rule for buildings. `extractFloor` and `extractBuilding` are the plain extractors; the commands use the `Stated` and `Observed` forms above.
- `detectFieldConflicts`: explicit-field conflict detection with no model. See Contradictions above.
- `classifyStatementDelta(state, reportId)`: how one stored statement relates to what was known before it, with no model. Read-only: it writes no event and changes nothing. For each claim revision the statement produced it gives a class and a reason:

  | Class | Reason | When |
  | --- | --- | --- |
  | `new_information` | `first_value` | No earlier human value for the field. |
  | `new_information` | `moved` | The author's first value for the field, an explicit move away from the floor somebody else had stated. |
  | `confirmation` | `second_source` | Same value as an earlier statement by somebody else. |
  | `no_meaningful_change` | `restated` | Same value as the author's own earlier statement. |
  | `correction` | `moved` | Different from the author's own earlier value, and the statement is an explicit move from that value. |
  | `correction` | `self_correction` | Different from the author's own earlier value otherwise. |
  | `possible_contradiction` | `differs_from_other` | Different from somebody else's statement, and no move explains it. |
  | `possible_contradiction` | `differs_from_confirmed` | Different from a reporter-confirmed value, whoever says it. |

  The statement's overall class is the highest of its fields: `possible_contradiction`, `correction`, `new_information`, `confirmation`, `no_meaningful_change`. A statement that produced no revision is `no_meaningful_change` when its words exactly repeat an earlier statement by the same author (case, spacing and punctuation aside), otherwise `not_assessed`. The rules never return `unrelated`; only a model assessment can. `needsVerification` is read from the incident as it stands: it is true while the revision is in an open contradiction or the conflict rule currently finds it in disagreement, and it clears when the reporter resolves. The incident-creation revisions and AI proposals are neither classified nor compared against. Comparison uses `comparisonOrder`: an observation that replays before the requester's first report is still classified against it, and that first report is compared with nothing except a confirmation the reporter had already given, so it is never the statement that "differs" from a responder.

## Commands

`src/domain/commands/`. Each takes the current state and a `CommandContext` (`actor`, `clock`, `ids`), validates through the reducer, and returns `{ events, outbox, state }`. A refused intent throws `DomainError` with a stable `code`.

`createManualSOS`, `addReport`, `addObservation`, `recordAIProposal`, `recordAssessment`, `requestClarification`, `skipClarification`, `confirmClaim`, `flagConflict`, `flagDetectedConflicts`, `resolveConflict`, `acknowledge`, `declineRequest`, `offerTask`, `acceptTask`, `declineTask`, `reportProgress`, `reportCompletion`, `confirmCompletion`, `prepareCapsule`, `queueCapsule`, `recordSendAttempt`, `recordPeerReceipt`, `resolveIncident`, `cancelIncident`.

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
