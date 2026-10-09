# Security and privacy

Status: **planned design**. No cryptographic code exists and nothing here has been tested or reviewed (2026-10-09). This is a hackathon prototype; the design has had no external security audit. Use synthetic data only.

See [ADR/0003](ADR/0003-capsule-crypto-and-trust.md).

## Goals

1. Incident content is readable only by recipients the reporter approved.
2. A relay can forward a capsule without being able to read it.
3. A device is trusted because of its key, confirmed by two humans, not because of its display name.
4. Privacy is enforced by encryption and deterministic checks. An AI-written redaction is never a security control.

## Pairing (planned)

1. Each device creates or loads its identity keys.
2. The two devices exchange public keys over the local transport.
3. Each device derives the same short code from both public keys.
4. Both people compare the code out loud or by sight and confirm on their own device.
5. Only after both confirmations is the peer stored as a `TrustedPeer`.

A mismatch means the keys were not exchanged with the intended device; pairing is abandoned. No sensitive content is sent to an unpaired device.

Proposed, not frozen: code length and format; how a pairing is revoked.

## Key handling (planned)

| Key | Algorithm | Storage |
| --- | --- | --- |
| Device signing key | P-256 | Keychain; Secure Enclave when available |
| Device key-agreement key | P-256 | Keychain |
| Capsule content key | Random symmetric key, one per capsule | Memory only; wrapped per recipient inside the envelope |

- Private keys never leave the native module and are never passed to JavaScript.
- No keys, secrets or credentials are stored in the repository. `.env.example` contains fake placeholders only.
- Implemented in Swift with CryptoKit and Keychain (`modules/pulse-crypto`).

## Capsule encryption (planned)

1. Generate a random content key.
2. Encrypt the payload with ChaChaPoly.
3. For each authorized recipient: ECDH between the sender's key-agreement key and the recipient's public key, HKDF to derive a wrapping key, wrap the content key.
4. Build the envelope and sign it with the sender's signing key.

The summary and the restricted detail are **separate ciphertexts with separate keys**. A recipient gets only the wrapped keys for the level they were granted.

## Envelope fields (planned; names not frozen)

| Field | Purpose |
| --- | --- |
| Version | Reject unknown or downgraded formats. |
| Packet ID | Deduplication and replay detection. |
| Pseudonymous incident reference | Lets recipients group packets without exposing content. |
| Sender key identifier | Which trusted key to verify against. |
| Destination key identifiers | Who can unwrap; lets a relay route. |
| Expiry | Packets past expiry are rejected. |
| Hop limit | Bounds relaying. |
| Nonce | Uniqueness for the cipher and replay protection. |
| Wrapped keys | One per authorized recipient and level. |
| Ciphertext: summary | Readable at `trusted` and `authorized`. |
| Ciphertext: restricted detail | Readable at `authorized` only. |
| Signature | Covers all of the above. |

Envelope metadata will contain no names, no symptoms, no location text and no report text.

## Disclosure levels

| Level | Can route | Can read summary | Can read restricted detail |
| --- | --- | --- | --- |
| `relay` | Yes | No | No |
| `trusted` | Yes | Yes | No |
| `authorized` | Yes | Yes | Yes |

- The reporter chooses the level per recipient and sees a preview of what each recipient will be able to read before encrypting.
- A relay-only peer receives no wrapped key at all.
- Authorization is checked before decryption and rendering, and again before any action.
- Disclosure policy lives in deterministic TypeScript (`src/crypto/`), with tests.

## Replay, expiry and substitution

| Threat | Planned control |
| --- | --- |
| Replay of an old packet | Packet ID seen-set; expiry check. |
| Downgrade | Version field covered by the signature; unknown versions rejected. |
| Packet substitution or tampering | Signature over the whole envelope; authenticated encryption. |
| Unauthorized new peer | Signature must verify against a paired key. |
| Wrong recipient | No wrapped key, so no decryption. |
| Expired capsule | Rejected on receipt and not forwarded. |

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

## Data lifecycle (planned)

| Data | Where | Retention |
| --- | --- | --- |
| Incident ledger, reports | SQLite on device | Until the user deletes it; retention setting to be defined. |
| Outbox and inbox | SQLite on device | Until receipt, expiry or deletion. |
| Relayed ciphertext | SQLite on the relay | Until forwarded or expired. |
| Private keys | Keychain / Secure Enclave | Until identity reset. |
| Audio recordings | Temporary file | Deleted after transcription (planned). |
| Demo Lab data | Memory | Discarded on reset; never mixed with live data. |

Nothing is uploaded. There is no account, no server and no analytics in the live path.

Open: at-rest protection of the SQLite file beyond iOS Data Protection; export format; delete-everywhere semantics for content already delivered to others.

## Logging rule

No private content in logs. That means no report text, prompts, model output, names, locations, symptoms, decrypted payloads or key material in console logs, crash reports, analytics or test fixtures committed to the repository. Logs may contain event types, packet IDs, sizes, state names and error codes.

## Consent and permissions

- Microphone and speech recognition are requested only when the user starts a voice report. There is no ambient listening.
- Local Network is requested when discovery starts.
- Each capsule requires an explicit recipient review.
- Public demonstrations use synthetic incidents only.

## Test evidence

| Item | Status | Evidence |
| --- | --- | --- |
| `swift test` for the crypto core on macOS | NOT STARTED | — |
| Jest suite: tamper, replay, wrong key, expiry, untrusted peer, summary leakage | NOT STARTED | — |
| On device: relay-only phone shows ciphertext only | NOT STARTED | — |
| On device: trusted recipient reads exactly the approved level | NOT STARTED | — |
