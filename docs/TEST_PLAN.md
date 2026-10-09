# Test plan

Status: plan only. **No tests exist and none has been run** (2026-10-09). Result columns are empty on purpose. A result is entered only with the command that was run and a summary of its real output, or a dated device observation.

## Tooling

| Layer | Tool |
| --- | --- |
| TypeScript unit and integration | Jest with the `jest-expo` preset (`npm test`) |
| UI | React Native Testing Library |
| Types | `npm run typecheck` |
| Lint | `npm run lint` (includes the restricted-import rule for the AI packages) |
| Project health | `npm run doctor` |
| Swift | `swift test` on macOS for the pure crypto core |
| Device | Manual probes on the three iPhones; no simulator runtimes are installed |

Fixtures use synthetic text only. No real incident, location or health data.

## Unit tests

| ID | Area | Case | Phase | Result |
| --- | --- | --- | --- | --- |
| U-01 | Domain | Manual SOS persists with AI, transport and permissions absent (invariant 1, 12) | P2 | |
| U-02 | Domain | `createManualSOS` writes event and outbox row in one transaction; failure writes neither | P2 | |
| U-03 | Domain | Replay yields identical state; replay after restart yields identical state | P2 | |
| U-04 | Domain | Duplicate event ID is a no-op | P2 | |
| U-05 | Domain | Out-of-order events converge to the same state | P2 | |
| U-06 | Domain | Unknown stays unknown; no field is invented (invariant 4) | P2 | |
| U-07 | Domain | Conflicting claims are both kept; no automatic resolution (invariant 4) | P2 | |
| U-08 | Domain | AI proposal cannot change a confirmed claim (invariant 3) | P2 | |
| U-09 | Domain | Responder cannot accept a task for another person (invariant 5) | P2 | |
| U-10 | Domain | Delivered requires a verified receipt (invariant 7) | P2 | |
| U-11 | Domain | Resolution rejected without an authorized human event (invariant 10) | P2 | |
| U-12 | Domain | No severity, diagnosis or priority field is representable (invariant 2) | P2 | |
| U-13 | Storage | Outbox retry does not create duplicates on reconnect (invariant 8) | P2 | |
| U-14 | AI | Fake model: guardrail refusal → `guardrail_refusal` | P4 | |
| U-15 | AI | Fake model: malformed output → `invalid_output` | P4 | |
| U-16 | AI | Fake model: timeout → `timeout` | P4 | |
| U-17 | AI | Fake model invents a floor → field dropped to `unknown` by the evidence check | P4 | |
| U-18 | AI | Fake model invents severity → rejected by the strict schema | P4 | |
| U-19 | AI | Error classifier: each known message maps to its state; unknown → `native_error` | P4 | |
| U-20 | AI | Rules engine detects explicit floor conflict with no model | P4 | |
| U-21 | Crypto policy | Tampered envelope rejected | P6 | |
| U-22 | Crypto policy | Replayed packet rejected | P6 | |
| U-23 | Crypto policy | Wrong key cannot decrypt | P6 | |
| U-24 | Crypto policy | Expired envelope rejected | P6 | |
| U-25 | Crypto policy | Untrusted sender rejected | P6 | |
| U-26 | Crypto policy | `relay` gets no key; `trusted` cannot read restricted detail (invariant 6) | P6 | |
| U-27 | Swift | Crypto core round-trip, tamper and wrong-key cases (`swift test`) | P6 | |
| U-28 | Logging | No report text or payload reaches the logger (invariant 11) | P2 onward | |

## UI and integration tests

| ID | Case | Phase | Result |
| --- | --- | --- | --- |
| I-01 | Incident status changes render the correct distinct state | P3 | |
| I-02 | Peer disconnected: UI shows queued, not delivered | P3 | |
| I-03 | AI missing: "Local AI unavailable — sending original report" and SOS still works | P3 | |
| I-04 | Corrected floor: both statements remain visible with sources | P3 | |
| I-05 | Demo screens show the SIMULATED banner; live screens never do | P3 | |
| I-06 | Demo store is isolated from the live store | P3 | |
| I-07 | Full flow with test doubles: SOS → proposal → capsule → receipt → acknowledgment → task → conflict → resolution | P7 | |

## Adversarial checklist

From the master specification, Phase 9.

| ID | Case | Expected behaviour | Result |
| --- | --- | --- | --- |
| A-01 | Model refusal | Typed refusal; original report sent; SOS unaffected | |
| A-02 | Malformed model output | `invalid_output`; no proposal applied | |
| A-03 | Wrong or unsupported locale | `unsupported_locale`; typed text path offered | |
| A-04 | No microphone permission | Voice disabled; typed report and SOS work | |
| A-05 | No Local Network permission | Typed error; incident stays queued | |
| A-06 | Airplane mode | App works; no network call is attempted in the live path | |
| A-07 | Duplicate event or packet | Applied once | |
| A-08 | Late or out-of-order event | State converges | |
| A-09 | Inaccessible peer | Queued, with retry; no false delivery | |
| A-10 | Unauthorized relay | Cannot decrypt; sees ciphertext only | |
| A-11 | Expired capsule | Rejected and not forwarded | |
| A-12 | App paused or backgrounded | Outbox preserved; resumes on foreground | |
| A-13 | Recovery after force-quit | Ledger replays to the same state | |
| A-14 | Unpaired device connects | No sensitive content sent; packets from it rejected | |

## Per-device checklist

Fill in date, iOS version and the observation. Leave blank until done.

| ID | Check | iPhone 17 Pro Max | iPhone 14 Pro Max | iPhone 13 |
| --- | --- | --- | --- | --- |
| D-01 | Development build installs and launches | | | |
| D-02 | Manual SOS persists, all radios off | | | |
| D-03 | `apple.isAvailable()` value | | | |
| D-04 | Text extraction on unseen input, external internet disabled | | n/a (must not be called) | n/a (must not be called) |
| D-05 | Embeddings probe (`en`) | | | |
| D-06 | Transcription probe `en-US` | | | |
| D-07 | Transcription probe `fil-PH` | | | |
| D-08 | TTS readout | | | |
| D-09 | Local Network prompt and discovery | | | |
| D-10 | Pairing with short-code comparison | | | |
| D-11 | Packet and receipt, external internet disabled | | | |
| D-12 | Disconnect, reconnect, outbox flush | | | |
| D-13 | Relay-only view shows no content | | | |
| D-14 | Force-quit and relaunch: state replays | | | |

## Reporting

Results are copied into [AGENTIC_PROGRESS.md](AGENTIC_PROGRESS.md) (evidence log) and reflected in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) and [DEVICE_CAPABILITIES.md](DEVICE_CAPABILITIES.md).
