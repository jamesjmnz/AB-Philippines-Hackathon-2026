# Handoff: service gaps after P7 (lifecycle, pairing convergence, oversize, peer level, diagnostics, kv flag)

- Agent: integration engineer (service layer)
- Phase: P7b
- Date: 2026-10-10
- Outcome: complete in Jest. Nothing here has run on a phone or a simulator.

## Changed files

Nothing was staged or committed.

| Path | Change |
| --- | --- |
| `src/services/PulseCore.ts` | modified: `setAppActive`, `setPeerLevel` as an action, `diagnoseExtraction`, `sendFailure` per incident, `storage` in the snapshot, pairing retry on the tick |
| `src/services/api.ts` | modified: two actions, three optional snapshot fields, `SendFailureCode` |
| `src/services/live.ts` | modified: `AppState` subscription, `kvPersistent` flag, returned app wraps the core so `dispose()` unsubscribes |
| `src/services/views.ts` | modified: `sendFailure` passed into the incident view |
| `src/sync/SyncEngine.ts` | modified: blocked-packet tracking, `maxSectionEvents` config, `retryPairing`, resend on link up |
| `src/sync/pairing.ts` | modified: `resendConfirm`, answer to a repeated confirmation from a finished pairing |
| `src/sync/packet.ts` | modified: optional `answer: true` on `pair_confirm` (wire format change) |
| `src/sync/types.ts` | modified: `SendBlockCode` |
| `src/components/testing/fakePulseApp.ts` | modified (additive, allowed by the brief): `setPeerLevel`, `diagnoseExtraction`, `diagnoseExtraction` added to `AI_ACTIONS` |
| `src/services/__tests__/lifecycle.test.ts` | added |
| `src/services/__tests__/oversize.test.ts` | added |
| `src/services/__tests__/peerLevel.test.ts` | added |
| `src/services/__tests__/diagnose.test.ts` | added |
| `src/services/__tests__/pairing.test.ts` | modified: `a lost confirmation` block (4 tests) |
| `src/services/__tests__/live.test.ts` | modified: 3 tests, `AppState` and failing kv-store mocks |

`src/storage/` was not touched.

## Commands run

| Command | Exit | Output summary |
| --- | --- | --- |
| `npm run typecheck` | 0 | no output from `tsc --noEmit` |
| `npm run lint` | 0 | no errors, no warnings |
| `npm test` | 0 | `Test Suites: 46 passed, 46 total` / `Tests: 472 passed, 472 total` / `Snapshots: 0 total` |

Baseline before the work: 42 suites, 454 tests. Each new test file was run and seen failing before its implementation, except the two `live.ts` wiring tests for `AppState`, which were written together with the wiring.

One mutation was applied and reverted: skipping the signature check in the new pairing answer path failed `is not answered, and creates no trust, when the repeat is forged or belongs to another pairing`.

Not run: expo, eas, Xcode, simulator, device. No git write command.

## Status claimed

| Item | Status | Evidence |
| --- | --- | --- |
| 1. Foreground/background lifecycle | UNIT-TESTED | `lifecycle.test.ts` (3), `live.test.ts` (2) |
| 2. Pairing converges after a lost confirmation | UNIT-TESTED | `pairing.test.ts` › `a lost confirmation` (4) |
| 3. Oversized packet surfaced | UNIT-TESTED | `oversize.test.ts` (2) |
| 4. `setPeerLevel` action, `PeerView.level` | UNIT-TESTED | `peerLevel.test.ts` (3) |
| 5. `diagnoseExtraction` | UNIT-TESTED | `diagnose.test.ts` (3) |
| 6. kv fallback visible | UNIT-TESTED | `live.test.ts` (1 new, 1 extended) |

## New API surface

### 1. Lifecycle (no UI work needed)

```ts
// PulseCore, not in PulseActions
setAppActive(active: boolean): Promise<void>
```

- `false`: stops discovery if it is not already off; `network.discovery` becomes `'off'` and every peer `'unreachable'`. `settings.discoveryEnabled` is not changed.
- `true`: restarts discovery when `settings.discoveryEnabled` and onboarded and it is not already on or starting (so it also retries after `permission_denied` / `error`, for someone returning from Settings), which reconnects trusted peers; then forwards relayed packets and kicks a flush.
- Same value twice is a no-op. Calls are serialized; a change that was superseded before it ran is skipped.
- While inactive, `setDiscovery(true)`, `updateSettings({ discoveryEnabled: true })`, onboarding and startup store the choice but do not start the radio; the next foreground does.
- `sendSOS` does not wait on it (tested with a `stopDiscovery` that never resolves).
- `createLiveApp()` subscribes to `AppState` `'change'`: `'active'` → `true`, `'background'` → `false`, `'inactive'` ignored. `dispose()` removes the subscription. If `react-native` `AppState` cannot be loaded the app starts without it. `createLiveApp()` now returns a wrapper object, not the `PulseCore` instance. DEMO does not call `setAppActive`.

Tests: `drops the radio in the background, keeps an SOS queued, and delivers it once after foreground`; `is idempotent and never restarts a radio the person switched off`; `does not hold an SOS back while the radio is hanging on a lifecycle change`; `pauses the radio when the app goes to the background, restarts it on return, and unsubscribes on dispose`; `still starts when the app state module cannot be loaded`.

### 2. Pairing convergence (no UI work needed)

- A device in `awaiting_peer` re-sends its `pair_confirm` on every retry tick (5 s) and when the link to that peer comes up.
- A device with no pairing session for the sender, which already trusts the sender, checks a repeated `pair_confirm` against the **stored** key material (code recomputed with `verifyPeerPairing(stored material)`, signature verified with the stored key) and, if valid, sends its own confirmation again with `pairing.answer: true`. It stores and changes nothing. An `answer` is never answered, so there is no ping-pong.
- Wire change: `pair_confirm.pairing` is now `{ signature, answer?: true }`.
- `pair_hello` from an already trusted device is unchanged: it opens a normal compare session and both people confirm again. I did not add an automatic answer to a hello: the finished phone would show no code, so the other person would have nothing to compare.

Tests: `is repeated on the retry tick until both sides trust each other, and then stops`; `is repeated when the link comes back`; `converges when the first confirmation is the one that was lost`; `is not answered, and creates no trust, when the repeat is forged or belongs to another pairing` (forged signature, a real confirmation replayed at a third device, a confirmation at a device that never paired, a hello with other keys for a trusted id, a forged `answer`).

### 3. Oversized packet

```ts
// api.ts
export type SendFailureCode = 'packet_too_large';
type IncidentView = { ...; sendFailure?: SendFailureCode | null };
```

- `PulseCore` always sets it (`null` when nothing is blocked); it is typed optional so existing fixtures compile.
- Set when a pending packet for that incident exceeds `MAX_PACKET_BYTES` after sealing, or a section would carry more than 1000 events. The row stays pending and counted in `pendingOutbox`, no send attempt is recorded, `state.status` is untouched.
- Clears when the packet is later built within limits, or the row leaves the outbox.
- In memory only: after a restart it reappears on the first send attempt (which needs a route to the recipient).
- Caps unchanged. `SyncConfig.maxSectionEvents` (default 1000) exists so a test can reach the cap; do not set it in app code.

Tests: `is reported on the incident when the packet exceeds the byte cap, and clears once it fits`; `is reported when a section would carry more events than a recipient accepts`.

**UI next:** on the incident screen (status card or timeline), when `incident.sendFailure === 'packet_too_large'`, say that the latest update is too large to send and has not gone out. Do not show it as sent or retrying. There is no action that fixes it today (the ledger only grows), so no retry button should promise otherwise.

### 4. Peer disclosure level

```ts
// PulseActions
setPeerLevel(peerDeviceId: string, level: DisclosureLevel): Promise<ActionResult>;
// PeerView
level?: DisclosureLevel;   // present on trusted peers only
```

- Fails with `peer_not_trusted` for an unpaired device and `invalid_input` for a value that is not `relay | trusted | authorized`.
- Applies to incidents created afterwards. An incident already sent keeps its recipients and levels (change those with `updateCapsule`).
- Works in DEMO on the viewed device (the Demo app forwards every action).
- `PulseCore.setPeerLevel` now returns `Promise<ActionResult>` instead of `Promise<void>`.

Tests: `decides what the next SOS seals for that peer, and a relay-level peer gets no packet of its own`; `refuses an unknown device or level and leaves unpaired devices without one`; `is available in the Demo Lab on the viewed device`.

**UI next:** in the trusted-peer row or peer detail on the Network screen, show `peer.level` and offer the three levels through `actions.setPeerLevel(peer.deviceId, level)`; show the returned message on failure. Copy should say that `relay` means this person will not be alerted, only carry encrypted packets for others, and that the change affects new requests only.

### 5. Free-text diagnostics

```ts
// PulseActions
diagnoseExtraction(text: string): Promise<AIResult<IncidentProposal>>;
```

- Trims, cuts to 4000 characters (the stored report limit), then calls `LocalAIService.extractIncidentReport`. Result is passed through unchanged, so unavailable, refusal, timeout and the rest are the same states `analyzeReport` returns. A model that throws gives `native_error` / `ai_call_failed`.
- Empty or non-string input: `{ ok: false, state: 'invalid_output', message: 'empty_input' }`, model not called.
- No incident, no event, no outbox row, no packet, no kv write, no snapshot change.
- In DEMO the result's `meta.source` is `'simulated'`.

Tests: `returns a proposal for free text without creating an incident, writing an event or sending anything`; `trims and bounds the text, and never calls the model for empty input`; `reports the same unavailable state as the report flow, and a failing model as a native error`.

**UI next:** in `LocalAIDiagnosticsScreen`, a text field and a button calling `actions.diagnoseExtraction(text)`; render `fields` (value + evidence), `dropped`, `unknown`, and `meta.latencyMs` / `meta.source`. Label the output as a proposal. In DEMO keep the SIMULATED label and do not present `latencyMs` as a measurement.

### 6. kv fallback

```ts
// PulseSnapshot
storage?: { settingsPersistent: boolean };
// PulseCoreDeps
kvPersistent?: boolean;   // default: true in LIVE, false in DEMO
```

- LIVE: `false` when `expo-sqlite/kv-store` failed to load and profile, pairings and settings are in memory. Incidents are in the SQLite ledger and not covered.
- DEMO: always `false` (it is in memory by design). The Demo placeholder snapshot before seeding has no `storage` field.

Tests: `says so when settings and pairings can only be kept in memory`; `starts in live mode, and an SOS persists even though AI, radio and crypto modules failed to load` (now asserts `settingsPersistent: true`).

**UI next:** when `snapshot.mode === 'live' && snapshot.storage?.settingsPersistent === false`, show a persistent notice (Settings, and wherever pairing is confirmed) that the name, trusted devices and settings will be lost when the app closes. Do not show it in DEMO.

## Integration implications

- `docs/NETWORK_PROTOCOL.md` needs the `pair_confirm.pairing.answer` field, the resend/answer rule, and the lifecycle behaviour. `docs/agent-handoffs/P7-integration.md` "Known limits" (silent oversize, kv fallback, no lifecycle) and "Pairing can end one-sided" are now out of date. Not in my write set.
- Wire compatibility: a build without this change rejects a `pair_confirm` carrying `answer` (strict schema). First confirmations are unaffected; only the recovery path needs both phones on the new build.
- `AI_ACTIONS` in the fake app now includes `diagnoseExtraction`, so the SOS component test also asserts the SOS path never calls it.
- No new dependency, no change to `package.json`, `app.config.ts` or `modules/`.

## Blockers

None.

## Unverified

- Everything on a device. In particular that `AppState` delivers `'background'` before iOS tears the links down, and that `PulsePeer.startDiscovery` after `stopDiscovery` comes back cleanly with the same device id.
- That native `verifyPeerPairing` returns the same code for the same stored material on a later call (the answer path recomputes it). If it does not, the answer is simply not sent and the pairing stays one-sided as before; no trust is created either way.
- A `stopDiscovery` or `startDiscovery` that never resolves holds every later lifecycle change behind it (the SOS path is unaffected). Not bounded with a timeout.
- Going to the background while discovery is still `starting`: the in-flight start can finish afterwards and report `on`. The same race already existed between two `setDiscovery` calls.
- A blocked packet is rebuilt and sealed again on every retry tick while a route exists; that cost was not measured.
- Re-pairing with an already trusted device resets its level to `trusted` (existing `finish` behaviour, not changed).
- `settingsPersistent` reflects only whether the module loaded. A store that loads but fails on write is still reported as persistent.
