# Handoff: CareChain domain engine and persistence

- Agent: pulse-domain-engineer
- Phase: P2
- Date: 2026-10-10
- Outcome: complete for the domain and the Jest-tested storage; the Expo SQLite driver is written and typechecked but not run on a device

## Changed files

Only `src/domain/**`, `src/storage/**`, `docs/DOMAIN_MODEL.md` and this file. Nothing was staged or committed.

| Path | Change |
| --- | --- |
| `src/domain/primitives.ts` | added: `Actor`, `EventClock`, `EventSignature`, `TextSpan`, `Clock`, `IdGenerator`, deterministic clock and id helpers, `normalizeValue` |
| `src/domain/errors.ts` | added: `DomainError`, `DomainErrorCode`, `Decision` |
| `src/domain/claims.ts` | added: claim fields, `Claim`, `ClaimSource`, `ClaimRevision`, provenance tags |
| `src/domain/disclosure.ts` | added: levels, `DisclosurePolicy`, `canReadItem` access matrix |
| `src/domain/people.ts` | added: `User`, `DeviceIdentity`, `TrustedPeer` |
| `src/domain/outbox.ts` | added: `OutboxMessage`, `InboxMessage`, `SyncCursor`, `PacketReceipt`, `retryDelayMs` |
| `src/domain/events.ts` | added: 22 strict payload schemas, `DomainEvent`, `EventBatch`, `compareEvents`, `sortEvents` |
| `src/domain/state.ts` | added: `IncidentState` and all derived types (`Incident`, `OriginalReport`, `AIFinding`, `ClarificationQuestion`, `Contradiction`, `AssistanceTask`, `TaskStatus`, ...) |
| `src/domain/policy.ts` | added: the `can*` authorization functions |
| `src/domain/reducer.ts` | added: `replay`, `applyEvents`, `emptyState`, claim derivation |
| `src/domain/status.ts` | added: `deriveStatus` |
| `src/domain/projection.ts` | added: `projectForLevel`, `projectForDevice`, `levelForDevice` |
| `src/domain/rules/location.ts`, `rules/conflicts.ts`, `rules/index.ts` | added: floor and building extraction (English, Tagalog) with spans; model-free conflict detection |
| `src/domain/commands/build.ts`, `createManualSOS.ts`, `index.ts` | added: `CommandContext`, event builder, 24 commands |
| `src/domain/sync.ts` | added: `mergeRemoteEvents`, `eventsAfterCursor`, `advanceCursor`, `makeEventBatch` |
| `src/domain/index.ts` | added: public surface |
| `src/domain/testing/fixtures.ts` | added: synthetic actors, a full scenario, `forgeEvent`, seeded shuffle. Not exported from the index. |
| `src/domain/__tests__/*.test.ts` | added: 11 suites |
| `src/storage/sqlDriver.ts` | added: `SqlDriver` (`exec`, `run`, `all`, `transaction`) |
| `src/storage/migrations.ts` | added: versioned migrations, `migrate`, `schemaVersion` |
| `src/storage/ledgerStore.ts`, `sqliteStore.ts`, `memoryStore.ts` | added: row-level store interface and its two implementations |
| `src/storage/incidentRepository.ts` | added: `IncidentRepository` and the one implementation shared by both stores |
| `src/storage/sqliteRepository.ts`, `memoryRepository.ts` | added: factories |
| `src/storage/expoDriver.ts` | added: `SqlDriver` over `expo-sqlite`, `openExpoIncidentRepository` |
| `src/storage/testing/betterSqliteDriver.ts`, `testing/repositoryContract.ts` | added: Jest-only driver and the shared contract suite |
| `src/storage/__tests__/*.test.ts` | added: 2 suites |
| `src/storage/index.ts` | added: public surface (see Integration implications for what it leaves out) |
| `docs/DOMAIN_MODEL.md` | rewritten to describe the code |

## Commands run

| Command | Exit | Output summary |
| --- | --- | --- |
| `npx tsc --noEmit` | 0 | no output |
| `npx expo lint` | 0 | no output (no errors, no warnings) |
| `npx eslint src/domain src/storage --max-warnings 0` | 0 | no output |
| `npx jest src/domain src/storage` | 0 | `Test Suites: 13 passed, 13 total` / `Tests: 180 passed, 180 total` / `Snapshots: 0 total` |
| `npx jest` (whole repo) | 0 | `Test Suites: 15 passed, 15 total` / `Tests: 207 passed, 207 total` |

Per suite: domain 136 tests in 11 suites (`authorization`, `claims`, `delivery`, `projection`, `replay`, `rules`, `scenario`, `schema`, `sos`, `sync`, `tasks`); storage 44 tests in 2 suites (`memoryRepository`, `sqliteRepository`). The repository contract (19 tests) runs once against the in-memory store and once against SQLite through `better-sqlite3`.

A one-off mutation check was also run and reverted: eight deliberate rule breaks (send attempt marks delivered; on-behalf acceptance allowed; AI proposal outranks a confirmation; anyone may resolve; relay may read; resolution deletes the losing statement; no outbox backoff; AI proposals hidden) each made between 1 and 6 tests fail. A ninth mutation (removing the event sort) did not apply because the search string was wrong, so it was not tested.

Not run, and why: no `expo run`, `expo prebuild`, pod or Xcode command, as instructed. Nothing was run on a device.

## Status claimed

| Item | Status | Evidence |
| --- | --- | --- |
| Zod contracts, 22-event vocabulary | UNIT-TESTED | `schema.test.ts` |
| Reducer, replay, idempotence, order independence | UNIT-TESTED | `replay.test.ts`: 300 seeded shuffles of a 24-event history, all 24 permutations of a 4-event history, duplicates, partial histories, missing parents |
| Authorization policy | UNIT-TESTED | `authorization.test.ts`, `tasks.test.ts`, `claims.test.ts` |
| Delivery vs human states, status derivation | UNIT-TESTED | `delivery.test.ts` |
| Claims, AI proposals, contradictions | UNIT-TESTED | `claims.test.ts` |
| Disclosure projection | UNIT-TESTED | `projection.test.ts` |
| Floor and building rules | UNIT-TESTED | `rules.test.ts` |
| `mergeRemoteEvents`, sync cursor | UNIT-TESTED | `sync.test.ts` |
| `IncidentRepository` on SQLite (better-sqlite3) and in memory | UNIT-TESTED | contract suite; close-and-reopen of a database file; insert-only triggers; rollback |
| `src/storage/expoDriver.ts` | IMPLEMENTED | typechecks against `expo-sqlite` v57 types; never executed |

## Public API summary

Domain (`@/domain`):

- State: `replay(incidentId, events)`, `applyEvents(state, events)`, `emptyState(incidentId)`. `IncidentState` holds `incident`, `status`, `reports`, `claims`, `aiFindings`, `questions`, `contradictions`, `tasks`, `recipients`, `packets`, `disclosure`, `capsules`, `closure`, `timeline`, `notApplied`, `ledger`, `events`.
- Commands, all `(state, ctx, input) => { events, outbox, state }` and throwing `DomainError`: `createManualSOS(ctx, { recipients, incidentType? })`, `addReport`, `addObservation`, `recordAIProposal`, `requestClarification`, `skipClarification`, `confirmClaim`, `flagConflict`, `flagDetectedConflicts`, `resolveConflict`, `acknowledge`, `declineRequest`, `offerTask`, `acceptTask`, `declineTask`, `reportProgress`, `reportCompletion`, `confirmCompletion`, `prepareCapsule`, `queueCapsule`, `recordSendAttempt`, `recordPeerReceipt`, `resolveIncident`, `cancelIncident`.
- Policy: the `can*` functions return `{ ok: true } | { ok: false, code }`.
- Disclosure: `canReadItem`, `projectForLevel`, `projectForDevice`, `levelForDevice`.
- Rules: `extractFloor`, `extractFloors`, `extractBuilding`, `extractBuildings`, `floorLabel`, `detectFieldConflicts`, `conflictIdFor`.
- Sync: `mergeRemoteEvents`, `makeEventBatch`, `eventsAfterCursor`, `advanceCursor`, `EventBatchSchema`.

Storage (`@/storage`): `IncidentRepository`, `createSqliteIncidentRepository(driver, nowMs?)`, `createMemoryIncidentRepository()`, `SqlDriver`, `migrate`, `MIGRATIONS`. From `@/storage/expoDriver`: `openExpoIncidentRepository(name?)`, `createExpoSqlDriver(db)`.

Typical write: `const result = acceptTask(await repo.replay(id), ctx, { taskId }); await repo.commit(result);`

## Added event types

| Event | Why |
| --- | --- |
| `CLARIFICATION_SKIPPED` | The reporter can decline a question. Without an event the question stays open and the UI cannot stop asking. The field keeps what it had, including unknown. |
| `RESPONDER_DECLINED` | A responder declining the whole request. `TASK_DECLINED` is per task. Roles only offered to that responder reopen. |

Not added: a peer-forward event (a relay's forward is `PACKET_SENT_ATTEMPT` with `viaDeviceId`) and a disclosure-level-changed event (a new `CAPSULE_PREPARED` replaces the policy). The agent profile says not to add event types unilaterally; these two were added under the lead's task instruction that allows a small number, and need the lead's sign-off and a `DECISIONS.md` entry.

## Integration implications

Decisions the lead should confirm, because they are choices rather than requirements:

- **Recipients live in `INCIDENT_CREATED`.** Its payload lists `{ deviceId, userName, level, packetId }` per recipient, so delivery state has something to attach to. A device not listed there (or in a later `CAPSULE_PREPARED` policy) is not a participant and every event it authors is refused.
- **Pressing SOS records two claims**: `incidentType = "Manual SOS"` and `assistanceRequested = "yes"`, both `user_reported`.
- **Rule-extracted floor and building count as the speaker's own statement** (`extraction: 'rule'`, with the span). `addReport` and `addObservation` run the rules by default; pass `deriveLocation: false` to turn that off.
- **Unauthorized remote events are stored in the ledger and never applied**, rather than quarantined. They are well-formed, and an event refused today (for example an acceptance that arrived before its offer) may become valid when its context arrives; keeping them is what makes devices converge. Only malformed, wrong-incident and bad-signature events go to the quarantine table. `mergeRemoteEvents` reports both kinds under `rejected`, distinguished by `stage` and `storedInLedger`.
- **Status differs from the design export in two places**: a recipient who declined still counts toward `delivered` and `acknowledged`, and `acknowledged` does not require a delivered packet. Accepting a task does not set `acknowledged` (the prototype did).
- **`in_progress` needs an in-person task.** `TASK_OFFERED` has `inPerson`; the command defaults it to true only for `go_to_requester`.
- **While a field is `unresolved`, `claim.value` is `null`** and `claim.candidates` holds the competing values.

For the UI agent:

- Read state with `repo.replay(id)`; never store a status. Gate buttons with the `can*` functions and still catch `DomainError` (use `error.code`, the message has no content).
- `state.status.reason` gives the queued sub-case, including `no_trusted_peer`.
- `src/storage/index.ts` does not re-export `expoDriver`, so Demo code and tests can import `@/storage` without loading the native module. Live code imports `@/storage/expoDriver`.
- App code must not import `src/storage/testing/*` or `src/domain/testing/*`. Nothing enforces this yet; an ESLint `no-restricted-imports` rule in `eslint.config.js` would (lead's file).
- The app must supply a real `IdGenerator` (for example `expo-crypto` `randomUUID`) and `Clock`. The helpers in `primitives.ts` are deterministic counters for tests and Demo.

For the AI agent:

- Put model output in through `recordAIProposal` only. It becomes `ai_proposed` at most and cannot change a field a human stated.
- Pass `reportId` and evidence spans: the reducer compares each span with the stored report text and sets `AIFinding.evidenceVerified`. A failed check is recorded, not rejected; the AI layer should still drop such findings before recording them.
- An AI-detected conflict is `flagConflict(..., { detectedBy: 'ai' })` and may only reference human revisions.
- Task and clarification suggestions go through `offerTask({ origin: 'ai_suggested' })` and `requestClarification({ origin: 'ai' })`, issued when a human acts on them.

For transport and crypto:

- The domain does not verify receipt signatures. `recordPeerReceipt` must be called only after the receipt was verified. The schema and reducer check only that the receipt names the packet and its recipient.
- `mergeRemoteEvents` and `repo.ingestRemote` accept a synchronous `verifySignature(event)`.
- Per received packet: in one `repo.transaction`, call `recordInbound(packetId)`, skip on `'duplicate'`, otherwise `ingestRemote(batch, nowMs)`.
- Per send: `markSendAttempt` on the outbox row and `recordSendAttempt` in the ledger; on a verified receipt `recordPeerReceipt` plus `acknowledgeReceipt`, in one transaction. `retryDue(nowMs)` lists what to send.
- Only packets declared in `INCIDENT_CREATED` and `CAPSULE_QUEUED` have ledger delivery state. Packets that carry a responder's events back (outbox kind `event_sync`) are outbox rows only; nothing creates them yet.
- `projectForLevel` is the input for each ciphertext. It lives in `src/domain/`, while `docs/SECURITY_PRIVACY.md` says disclosure policy lives in `src/crypto/`; that doc needs a one-line update.

No shared-file changes and no new dependencies are needed.

## Known gaps

- **Ordering trusts the author's `lamport`.** A device can choose a low value so its event sorts earlier, for example to win a concurrent task acceptance. Checking `lamport` against `parents` is not implemented.
- **Same id, different content is not detected.** Each device keeps whichever copy it stored first, so two devices could diverge. A content hash as the event id would close this.
- **`seq` is per device per incident** unless the caller supplies `ctx.nextSeq`. If a device-wide counter is supplied, gaps appear within an incident and `advanceCursor` stops at the first gap; the result is resending, not loss.
- **The repository does not serialize read-then-commit.** Two commands built from the same replayed state and committed one after the other can both pass validation only if both still apply; the second is re-validated at append time and throws if it no longer applies. Callers must handle that error.
- **Quarantined bodies contain whatever was received**, up to 8 KB, at rest in SQLite. Retention and deletion are undecided.
- **No ledger compaction or deletion.** `reset()` drops everything.
- **Free text cannot be policed by schema.** A task title or symptom can contain any words; only the structure excludes severity and diagnosis.
- **Rules are narrow.** Floors above the tenth in words, "basement", "mezzanine", "itaas/ibaba" and named buildings ("Science Hall") are not recognised. The negation guard looks only at the few words before a match.
- **Not defined**: `RescueCapsule`, `EncryptedPayload`, `PacketEnvelope`, `CapabilitiesByDevice`, `SafetyPreferences`, and `TaskOffer` / `TaskAcceptance` / `Authorization` as separate types.
- Tests use non-null assertions (`!`) on fixture lookups. There is no `any` and no `@ts-ignore` in either directory.

## Blockers

None.

## Unverified

- `src/storage/expoDriver.ts` has never run. It uses `openDatabaseAsync`, `execAsync`, `runAsync`, `getAllAsync` and `withExclusiveTransactionAsync` as declared in `node_modules/expo-sqlite/build/SQLiteDatabase.d.ts`. Unchecked on a device: that the triggers and `INSERT OR IGNORE` behave as they do on SQLite 3.53.4 under better-sqlite3, that `runAsync(...).changes` is 0 for an ignored insert, that a throw inside `withExclusiveTransactionAsync` rolls back, and the `PRAGMA journal_mode = WAL` call.
- Performance: every read replays the incident's full ledger. Fine at the tested size (24 events); not measured beyond it.
- Invariant 11 (no incident content in logs) is satisfied by absence of logging in these two directories, not by a test.
