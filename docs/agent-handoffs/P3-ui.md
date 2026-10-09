# Handoff: PULSE 2.0 screens, navigation and UI tests

- Agent: pulse-mobile-ui
- Phase: P3
- Date: 2026-10-10
- Outcome: complete for code, typecheck, lint and Jest. **Nothing was rendered on a device or simulator. Every visual statement in this file is unverified.**

## Changed files

Only `src/app/**`, `src/components/**`, `src/ui/**` and this file. Nothing was staged or committed.

### Routes (`src/app/`)

| Path | Change |
| --- | --- |
| `_layout.tsx` | modified: mounts `AppRoot` around one root `Stack`; every screen is a stack card (no native modal) so the SIMULATED bar stays above it |
| `index.tsx` | deleted: the Phase 1 spike screen moved to `demo-lab/local-ai` |
| `(tabs)/_layout.tsx` | added: JS tabs with the custom tab bar; redirects to onboarding while `!me.onboarded` |
| `(tabs)/index.tsx`, `network.tsx`, `activity.tsx`, `settings.tsx` | added: Home, Network, Activity, Settings |
| `(onboarding)/_layout.tsx`, `(onboarding)/index.tsx` | added: welcome and four steps; redirects home once onboarded |
| `sos.tsx` | added: SOS countdown (full-screen card, slides from the bottom) |
| `incident/[id]/index.tsx` | added: incident detail |
| `incident/[id]/report.tsx` | added: report / local AI analysis |
| `pair.tsx` | added: pairing flow |
| `demo-lab/index.tsx`, `demo-lab/local-ai.tsx` | added: Demo Lab and Local AI diagnostics |

Route files only read params and render a component from `src/components/`.

### Components (`src/components/`)

| Path | What |
| --- | --- |
| `AppRoot.tsx` | `AppRoot` (lazy `require('@/services')`, creates and disposes the app per mode), `PulseShell` (provider, SIMULATED bar, ready gate, toast host), `StartingScreen` |
| `appMode.ts` | `useAppMode` zustand store: the single live/demo switch, written only by Demo Lab and the welcome screen's "Explore Demo" |
| `SimulatedBar.tsx` | persistent black SIMULATED bar, rendered only when `snapshot.mode === 'demo'` |
| `PulseTabBar.tsx` | Home, Network, raised coral SOS (62pt, white border, label "Request assistance"), Activity, Settings |
| `present.ts` | every status word in the app: `presentStatus`, `presentSteps`, provenance, delivery, task, event, AI-state and network wording |
| `nav.ts` | route table |
| `sos/SOSScreen.tsx` | countdown, "Send SOS now", "Describe what happened", Cancel, emergency-number link |
| `report/ReportScreen.tsx`, `report/voice.ts` | type or voice, analysis, proposal with evidence, confirm / edit, clarification, unavailable state; lazy `expo-audio` |
| `incident/IncidentScreen.tsx`, `StatusCard.tsx`, `IntelligenceTab.tsx`, `CoordinationTab.tsx`, `TimelineTab.tsx`, `CapsuleTab.tsx`, `useMe.ts`, `useRun.ts` | incident detail and its four segments |
| `home/HomeScreen.tsx` | greeting, network line, incoming and own cards, Request Assistance, Local AI card, overview |
| `network/NetworkScreen.tsx`, `network/PairScreen.tsx` | discovery states, relay card, Nearby/Trusted, peer sheet, pairing |
| `activity/ActivityScreen.tsx` | filters, search, cards, empty state, delete all |
| `settings/SettingsScreen.tsx`, `DemoLabScreen.tsx`, `LocalAIDiagnosticsScreen.tsx`, `CapabilityRows.tsx` | settings, Demo Lab, diagnostics |
| `onboarding/OnboardingScreen.tsx` | welcome and steps |
| `testing/fakePulseApp.ts` | test-only in-memory `PulseApp`: settable snapshot, every action a `jest.fn()`, `viewOf(state)` builds an `IncidentView` from a replayed state |
| `testing/scenarios.ts` | test-only incident states built by running real `@/domain` commands |
| `testing/mocks.ts`, `testing/render.tsx` | test-only Jest module mocks and render helper |
| `__tests__/*.test.tsx` | 8 suites |

### Primitives (`src/ui/`, additive)

| Path | Change |
| --- | --- |
| `Input.tsx` | added: `TextField` |
| `Motion.tsx` | added: `PulseRing` (Reanimated; static under Reduce Motion) |
| `index.ts` | modified: exports the two files above |
| `Screen.tsx` | modified: scroll view gets `automaticallyAdjustKeyboardInsets` and `keyboardDismissMode="interactive"` |
| `Progress.tsx` | modified: `StepBar` container is now `accessible`, so VoiceOver reads its label as one element |

## Commands run

| Command | Exit | Output summary |
| --- | --- | --- |
| `npx tsc --noEmit` | 0 | no output |
| `npx expo lint` | 0 | no output (no errors, no warnings) |
| `npx jest src/components` | 0 | `Test Suites: 8 passed, 8 total` / `Tests: 83 passed, 83 total` |
| `npx jest` (whole repo) | 0 | `Test Suites: 23 passed, 23 total` / `Tests: 290 passed, 290 total` |

The whole-repo count includes suites another agent was adding in `src/services`, `src/sync` and `src/demo` while this ran, so it will move. The 83 UI tests are the stable number for this task.

Not run, and why: no `expo prebuild`, `expo run`, pod or Xcode command and no git write command, as instructed. Metro was not started, so the bundle was never built.

## Status claimed

| Item | Status | Evidence |
| --- | --- | --- |
| Status wording and step bar per `IncidentStatus` | UNIT-TESTED | `status.test.tsx`: queued (no peer, awaiting, send attempted), delivered, acknowledged, role_taken, in_progress, resolved, cancelled, responder copy |
| SOS path calls `sendSOS` first and no AI action | UNIT-TESTED | `sos.test.tsx`: tap, countdown end, describe, cancel, failure and retry, `tel:911` only on tap |
| Report screen, including AI unavailable | UNIT-TESTED | `report.test.tsx` |
| Conflict card, provenance chips, coordination gating, timeline, capsule | UNIT-TESTED | `incident.test.tsx` |
| Home and Network no-peer, disconnected, permission-denied; pairing | UNIT-TESTED | `home-network.test.tsx` |
| SIMULATED bar in demo only; ready gate | UNIT-TESTED | `shell.test.tsx` |
| Tab bar: five destinations, accessible SOS | UNIT-TESTED | `tabbar.test.tsx` |
| Onboarding, Activity, Settings, Demo Lab, diagnostics | UNIT-TESTED | `screens.test.tsx` |
| `AppRoot` factory loading and mode swap | IMPLEMENTED | not tested; see Unverified |
| Expo Router layouts and redirects | IMPLEMENTED | typecheck only; routes are mocked in tests |
| Voice recording (`report/voice.ts`) | IMPLEMENTED | never executed |
| Layout, spacing, type, colour fidelity to the design | IMPLEMENTED | never rendered |

Fixtures are produced by `createManualSOS`, `recordSendAttempt`, `recordPeerReceipt`, `acknowledge`, `offerTask`, `acceptTask`, `reportProgress`, `resolveIncident`, `cancelIncident`, `addReport` and `addObservation`; no `IncidentState` is written by hand. Tests assert on rendered text, roles, labels and action calls. They say nothing about how a screen looks.

## Deviations from the design, and why

| Design | Port | Reason |
| --- | --- | --- |
| Campus map with pins on Home and the incident | No map. A neutral row shows the location in the reported words, "Location not reported", or "Location protected on this device" | No seeded pins or fake positions in live mode |
| "Your trusted circle will be alerted automatically in N seconds" | "Your request will be saved on this device and queued for your trusted devices in N seconds" | The countdown only saves and queues |
| "Simulated · No emergency services are contacted" | "PULSE does not contact emergency services. Nobody is alerted until a trusted device receives this request", plus a "Call emergency number" link (`tel:911`, on tap only). "Simulated ·" is prefixed only in demo | Truthful footer, user-initiated call |
| SOS context rows (seeded location, contacts) | Trusted devices paired, connected right now, "Local AI: Not needed for SOS" | Measured state only |
| Step labels with "Sent" always filled | Saved / Delivered / Seen / Role taken / Resolved, each filled by its own evidence | Queued is not sent |
| "Help is on the way" for any accepted role | "X is on the way" only for `in_progress`, with "Arrival is not confirmed" | Arrival is never inferred |
| Readiness ring with a shield and "4 of 4 ready"; "Your safety circle is ready" | Removed. Onboarding and Settings list each capability separately; Home has a Local AI card | AI readiness is a capability fact, not a safety score |
| Onboarding: who-for, role, seeded contacts, monitoring preferences | Name, permissions explained (not requested), per-capability AI, what PULSE does and does not do | `completeOnboarding` needs a name; no seeded people; monitoring is not a feature |
| Welcome illustration with three avatars | Logo with a pulse ring | No invented people |
| Home "You'll be alerted when someone nearby needs help" | "Requests from your trusted devices appear here when they reach this iPhone", shown only when a trusted peer is connected | No alerting promise |
| Home "Internet unavailable · Local network active" pill | One line from `network` and `peers` (for example "1 trusted · none connected right now") | Internet state is not measured |
| Incident as one long scroll plus a separate Privacy page | Intelligence / Coordination / Timeline / Capsule segments; Capsule is the Privacy page | Planned in `docs/UI_REFERENCE.md` |
| AI result "Incident understood" with an injury icon | "Check what was understood", proposal rows with evidence and an "AI proposed" chip | A proposal is not a finding; no medical framing |
| Processing screen with a percentage | Two honest steps, no percentage | No progress is measured |
| "Use sample report (Filipino)", "Use example" | Removed | No canned content in live screens |
| "Encryption simulated" on the capsule card | Shown only in demo; live says recipients read only their level and delivery comes from receipts | Not claimed in live |
| Safety Session, unusual-movement sheet, "Contact", "Relay history" sheet, battery, role pill | Not ported | Simulated or unmeasured features |
| Network "Simulation controls" card | Moved to Demo Lab | Demo is kept apart |
| Relay Path card always present | Shown only when an open incident has `receivedViaName` or a packet with `viaDeviceId` | Relay card only from real state |
| Demo Lab "Simulation toggles" and triggers | Live/Demo switch, view-as, two link toggles, AI-ready toggle, scenarios from `snapshot.demo.scenarios`, reset | Matches `PulseActions.demo` |
| Web presenter panel, fake status bar, home indicator | Not ported | Not part of the app |

Additions not in the design: the SIMULATED bar, the pairing screen, per-recipient delivery rows in Coordination, a "Received on this device" status for a responder's own copy of a request, "Try delivery again" when `pendingOutbox > 0`.

## Integration implications

Contract gaps met in `src/services/api.ts` (not changed):

- **No free-text extraction.** `analyzeReport(incidentId, reportId)` needs a stored report, so the diagnostics screen cannot run the model on arbitrary text without creating an incident. In live mode it re-runs extraction on a report already on the device (no side effects). Free text is offered in demo only, where it creates a simulated incident to hold the text. To restore the spike's live behaviour, add something like `diagnoseExtraction(text): Promise<AIResult<IncidentProposal>>`.
- **`attachProposal` timing.** The proposal is attached on the first Confirm, or when the person leaves through "View incident". If they leave with the back gesture of the system instead of the header button, nothing is attached. The service could attach inside `analyzeReport` if that is preferred.
- **Clarifications are keyed by field.** `answerClarification` and `skipClarification` take a `ClarifiableField`, while `state.questions` holds questions on any `ClaimField`. A question on `incidentType` or `symptom` is shown but cannot be answered from the UI.
- **`startTask` has no in-person flag.** The button reads "I'm on my way" when `task.inPerson`, otherwise "Start".
- **`sendSOS` failure.** The screen shows "could not be saved" and allows a retry; it does not show `message`.
- **`previewDisclosure` is called during render** for the selected level. It must stay synchronous and cheap.
- **Discovery toggle** in Settings calls `setDiscovery`, not `updateSettings({ discoveryEnabled })`.
- **Report language** offers `en-US` and `fil-PH` only (any other current value is shown as selected). There is no list of supported locales in the contract.
- `AppRoot` expects **`createLiveApp` and `createDemoApp` exported from `@/services`** (an `index.ts`), each returning a `PulseApp` or a promise of one. Until that file exists the app shows "Starting…" with "App services are not available in this build."
- `showTechnicalDetails` can be toggled but no screen reads it yet.

Shared files the lead may want to change:

- `jest.config.js`: a `setupFiles` entry could replace the per-test `import '../testing/mocks'`. The Reanimated 4 mock needs `react-native-worklets` mocked too and lacks `useReducedMotion`; `testing/mocks.ts` covers both.
- `docs/UI_REFERENCE.md`: port status table and the deviation list are out of date.

No new dependency is needed.

## Blockers

None.

## Unverified

- **Everything visual.** I cannot see rendered UI. Spacing, type sizes, colours, the raised SOS button, the tab bar overlap, sheet and dialog appearance, Dynamic Type behaviour, VoiceOver order and Reduce Motion were written from the design's inline styles and never looked at.
- **Metro bundling of the lazy `require('@/services')`.** It relies on Metro treating a `require` inside `try` as optional. Not checked, and moot once the module exists.
- **Typed routes.** `experiments.typedRoutes` is on but `.expo/types` has not been generated; paths in `nav.ts` are cast to `Href`.
- **Navigation.** Redirects between onboarding and tabs, `router.dismissTo` from the report screen, the stack keeping its place while `AppRoot` swaps apps on a mode change, and `navigation.navigate` from the custom tab bar were not exercised.
- **SIMULATED bar and overlays.** Screens sit under the bar, but `Sheet` and `Dialog` use React Native `Modal`, which covers the whole window; the bar is then behind the 40% scrim.
- **Safe area in demo.** Screens get a top inset of 0 through `SafeAreaInsetsContext.Provider` because the bar already covers it. Not seen on a device.
- **Voice.** `expo-audio` recording options (16 kHz mono 16-bit PCM WAV), the permission prompt on first tap, and whether the file suits `transcribe` were never run.
- **`accessibilityLiveRegion`** has no effect on iOS. The status card also calls `AccessibilityInfo.announceForAccessibility` on a status change; other live regions rely on the prop only.
- **`AppRoot`** has no test: a test would start failing or loading native modules as soon as `@/services/index.ts` appears.
- **Live vs demo data separation** is the service layer's job; the UI only renders the snapshot it is given.
