# Handoff: wire the P7b service additions into the UI

- Agent: pulse-mobile-ui
- Phase: P3b
- Date: 2026-10-10
- Outcome: complete in Jest. Nothing here was seen rendered: no simulator, device or screenshot was used.

## Changed files

Nothing was staged or committed.

| Path | Change |
| --- | --- |
| `src/components/network/NetworkScreen.tsx` | modified: default-level line and three-way chooser in the peer sheet, trusted peers only |
| `src/components/incident/StatusCard.tsx` | modified: amber notice when `sendFailure === 'packet_too_large'`; it replaces the "waiting to be delivered" line |
| `src/components/incident/RelaySheet.tsx` | modified: same condition shows a notice instead of "Try delivery again" |
| `src/components/settings/LocalAIDiagnosticsScreen.tsx` | modified: typed-text extraction through `diagnoseExtraction` in LIVE and DEMO; result card labels proposal, simulated source and failure state |
| `src/components/settings/SettingsScreen.tsx` | modified: amber memory-only notice, LIVE only |
| `src/components/__tests__/home-network.test.tsx` | modified: 4 tests |
| `src/components/__tests__/incident-design.test.tsx` | modified: 2 tests |
| `src/components/__tests__/screens.test.tsx` | modified: 6 tests; one old assertion removed (`diag-text` absent in live) because the field is now offered in live |

`src/ui/` was not changed. No new primitive: `ChoiceChip`, `Banner`, `MicroPill`, `TextField`, `Button`, `Card` are reused.

## Commands run

| Command | Exit | Output summary |
| --- | --- | --- |
| `npm run typecheck` | 0 | no output from `tsc --noEmit` |
| `npm run lint` | 0 | no errors, no warnings |
| `npx jest --maxWorkers=2` | 0 | `Test Suites: 46 passed, 46 total` / `Tests: 484 passed, 484 total` / `Snapshots: 0 total` |

Baseline 46 suites, 472 tests. The 12 new tests were written first and run before the implementation: 9 failed, 3 passed already because they assert absence (no level for an unpaired device, no size notice when nothing is blocked, no memory notice in demo or when storage is unreported).

Not run: expo, eas, Xcode, simulator, maestro, device. No git write command.

## Status claimed

| Item | Status | Evidence |
| --- | --- | --- |
| 1. Peer disclosure level in the peer sheet | UNIT-TESTED | `home-network.test.tsx` › Network (4) |
| 2. Update too large to send | UNIT-TESTED | `incident-design.test.tsx` (2) |
| 3. Free-text diagnostics | UNIT-TESTED | `screens.test.tsx` › local AI diagnostics (4) |
| 4. Settings held in memory only | UNIT-TESTED | `screens.test.tsx` › settings (2) |

## Tests added

`home-network.test.tsx`
- `shows a trusted peer’s default level and changes it for new requests only`
- `shows the refusal when a level change is not accepted`
- `offers no level for a device that is not paired`
- `marks no level as chosen when a trusted peer reports none`

`incident-design.test.tsx`
- `says an update is too large to send, without calling it waiting, queued or retryable`
- `shows no size notice when nothing is blocked`

`screens.test.tsx`
- `warns in Live when profile, pairings and settings are held in memory only`
- `shows no memory-only notice when storage is not reported, and never in Demo`
- `Live: extracts from typed text through diagnoseExtraction and creates, records and sends nothing`
- `Live: names a refusal and an unavailable model with the app’s own wording`
- `Demo: labels the result SIMULATED, shows no latency as a measurement and creates no simulated request`
- `Demo: a simulated result from a stored report carries no latency either`

## Visible copy added

Peer sheet (trusted peer only; chips use `LEVEL_LABELS`):
- `Default level: Passes along` / `Default level: Can see summary` / `Default level: Can see everything` / `Default level: Not known`
- chips: `Passes along`, `Can see summary`, `Can see everything`
- `Applies to new requests only. A request already sent keeps the level it was sent with.`
- `Passes along: <first name> is not alerted and only passes sealed requests along to other devices.`
- A refused change shows the service's own `message` as a toast (through `useRun`).

Incident status card, amber banner:
- `The latest update is too large to send. It has not gone out and is still on this device. Trying again will not send it.`

Relay sheet, amber banner in place of "Try delivery again":
- `The latest update is too large to send and has not gone out. Trying again will not send it.`

Settings, amber banner under the title (LIVE only):
- `Your profile, paired devices and settings are held in memory only on this device. They will be lost when the app closes.`

Local AI diagnostics:
- section `Extract from typed text`, field label `Test report`, button `Extract from this text`
- `Runs the model on the text above. Nothing is saved or sent, and no request is created.`
- result meta, live: `Proposal · <n> ms · callstack-apple` or `Failed: <state> · <n> ms · callstack-apple` (unchanged)
- result meta, simulated: `Proposal · simulated, not measured` or `Failed: <state> · simulated, not measured`, with a `SIMULATED` pill
- failure line: `<presentAIState label>. No proposal was produced.` (for example `Refused by the model. No proposal was produced.`)
- under a proposal: `A proposal, not a fact. Nothing was saved or sent.`; under a failure: `Nothing was saved or sent.`
- `Unknown:` and `Dropped (no evidence in report):` now list field labels (`Floor, Location, as described`) instead of field keys.

## Behaviour changes to review

- DEMO typed text used to create a simulated SOS and report to hold the text, then analyse it. It now calls `diagnoseExtraction` like LIVE and creates nothing. The old note ("A simulated request was created to hold this text…") is gone. This was needed for "nothing is saved or sent" to be true in both modes.
- While an incident has `sendFailure`, the Relay sheet offers no "Try delivery again" at all, even if other, sendable updates for the same incident are also pending. The view exposes one flag and one count, so the UI cannot tell them apart. The 5 s retry tick still runs underneath.
- While blocked, the status card drops the "N updates are waiting on this device to be delivered" line. Home's `· N pending` and the Timeline technical line (`queue=N`) are unchanged.
- The typed-text field has `maxLength={4000}`, the same cut the service applies, so what is on screen is what is analysed.
- Pressing the level a peer already holds does nothing. The chip selection moves only when the snapshot reports the new level.

## Integration implications

- No contract change requested. Gaps noticed, none blocking:
  - `sendFailure` is per incident, not per recipient or per update, so the notice cannot say who did not get it or which update it was. "The latest update" follows the P7b wording.
  - `PeerView.level` is optional. A trusted peer without it shows `Default level: Not known` with no chip selected; choosing one still calls `setPeerLevel`.
  - A live failure result still prints its `latencyMs` (for example `0 ms` for an unavailable model). That is what the result carries; whether a zero is a measurement is a service question.
  - The memory-only notice is on Settings only. P7b also suggested "wherever pairing is confirmed" (`PairScreen`); not done, the brief asked for one notice.
- `docs/UI_REFERENCE.md` does not describe these four additions. Not in my write set.

## Blockers

None.

## Unverified

- All layout and appearance. In particular, on a phone:
  - the peer sheet is now taller (level line, three chips that may wrap to two rows, two paragraphs); check it fits and scrolls on a small iPhone with the rename field open and at large Dynamic Type;
  - the failure toast from `setPeerLevel` appears above the open sheet and is not hidden behind it;
  - the amber banner inside the white status card (radius 16 inside radius 26) and its spacing above the step bar;
  - the banner above "Done" in the Relay sheet;
  - the Settings banner between the title and the profile card;
  - the diagnostics text field with the keyboard open, and the `SIMULATED` pill in the result card.
- VoiceOver reading order for the level chips (each chip is labelled with the level name and its selected state; the heading line precedes them).
- That the real `PulseCore` snapshot behaves as the fake does: `level` present on trusted peers, `sendFailure` clearing, `storage.settingsPersistent` in LIVE. Tests use `createFakePulseApp` only.
- `diagnoseExtraction` against the real model, including a rejected promise: the screen does not catch one (same as the existing stored-report path), relying on the contract returning `native_error`.
