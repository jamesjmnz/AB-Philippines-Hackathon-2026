# ADR 0003 — Capsule cryptography and trust

- Date: 2026-10-09
- Status: **Accepted, implementation pending**
- Phase: P6

## Context

A Rescue Capsule carries incident content between phones, sometimes through a relay that must not be able to read it. Recipients are granted different levels of access. Trust in a peer must rest on a verified key, not on a display name or a network advertisement. The master specification requires CryptoKit and Keychain through a minimal native bridge, per-recipient encryption, replay and expiry protection, and deterministic access checks. It also states that AI-generated redaction is not a security control.

## Decision

1. Build `modules/pulse-crypto` as an Expo module in Swift using CryptoKit and Keychain. The cryptographic core is pure Swift so it can be tested with `swift test` on macOS.
2. Each device holds a P-256 signing key (in the Secure Enclave when available) and a P-256 key-agreement key, both in the Keychain. Private keys never cross into JavaScript.
3. Pairing: devices exchange public keys; each derives the same short code from both keys; both people compare and confirm. Only then is the peer trusted.
4. Capsule: a random content key encrypts the payload with ChaChaPoly. The content key is wrapped for each authorized recipient using ECDH and HKDF.
5. Summary and restricted detail are separate ciphertexts with separate keys.
6. The envelope carries version, packet ID, pseudonymous incident reference, sender and destination key identifiers, expiry, hop limit, nonce, wrapped keys, ciphertexts and a signature over the whole. No names or content in metadata.
7. Three disclosure levels: `relay` (no key), `trusted` (summary key), `authorized` (summary and detail keys).
8. Disclosure policy and envelope validation live in deterministic TypeScript behind the `CapsuleCrypto` interface.
9. JavaScript tests use a `@noble`-based test double that implements the same interface. It is a test dependency only and is not used in the live path.

## Consequences

- Relays can forward without reading; access level is enforced by which keys a recipient holds.
- Two implementations (Swift and the test double) must stay interface-compatible. The double proves policy logic, not the Swift code; the Swift core needs its own tests.
- No forward secrecy: compromise of a device key exposes capsules addressed to it.
- Content already decrypted by an authorized recipient cannot be recalled.
- The human code comparison is the only defence against key substitution during pairing; the UI must make skipping it impossible.
- Parameters not yet fixed (short-code format, HKDF context strings, envelope encoding) are open questions in [DECISIONS.md](../DECISIONS.md).
- The design has not been externally reviewed and is suitable only for a prototype with synthetic data.

## Verification

Not yet verified. Evidence required: `swift test` output for the core; Jest output for tamper, replay, wrong key, expiry, untrusted peer and summary-leakage cases; on-device observation that a relay-only phone shows ciphertext only and a trusted recipient reads exactly the approved level (gate G6). See [SECURITY_PRIVACY.md](../SECURITY_PRIVACY.md).
