# Handoff: G3 design comparison, remaining screens

- Agent: pulse-mobile-ui
- Phase: P3
- Date: 2026-10-10
- Outcome: partial

The comparison was cut short by the coordinator (wrap-up requested mid-task). The report flow, the Details sheet and the Safety Session screen were compared in the simulator. The other sheets, the dialogs and onboarding steps 3 to 5 were compared from code only or not at all; see the per-screen table. No code was changed: no clear deviation from the export was found in the parts that were compared.

Simulator observations below are simulator evidence only (iOS 26.3 simulator "SAGIP 17 Pro Max", dev client on Metro, Demo mode). They pass no device gate. Nothing was seen in LIVE mode or on a phone.

## Changed files

| Path | Change |
| --- | --- |
| docs/agent-handoffs/P3c-g3-comparison.md | added, this handoff |

No file under `src/`, `tailwind.config.js` or any shared config was edited by this task. `docs/UI_REFERENCE.md` was not updated; its Port status rows for these screens still say "Not compared in the simulator" and need the lead's edit (see Integration implications).

## Per screen

Export line numbers refer to `design/PULSE-2.6.dc.html`.

| Screen | How compared | Differences found | Fixed | Left, and why |
| --- | --- | --- | --- | --- |
| Report: input, Type mode (export 704-739) | Simulator screenshot against export markup | None in layout, sizes, radii, colours or control order. Banner copy says "already saved on this device", not "already sent". | Nothing | Copy change is the required "saved, not sent" correction. |
| Report: input, Voice mode (721-731) | Simulator screenshot (idle state only) | Extra line under the mic label: "Voice is best-effort. Transcription runs on this device for en-US ...". | Nothing | Truthful addition. Recording, waveform and transcript states were not exercised (no microphone run). |
| Report: processing (740-758) | Simulator screenshot at 75% | Step labels and order differ: port has Saving your report / Extracting / Preparing incident record / Checking for missing context; export has Understanding reported situation / Extracting / Checking for missing context / Preparing incident record. | Nothing | Recorded deviation in UI_REFERENCE: the ring follows four real awaited stages. |
| Report: result, clarification, edit, evidence, confirmed (759-805) | Simulator screenshots of result, edit mode, confirmed state, open evidence card and both banners | Hero icon is `emergency`, not `personal_injury`; no severity row; tags use the port's provenance words; an added meta line "Simulated result · a proposal until you confirm it"; confirmed banner copy differs. Footer buttons, sizes and order match. | Nothing | All covered by D-19 and the UI_REFERENCE deviations. One open question for the lead below. |
| Report: AI unavailable, report not saved, voice failed, request not found | Code only | No export counterpart (additions). | Nothing | Not reached in the simulator. |
| SOS to report hand-off | Simulator, inconclusive | Tapping "Describe what happened" under Maestro landed on the incident, not the report screen. | Nothing | Most likely the 5-second countdown expired before Maestro's tap landed (Maestro waits on the animating ring). The wiring in `SOSScreen.tsx` (`send('report')`) reads correctly. Needs one manual tap on a phone to confirm. The report screen was reached through the incident's "Describe what happened" row instead. |
| Details sheet (809-825) | Simulator screenshot | None. Grabber, 32pt corners, caps heading, rows, 54pt Done pill match. No severity row. | Nothing | |
| Safety Session, inactive and active (626-659) | Simulator visible text for both states plus code against export; no screenshot was reviewed before wrap-up | "Last check-in" shows "—" while inactive; export shows a seeded "Today, 1:05 PM". | Nothing | No invented history. Sizes and spacing were checked from code only (ring 200/88/12, card radius 28, rows min 52, pills 58 and 56): they match. |
| Unusual-movement sheet (871-887) | Code only | Body copy says "will queue an unconfirmed request for your trusted circle. Simulated." instead of "will alert your trusted circle"; "I'm okay" toast drops "Saved to history". | Nothing | Queued is not alerted. The sheet was opened in the simulator but not captured; see Unverified for what followed. |
| Relay sheet (827-847) | Code only | Per-recipient delivery rows and "Try delivery again" are additions. Node chain, 52pt avatars, 44pt connectors, hop rows match. | Nothing | Additions are recorded in UI_REFERENCE. Not opened in the simulator. |
| Peer sheet (849-869) | Code only | Rows are Trust / Device ID / Connection / Last seen, not Device / Role / Connection / Last simulated contact / Local AI / Battery. Secondary buttons are Rename and Remove, not "View relay path" and "Contact". A level picker is added. | Nothing | Rows are measured state only. The two export buttons are absent from the peer sheet; "Contact" exists on the incident's Coordination tab. Whether the peer sheet should also carry "View relay path" and "Contact" is the lead's call; it is not recorded as a deviation in UI_REFERENCE. Not opened in the simulator. |
| Dialogs: resolve, cancel request, can't help, remove peer, settings resets (889-899) | Code only, `Dialog` primitive only | Primitive matches (280 wide, radius 18, 46pt buttons, scrim, green/coral confirm colour). | Nothing | Individual dialog titles and messages were not compared against export lines 1273, 1314, 1318, 1377, 1378. Not opened in the simulator. |
| Add-role sheet, Intelligence sheet | Not compared | | | Out of time. |
| Onboarding step 3, safety circle (103-117) | Code only | Rows are not tappable and show real peers or an empty row. | Nothing | Recorded deviation: bound to real peers. Onboarding shows only on a fresh LIVE profile; the simulator was not wiped. |
| Onboarding step 4, preferences (118-133) | Code only | DEMO shows the export's four rows and note verbatim. LIVE shows Manual SOS (locked on), Nearby discovery, Incident relay and a different note. | Nothing | Recorded deviation. |
| Onboarding step 5, ready (134-153) | Code only | "N of 3 ready" instead of "4 of 4 ready"; a "This device" row is added; AI pill is "Simulation" in DEMO. | Nothing | Recorded deviation (readiness ring row, still marked open in UI_REFERENCE). |
| SIMULATED bar above modals | Code and simulator | No native `Modal`, `Alert` or modal `presentation` is used anywhere under `src/app`, `src/components` or `src/ui`. Sheets and dialogs render through `OverlayHost` inside the shell, below the bar. Every stack screen is a card. The bar stayed visible above the Details sheet and its scrim, and on every report and session screen captured. | Nothing | One dev-only exception, below. |

### Dev-client banner over the SIMULATED bar

Once, a blue React Native "Refreshing..." banner covered the SIMULATED bar for a few seconds. It is the dev client's Fast Refresh banner, drawn natively when Metro pushes an update (another session was editing files at the time). It does not exist in a release build. A demo given from a development build with Metro attached can show it.

### Open question for the lead

The result screen keeps the export's green "Analysis complete" line and the heading "Incident understood". UI_REFERENCE lists "Incident understood" in the Design column of a deviation whose reason is "A proposal is not a finding", but the heading is still in the port (`src/components/report/ReportScreen.tsx`), softened by the "a proposal until you confirm it" line. It matches the export, so it was left alone. Decide whether the heading and the green tick should stay.

## Commands run

Run on branch `feat/local-ai-intelligence` with another session's uncommitted changes in the tree (`package.json`, lockfile, `src/domain/`, `src/ai/callstack/`, docs, `ml/`). This task changed no source file, so every failure below comes from that work.

| Command | Exit | Output summary |
| --- | --- | --- |
| npm run typecheck | 0 | No errors on the second run. The first run, minutes earlier, failed with `src/domain/rules/index.ts(2,15): TS2307 Cannot find module './delta'`; the other session added `delta.ts` in between. |
| npm run lint | 1 | 1 error: `src/domain/rules/index.ts 2:15 Unable to resolve path to module './delta' import/no-unresolved`. Possibly a stale resolver cache now that the file exists; not investigated, outside owned paths. |
| npx jest --maxWorkers=2 | 1 | Test Suites: 1 failed, 46 passed, 47 total. Tests: 1 failed, 496 passed, 497 total. The failure is `src/domain/__tests__/sos.test.ts`, "no domain module imports React Native, Expo, AI, transport, crypto or storage". All 13 suites under `src/components/__tests__` passed. An earlier run, before `delta.ts` existed, had 33 suites failing to load for the same missing module. |

Not run, and why: `npm test -- src/app src/components src/ui` separately (covered by the full run); `npm run doctor` (no dependency change).

## Status claimed

| Item | Status | Evidence |
| --- | --- | --- |
| Report flow compared with the export | IMPLEMENTED | Simulator screenshots, Demo mode, Type path with the sample report. No LIVE run, no voice run. |
| Details sheet compared with the export | IMPLEMENTED | Simulator screenshot, Demo mode. |
| Safety Session compared with the export | MOCKED | Simulator visible text plus code reading. No screenshot reviewed. |
| Relay sheet, peer sheet, dialogs, unusual-movement sheet | IN PROGRESS | Code reading only. |
| Onboarding steps 3 to 5 | IN PROGRESS | Code reading only; not reachable without wiping the simulator. |
| SIMULATED bar above overlays | IMPLEMENTED | Code search for native modals plus simulator screenshots; `shell.test.tsx` passes. |

## Integration implications

- No contract, dependency or shared-file change.
- `docs/UI_REFERENCE.md` Port status needs updating by the lead: "Report and local AI analysis" and "Details sheet" were compared in the simulator; "Relay sheet, other sheets and dialogs", "Safety Session, unusual-movement sheet" and onboarding steps 3 to 5 remain code-only.
- The peer sheet's row set and its missing "View relay path" and "Contact" buttons are not in the UI_REFERENCE deviations table. Either record them or assign the port.
- Four files were reassigned to another session during this task and were not touched: `src/components/settings/LocalAIDiagnosticsScreen.tsx`, `src/components/settings/CapabilityRows.tsx`, `src/components/present.ts`, `src/components/incident/IntelligenceTab.tsx`. No difference found here needs a change in them.

## Blockers

- None for this task. The lint error and the Jest failure in `src/domain/` belong to the other session.

## Unverified

- **Unusual-movement sheet outcome.** After "Simulate unusual movement" the simulator ended on the incident screen's "Request not found" state, and Activity then listed only the seeded demo incidents: the request created earlier in the same run (PULSE-F9BD) was gone too. The likely cause is a Fast Refresh from the other session's edits re-creating the Demo app while the countdown ran, which resets the demo world. This was not confirmed. If it reproduces with no file changing, `AnomalySheet.tsx` navigates to an incident the snapshot does not hold, and that is a bug. Re-run once with a quiet tree.
- The app process died once with SIGSEGV. The crash report's faulting frame is in `XCTAutomationSupport` (Maestro's driver), not in app code.
- Maestro taps an element's centre even when a scroll view clips it; one tap meant for "Type answer" hit the footer's "Edit extracted details" instead. The clarification card's typed-answer row was therefore not captured.
- Needs checking on a phone: SOS "Describe what happened" opening the report screen directly; voice recording and transcription states; keyboard behaviour over the report input, the clarification answer field and the peer rename field inside a sheet; sheet height and scroll at large Dynamic Type; VoiceOver focus being held inside an open sheet or dialog; everything in LIVE mode.
- Flows and screenshots are in the session scratchpad (`flows/g3-*.yaml`, `g3-*.png`), not in the repository.
