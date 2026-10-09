# Security and privacy

Status (2026-10-10): **implemented and unit-tested; never run on a device.** The Swift core in `modules/pulse-crypto` passes `swift test` on macOS with software keys (15 tests, recorded 2026-10-09) and is compiled into EAS build `fbc85457`. Pairing, envelope handling and disclosure in TypeScript (`src/sync/`, `src/crypto/`, `src/domain/`) are unit-tested in Jest against a simulated `CapsuleCrypto`, not against the Swift module. The Keychain and Secure Enclave paths, and the JS adapter `src/crypto/NativeCapsuleCrypto.ts`, have never executed. Sections below describe the code unless marked planned. This is a hackathon prototype; the design has had no external security audit. Use synthetic data only.

See [ADR/0003](ADR/0003-capsule-crypto-and-trust.md).

## Goals

1. Incident content is readable only by recipients the reporter approved.
2. A relay can forward a capsule without being able to read it.
3. A device is trusted because of its key, confirmed by two humans, not because of its display name.
4. Privacy is enforced by encryption and deterministic checks. An AI-written redaction is never a security control.

## Pairing

Code: `src/sync/pairing.ts`, `modules/pulse-crypto/ios/Core/Identity.swift`. Unit-tested with the simulated crypto (`src/services/__tests__/pairing.test.ts`) and, for the code derivation, in the Swift suite. Not run between two phones.

1. Each device creates or loads its identity keys.
2. The two devices exchange public key material (`pair_hello`) over the local transport. These packets are unsealed; they carry public keys, a self-declared display name and no incident content.
3. Each device derives the same six-digit code: SHA-256 over a version label and both devices' ids and public keys in sorted order, reduced to six decimal digits.
4. Both people compare the code out loud or by sight and confirm on their own device.
5. Each device sends a signed `pair_confirm`. A device stores the peer as trusted only when its own human confirmed **and** a confirmation that verifies against the peer's key arrived. A new peer starts at the `trusted` level.

A device id is derived from the device's two public keys (`dev-` plus 20 hex characters of a SHA-256), so key material whose id does not match is rejected, as is material whose id differs from the link it arrived on. A mismatch in the codes means the keys were not exchanged with the intended device; pairing is abandoned. No sensitive content is sent to an unpaired device.

Known gaps:

- A lost `pair_confirm` is re-sent on the retry tick and on reconnect; a phone that already trusts the peer verifies a repeated confirmation against the stored key material and answers with its own, storing nothing new. A repeat with different key material or a bad signature creates no trust (Jest: `pairing.test.ts`, "a lost confirmation"). Not observed on devices.
- Revocation is local only. Removing a peer deletes the local record and disconnects; the other phone is not told. The native `resetIdentity` exists but no screen or service calls it.

## Key handling

Code: `modules/pulse-crypto/ios/KeyStore.swift`. Compiled in build `fbc85457`; **UNVERIFIED on a device** (the Swift tests use software keys on macOS and do not touch the Keychain).

| Key | Algorithm | Storage |
| --- | --- | --- |
| Device signing key | P-256 (ECDSA) | Created in the Secure Enclave when the device has one; the Keychain then holds only the enclave's key reference. Otherwise a software key in the Keychain. |
| Device key-agreement key | P-256 (ECDH) | Same as the signing key. |
| Section key | Random 256-bit symmetric key, one per section per capsule | Memory only; wrapped per recipient inside the envelope |
| Ephemeral key-agreement key | P-256, one per capsule | Memory only; its public half travels in the envelope |

- Keychain items are generic passwords, accessible after first unlock, this device only (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`); they do not sync or migrate.
- Private keys never leave the native module and are never passed to JavaScript.
- No keys, secrets or credentials are stored in the repository. `.env.example` contains fake placeholders only.
- Implemented in Swift with CryptoKit and Keychain (`modules/pulse-crypto`).

## Capsule encryption

Code: `modules/pulse-crypto/ios/Core/Capsule.swift` (`CapsuleCore.seal`, `verify`, `open`). Unit-tested with `swift test`: seal and open, tamper, wrong key, expiry, relay-only.

1. For each section, generate a random 256-bit key and encrypt the section with ChaChaPoly. The canonical header and the section name are the authenticated data.
2. Generate one ephemeral P-256 key-agreement key for the capsule.
3. For each recipient and each section that recipient may read: ECDH between the ephemeral key and the recipient's key-agreement public key, HKDF-SHA256 (salt: the capsule id; info: a version label, the recipient id and the section name) to derive a wrapping key, and seal the section key with ChaChaPoly.
4. Sign the version, header, ephemeral public key, every section and every wrap with the sender's signing key (ECDSA P-256).

The summary and the restricted detail are **separate ciphertexts with separate keys**. A recipient gets only the wrapped keys for the level they were granted. On opening, the signature, sender id, version and expiry are checked before any key is unwrapped.

Which events and which projection go into each section is decided in TypeScript (`src/crypto/capsule.ts`, from `projectForLevel` in `src/domain/`); see [NETWORK_PROTOCOL.md](NETWORK_PROTOCOL.md).

## Envelope fields

As in `CapsuleEnvelope` (`Capsule.swift`) and `src/crypto/types.ts`.

| Field | Purpose |
| --- | --- |
| `v` | Version. Unknown versions are rejected. Covered by the signature. |
| `header.capsuleId` | Must equal the packet id, so an envelope cannot be re-sent under a new packet id to defeat deduplication. |
| `header.incidentRef` | The incident id, which is random and carries no content. Lets recipients group packets. |
| `header.senderId` | Which trusted key to verify against. A device id is a hash of public keys. |
| `header.createdAtMs`, `header.expiresAtMs` | Envelopes past expiry are rejected. The sync layer sets a 6 hour lifetime. |
| `header.hopLimit` | Bounds relaying. The sync layer sets 2. |
| `ephemeralKey` | Public half of the per-capsule key-agreement key. |
| `sections[]` | `{ name, ct }`: one ChaChaPoly box (nonce, ciphertext, tag) per section. `summary` is readable at `trusted` and `authorized`; `detail` at `authorized` only. |
| `wraps[]` | `{ recipientId, section, wrappedKey }`: one per recipient per section they may read. A relay-only recipient has none. |
| `signature` | Covers everything above. |

The envelope has no separate nonce field (the nonce is inside each ChaChaPoly box) and no destination list other than `wraps[].recipientId`. The final recipient is named by the packet's `to` field, which is outside the envelope. The packet's `hops` counter is also outside the envelope and is **not signed**.

Envelope metadata contains no names, no symptoms, no location text and no report text.

## Disclosure levels

| Level | Can route | Can read summary | Can read restricted detail |
| --- | --- | --- | --- |
| `relay` | Yes | No | No |
| `trusted` | Yes | Yes | No |
| `authorized` | Yes | Yes | Yes |

- The reporter chooses the level per recipient and sees a preview of what each recipient will be able to read before encrypting.
- A relay-only peer receives no wrapped key at all.
- Authorization is checked before decryption and rendering, and again before any action.
- Disclosure policy lives in deterministic TypeScript in `src/domain/` (`disclosure.ts`: `canReadItem`; `projection.ts`: `projectForLevel`, `projectForDevice`), with tests (`src/domain/__tests__/projection.test.ts`). `src/crypto/capsule.ts` turns the projection and the ledger into the `summary` and `detail` sections (`src/crypto/__tests__/capsule.test.ts`).
- A detail item that the policy shares with nobody (for example the report text while "share symptoms" is off) is `withheld`: it stays with the reporter and is sent to no recipient (D-21).
- Tightening a policy later does not recall content already delivered.

## Replay, expiry and substitution

| Threat | Control |
| --- | --- |
| Replay of an old packet | Packet ids already stored are recorded (`recordInbound`) and a repeat is not ingested again; expiry check. A duplicate is still receipted, because the first receipt may have been lost. |
| Downgrade | Version field covered by the signature; unknown versions rejected. |
| Packet substitution or tampering | Signature over the whole envelope; authenticated encryption. |
| Unauthorized new peer | Signature must verify against a paired key. |
| Wrong recipient | No wrapped key, so no decryption. |
| Expired capsule | Rejected on receipt and not forwarded. |
| Forged receipt | A receipt is accepted only if its envelope verifies against the recipient's key, its own signature verifies, and a pending outbox row with that packet id is addressed to that device. |

These controls are unit-tested with the simulated crypto in `src/services/__tests__/disclosure.test.ts` and, for the envelope itself, in the Swift suite. None has been exercised on a device.

Not controlled in this prototype:

| Gap | Consequence |
| --- | --- |
| Events are not signed individually; they are authenticated by the envelope they arrive in | A malicious reporter, who legitimately passes on everyone's events, can forge a responder's event such as an acknowledgment. A responder cannot forge the reporter's events or another responder's. |
| `hops` is outside the signature | A relay can understate it. The signed `hopLimit` still bounds honest hops, and a relay never forwards to another relay. |
| Ordering trusts the author's `lamport` value | A device can make its event sort earlier, for example to win a concurrent task acceptance. |
| An event id reused with different content is not detected | Each device keeps the copy it stored first; two devices could diverge. |
| Pairing ends one-sided after a lost confirmation | Re-sent and answered; see Pairing. |

## Threat model

In scope:

| Adversary | Capability | Outcome intended |
| --- | --- | --- |
| Nearby unpaired device | Sees Bonjour advertisement; can connect | Learns that a PULSE device is nearby; cannot read or inject accepted packets. |
| Relay-only peer | Holds and forwards ciphertext | Sees routing metadata and sizes; cannot read content. |
| Trusted peer at `trusted` level | Holds the summary key | Reads the summary only. |
| Passive observer on the local network | Captures traffic | Sees ciphertext and metadata. |
| Active attacker on the local network | Modifies, replays, drops | Modification and replay are detected; dropping causes `QUEUED`, not false delivery. |
| Impersonator during pairing | Substitutes keys | Short codes differ; humans abort. |

Out of scope for this prototype:

- A compromised or jailbroken device, or an unlocked phone in someone else's hands.
- A malicious authorized recipient re-sharing what they were allowed to read.
- Traffic analysis (timing, sizes, who is near whom).
- Denial of service and radio jamming.
- Forward secrecy and post-compromise security.

## Data lifecycle

As coded; none of the LIVE storage has run on a device.

| Data | Where | Retention |
| --- | --- | --- |
| Incident ledger, reports | SQLite on device (`expo-sqlite`) | Until the user chooses "delete all" in Settings. No retention setting, no compaction, no per-incident deletion. |
| Outbox and inbox | SQLite on device | A row leaves the pending set on a verified receipt, expiry or cancellation. A single row cannot be cancelled. |
| Quarantined packets (malformed, wrong incident, bad signature) | SQLite on device | Body stored as received, up to 8 KB. No retention rule. |
| Profile, pairings, settings, the reporter's latest projection per incident | Key-value store on device (`expo-sqlite/kv-store`) | Until changed or deleted. If the module fails to load they are kept in memory and lost on restart. |
| Relayed ciphertext | Key-value store on the relay | Until the transport accepted it for the recipient, or it expired. |
| Private keys | Keychain / Secure Enclave | Until identity reset (no screen offers this yet). |
| Audio recordings | Temporary WAV file written by `expo-audio` | No code deletes the file after transcription. Planned. |
| Demo Lab data | Memory | Discarded on reset; shares no storage, identity or adapter with live data. |

Nothing is uploaded. There is no account, no server and no analytics in the live path.

"Delete all" is local. It also clears the duplicate-packet table, so an incident still active on another device reappears the next time its reporter syncs.

Open: at-rest protection of the SQLite file beyond iOS Data Protection; export format; delete-everywhere semantics for content already delivered to others; retention defaults.

## Logging rule

No private content in logs. That means no report text, prompts, model output, names, locations, symptoms, decrypted payloads or key material in console logs, crash reports, analytics or test fixtures committed to the repository. Logs may contain event types, packet IDs, sizes, state names and error codes.

## Consent and permissions

- Microphone and speech recognition are requested only when the user starts a voice report. There is no ambient listening.
- Local Network is requested when discovery starts.
- A new SOS sends a basic alert to every trusted peer whose level is not `relay`, without a review step. Restricted detail is sent only after the reporter has reviewed the capsule and its recipients (`src/services/__tests__/disclosure.test.ts`).
- Public demonstrations use synthetic incidents only.

## Test evidence

| Item | Status | Evidence |
| --- | --- | --- |
| `swift test` for the crypto core on macOS | UNIT-TESTED | 15 passed, software keys (2026-10-09, evidence log in [AGENTIC_PROGRESS.md](AGENTIC_PROGRESS.md)): seal/open, tamper, wrong key, expiry, relay-only, pairing code. |
| Native module compiles for iOS | BUILT | EAS build `fbc85457` contains `PulseCryptoModule`. |
| Jest suite: tamper, replay, expiry, untrusted peer, forged receipt, summary leakage | UNIT-TESTED (simulated crypto) | `src/services/__tests__/disclosure.test.ts`, `delivery.test.ts`, `relay.test.ts`; 2026-10-10 run. Wrong-key decryption is covered by the Swift suite, not by Jest. |
| Disclosure projection and section split | UNIT-TESTED | `src/domain/__tests__/projection.test.ts`, `src/crypto/__tests__/capsule.test.ts`. |
| Pairing handshake | UNIT-TESTED (simulated crypto) | `src/services/__tests__/pairing.test.ts`. |
| JS adapter `NativeCapsuleCrypto` against the Swift module | IMPLEMENTED | No test; never executed. |
| Keychain and Secure Enclave key storage | BUILT | Never executed. |
| On device: relay-only phone shows ciphertext only | BLOCKED | No build installed on any phone; see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), Blocked. |
| On device: trusted recipient reads exactly the approved level | BLOCKED | Same. |
