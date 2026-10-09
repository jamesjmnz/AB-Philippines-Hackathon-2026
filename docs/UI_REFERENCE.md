# UI reference

Status: the design exists as an export; **no screen has been ported to React Native yet** (2026-10-09). Token values below are read from the export and from `tailwind.config.js`.

## Design source

| Item | Value |
| --- | --- |
| Tool | Claude Design |
| Project file | `PULSE 2.6.dc.html` |
| Snapshot in the repository | `design/PULSE-2.6.dc.html` (reference only; not bundled, excluded from lint, tests and TypeScript) |
| Form | One phone frame, inline styles, a proprietary runtime script, a regex-based fake AI and a timer-driven simulation |
| State | Still being refined by the owner |

The export's runtime, fake AI and timers are not reused as product code. Its layout, tokens, vocabulary and state logic are the reference.

Because the design is still changing, screens will consume tokens and primitives only. When a newer export arrives it will be saved next to the current snapshot and diffed against it.

No Cal AI assets are used. The visual direction (light, minimal, soft gray cards, black pill buttons) is a general style; no proprietary branded asset, icon or image from Cal AI or any other product is copied.

## Tokens

Defined in `tailwind.config.js`; the same values will be exposed from `src/ui/theme.ts` for APIs that cannot use class names (SVG, navigation).

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

## Planned primitives

Built once and reused: pill button, card, grouped list, status chip, provenance tag, segmented control, toggle, progress ring, timeline item, step bar, banner, bottom sheet, dialog, toast, avatar, peer row, campus map (SVG).

## Vocabulary in the export

| Group | Labels in the export |
| --- | --- |
| Provenance tags | confirmed, reported, suggested, needs, missing, conflict |
| Task status | Open, Taken, On the way, Done, Confirmed |
| Capsule status | Not prepared, Prepared, Queued, Transmitting, Delivered, Delivery failed, Awaiting peer, Relayed, Not shared |
| Access level | Passes along (relay), Can see summary (trusted), Can see everything (authorized), Basic alert only, No access, Requester |
| Demo scenarios | Normal SOS; CareChain Intelligence; Multi-Responder Assistance; Rescue Capsule Privacy; Offline Network Recovery; Complete PULSE Experience |

The mapping from these labels to the specification's provenance tags (`user reported`, `AI proposed`, `user confirmed`, `responder reported`, `unresolved`) will be fixed in Phase 3.

## Navigation

Bottom tabs: `Home | Network | SOS | Activity | Settings`, with SOS as the central action. Incident detail: `Intelligence | Coordination | Timeline | Capsule`. Demo Lab under Settings. Routes live in `src/app/`.

## Planned deviations from the 2.6 export

Required by the PULSE master specification.

| Change | Reason |
| --- | --- |
| Incident detail gets an **Intelligence / Coordination / Timeline / Capsule** segmented control | The export computes these sections but renders one long scroll; the sections map onto the segments unchanged. |
| Home gets a **Local AI card** (provider "Callstack Apple", device, real state) | Local inference must be visible and truthful. |
| A real **pairing** screen is added | The export has none. |
| Demo Lab moves under Settings; the web presenter panel and fake status bar are dropped | Demo must be separated and labelled inside the app. |
| The "Medical severity" field is removed | The product must never state severity. |

## Planned copy corrections

Copy in the export that would break the truthfulness rules will be changed in the port.

| In the export | In the port |
| --- | --- |
| "Help is on the way" shown for any accepted role | Shown only when an in-person task is in progress |
| Step "Sent" always filled; "Basic SOS sent"; "Your SOS has already been sent" | "Saved and queued" until a receipt exists |
| "Responders were notified"; "Capsule update delivered" written without a receipt | Driven by receipts only |
| Readiness ring mixing AI availability into a safety score under a shield icon | Split into separate AI and network facts |
| "Filipino detected"; "Nearby devices found"; "Local network active" | Shown only when measured |

## Port status

| Screen or element | Status |
| --- | --- |
| Tokens in `tailwind.config.js` | IN PROGRESS |
| `src/ui/theme.ts` | NOT STARTED |
| Primitives | NOT STARTED |
| All screens | NOT STARTED |
