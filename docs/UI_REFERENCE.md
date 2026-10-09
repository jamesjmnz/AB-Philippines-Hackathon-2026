# UI reference

Status (2026-10-10): **all screens are ported to React Native and unit-tested** (`npx jest src/components`: 13 suites, 156 tests). Part of the port has been compared with the export in the iOS 26.3 simulator, in Demo mode only; see Port status. Nothing has been looked at in LIVE mode or on a physical iPhone, and Jest says nothing about how a screen looks. Token values below are read from the export and from `tailwind.config.js`.

## Design source

| Item | Value |
| --- | --- |
| Tool | Claude Design |
| Project file | `PULSE 2.6.dc.html` |
| Snapshot in the repository | `design/PULSE-2.6.dc.html` (reference only; not bundled, excluded from lint, tests and TypeScript) |
| Form | One phone frame, inline styles, a proprietary runtime script, a regex-based fake AI and a timer-driven simulation |
| State | Still being refined by the owner |

The export's runtime, fake AI and timers are not reused as product code. Its layout, tokens, vocabulary and state logic are the reference.

Because the design is still changing, a newer export is saved over the snapshot and diffed against it (last refreshed in `b759539`). Screens use the tokens and primitives; many also carry inline style values copied from the export.

No Cal AI assets are used. The visual direction (light, minimal, soft gray cards, black pill buttons) is a general style; no proprietary branded asset, icon or image from Cal AI or any other product is copied.

## Tokens

Defined in `tailwind.config.js`; the same values are exposed from `src/ui/theme.ts` for APIs that cannot use class names (SVG, navigation).

### Colour

| Token | Value | Use |
| --- | --- | --- |
| ink | `#151515` | Primary text, primary buttons |
| page | `#F7F7F9` | Screen background |
| card | `#FFFFFF` | Card surface |
| hairline | `#F2F2F4` | Dividers, neutral chip background |
| gray 1 | `#86868B` | Secondary text |
| gray 2 | `#6E6E73` | Secondary text, stronger |
| gray 4 | `#A1A1A6` | Tertiary text |
| gray 5 | `#C7C7CC` | Disabled, chevrons |
| coral | `#ED625E` | Urgent states only |
| coral text | `#C8433F` | Text on coral tint |
| coral tint | `#FDECEB` | Urgent background |
| amber | `#F4B860` | Pending |
| amber text | `#9A6210` | Text on amber tint |
| amber tint | `#FDF3E2` | Pending background |
| green | `#27A878` | Verified events |
| green text | `#1E7F5B` | Text on green tint |
| green tint | `#E6F5EE` | Verified background |
| indigo | `#46508A` | AI-proposed content |
| indigo tint | `#E9EBF6` | AI-proposed background |

`tailwind.config.js` also defines supporting values (gray 3, line, fill, and deeper coral and amber shades).

Colour meaning is fixed: coral for genuinely urgent states, amber for pending, green for events backed by evidence, indigo for AI proposals. Green is never used for a state that has not been measured.

### Shape and type

| Token | Value |
| --- | --- |
| Radius: card | 22 |
| Radius: feature | 24 |
| Radius: hero | 28 |
| Radius: pill | 999 |
| Font | System SF (no custom text font) |
| Icons | Material Symbols Rounded (Apache-2.0), bundled as a font via `expo-font` |

### Component conventions

- Primary call to action: black pill, white text.
- Cards: white on the page background, no shadow, no border.
- Minimum touch target 44pt. Dynamic Type and VoiceOver labels on every control.
- Safe areas respected. Light appearance only (`userInterfaceStyle: 'light'`).

## Primitives

In `src/ui/` (exported from `src/ui/index.ts`): `Avatar`, `Banner`, `Button` (pills, icon and link buttons, press scale), `Card`, `Chip`, `Controls` (segmented control, toggle), `Icon`, `Input`, `Logo`, `MapCard` (campus map, SVG), `Motion` (pulse ring, enter transitions), `Overlays` (bottom sheet, dialog, toast), `Progress` (ring, step bar), `Rule`, `Screen`, `Timeline`, `theme`.

Known defect class: a function-form `style` on `Pressable` is dropped by the NativeWind JSX transform. It was found in the simulator and fixed; Jest does not run that transform and cannot catch it.

## Vocabulary in the export

| Group | Labels in the export |
| --- | --- |
| Provenance tags | confirmed, reported, suggested, needs, missing, conflict |
| Task status | Open, Taken, On the way, Done, Confirmed |
| Capsule status | Not prepared, Prepared, Queued, Transmitting, Delivered, Delivery failed, Awaiting peer, Relayed, Not shared |
| Access level | Passes along (relay), Can see summary (trusted), Can see everything (authorized), Basic alert only, No access, Requester |
| Demo scenarios | Normal SOS; CareChain Intelligence; Multi-Responder Assistance; Rescue Capsule Privacy; Offline Network Recovery; Complete PULSE Experience |

The port does not use the export's provenance labels. `src/components/present.ts` holds every status word in the app: provenance chips are `user reported`, `AI proposed`, `user confirmed`, `responder reported`, `unresolved` and `unknown`; task status reads Open, Taken, In progress, Reported done, Confirmed; delivery reads Not prepared, Queued, Not delivered yet, Delivered.

## Navigation

Bottom tabs: `Home | Network | SOS | Activity | Settings`, with SOS as the central action. Incident detail: `Intelligence | Coordination | Timeline | Capsule`. Demo Lab under Settings. Routes live in `src/app/`; the route table is `src/components/nav.ts`:

| Route | Screen |
| --- | --- |
| `/welcome` | Splash, welcome and the five onboarding steps |
| `/`, `/network`, `/activity`, `/settings` | Tabs |
| `/sos` | SOS countdown |
| `/incident/[id]`, `/incident/[id]/report` | Incident detail; report and local AI analysis |
| `/pair` | Pairing |
| `/demo-lab`, `/demo-lab/local-ai`, `/demo-lab/session` | Demo Lab, Local AI diagnostics, simulated Safety Session |

## Deviations from the 2.6 export

As built. The first port ([agent-handoffs/P3-ui.md](agent-handoffs/P3-ui.md)) left out several parts of the export; later commits (`b4dfd27` to `e336991`) ported them under a LIVE/DEMO rule: where the export shows seeded or simulated content, LIVE shows only what the device knows and DEMO shows the design as drawn. The "Now" column describes the code today, checked against `src/components/` and its tests.

| Design | Now | Reason |
| --- | --- | --- |
| Incident as one long scroll plus a separate Privacy page | **Intelligence / Coordination / Timeline / Capsule** segments holding the export's sections; Capsule is the Privacy page | Owner decision 2026-10-10 (D-20). Settled. |
| Campus map with pins on Home and the incident | Ported (`src/ui/MapCard.tsx`, `src/components/map/IncidentMap.tsx`). LIVE: the card is drawn under a veil with no pins, and a chip repeats the location in the reported words, "not stated", or protected. DEMO: pins and highlighted building as designed | No invented positions in LIVE. Changed since the P3 handoff, which had no map. |
| Readiness ring with a shield and "4 of 4 ready" | A ring with a shield icon and "N of 3 ready" on Home and the last onboarding step, counting three facts: text model ready, at least one trusted device, at least one reachable now | Changed since the P3 handoff, which removed the ring. Open: this differs from the earlier planned correction (split AI and network facts, no shield score); the lead has not recorded a decision. |
| Onboarding: who-for, role, seeded contacts, monitoring preferences | Five steps including who-for and role choices and a name. The safety-circle and final steps are bound to real peers and capabilities; the export's simulated preferences appear only in DEMO | `completeOnboarding` needs a name; no seeded people in LIVE. Changed since the P3 handoff. |
| Welcome illustration with three avatars | Orbit drawn without people in LIVE, with "Explore Demo"; the three simulated people appear only in DEMO | No invented people in LIVE. |
| "Your trusted circle will be alerted automatically in N seconds" | "Your request will be saved on this device and queued for your trusted devices in N seconds" | The countdown only saves and queues. |
| "Simulated · No emergency services are contacted" | "SAGIP does not contact emergency services. Nobody is alerted until a trusted device receives this request", plus a "Call emergency number" link (`tel:911`, on tap only). "Simulated ·" is prefixed only in DEMO | Truthful footer, user-initiated call. |
| SOS context rows (seeded location, contacts) | Trusted devices paired, connected right now, "Local AI: Not needed for SOS" | Measured state only. |
| Step labels with "Sent" always filled | Saved / Delivered / Seen / Role taken / Resolved, each filled by its own evidence | Queued is not sent. |
| "Help is on the way" for any accepted role | "X is on the way" only for `in_progress`, with "Arrival is not confirmed" | Arrival is never inferred. |
| Home "You'll be alerted when someone nearby needs help" | "Requests from your trusted devices appear here when they reach this iPhone", shown only when a trusted peer is connected | No alerting promise. |
| Home "Internet unavailable · Local network active" pill | One line built from `network` and `peers` | Internet state is not measured. |
| AI result "Incident understood" with an injury icon | Proposal rows with evidence and an "AI proposed" chip | A proposal is not a finding; no medical framing. |
| Processing screen with a percentage | A ring whose percentage follows four awaited stages (save report, extraction, record proposal, optional clarification) | Changed since the P3 handoff, which had no percentage. The number is step progress, not a model measurement. |
| "Use sample report (Filipino)", "Use example" | Offered in DEMO only | No canned content in LIVE. |
| "Encryption simulated" on the capsule card | Shown only in DEMO | Not claimed in LIVE. |
| Safety Session; unusual-movement sheet | Ported as simulations (`src/components/demo/`), reachable from Demo Lab and, in DEMO, from Home. Timer only; the screen refuses to render outside DEMO | Core Motion check-in is NOT STARTED. Changed since the P3 handoff. |
| "Contact" | Ported. LIVE says SAGIP has no number and places no call; DEMO says it is simulated | No call is placed by the app. |
| "Relay history" sheet; Details sheet | Ported: relay chain, per-recipient receipts, hops, and a retry only while something is waiting | Built from ledger state. |
| Network "Simulation controls" card | Rendered on Network only in DEMO; the same switches are in Demo Lab | Demo is kept apart from LIVE. |
| Relay Path card always present | Shown only when an open incident was received through a relay or has a relayed packet | From real state. |
| Tab bar: white at 94% over a 20px backdrop blur | Opaque white | The build has no blur module (`expo-blur` is not installed). |
| "Medical severity" field | Removed; tests assert no severity row in any segment | The product never states severity (D-19). |
| Web presenter panel, fake status bar, home indicator | Not ported | Not part of the app. |

Additions not in the design: the SIMULATED bar, the pairing screen, the Local AI diagnostics screen, per-recipient delivery rows in Coordination, a "Received on this device" status for a responder's own copy of a request, "Try delivery again" while something is waiting in the outbox.

Not re-checked against the current code and left as the P3 handoff stated it: the wording of the Home network line.

## Port status

"Simulator" means compared with the export in the iOS 26.3 simulator from EAS build `66901962`, Demo mode. No row has been seen in LIVE mode or on a phone.

| Screen or element | Status | Evidence |
| --- | --- | --- |
| Tokens in `tailwind.config.js` | IMPLEMENTED | Simulator. |
| `src/ui/theme.ts` | IMPLEMENTED | Simulator. |
| Primitives | IMPLEMENTED | Exercised through the screen suites; `map.test.tsx` for the map card. Simulator. |
| App shell, SIMULATED bar, tab bar | IMPLEMENTED, UNIT-TESTED | `shell.test.tsx`, `tabbar.test.tsx`. Simulator. |
| Splash, welcome, onboarding | IMPLEMENTED, UNIT-TESTED | `onboarding.test.tsx`. Simulator: welcome and steps 1 and 2; steps 3 to 5 not compared. |
| Home | IMPLEMENTED, UNIT-TESTED | `home-design.test.tsx`, `home-network.test.tsx`. Simulator. |
| Network | IMPLEMENTED, UNIT-TESTED | `home-network.test.tsx`. Simulator. |
| Activity, Settings | IMPLEMENTED, UNIT-TESTED | `screens.test.tsx`. Simulator. |
| SOS countdown | IMPLEMENTED, UNIT-TESTED | `sos.test.tsx`. Simulator. |
| Incident detail (four segments, status card, map) | IMPLEMENTED, UNIT-TESTED | `incident.test.tsx`, `incident-design.test.tsx`, `status.test.tsx`, `map.test.tsx`. Simulator. |
| Details sheet, Relay sheet, other sheets and dialogs | IMPLEMENTED, UNIT-TESTED | `incident-design.test.tsx`, `shell.test.tsx`. Not compared in the simulator. |
| Report and local AI analysis | IMPLEMENTED, UNIT-TESTED | `report.test.tsx`. Not compared in the simulator. Voice recording never run. |
| Pairing | IMPLEMENTED, UNIT-TESTED | `home-network.test.tsx`. Not compared in the simulator. |
| Demo Lab, Local AI diagnostics | IMPLEMENTED, UNIT-TESTED | `screens.test.tsx`. Not compared in the simulator. |
| Safety Session, unusual-movement sheet | MOCKED, UNIT-TESTED | `session.test.tsx`, `shell.test.tsx`. Not compared in the simulator. |
| VoiceOver order, Dynamic Type, Reduce Motion | NOT STARTED | Labels and roles are asserted in tests; no accessibility pass has been done. |
| Backdrop blur on the tab bar | MISSING | Needs `expo-blur` and a new native build. |

Test files are in `src/components/__tests__/`.
