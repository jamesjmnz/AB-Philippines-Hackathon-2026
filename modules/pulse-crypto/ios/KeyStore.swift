import CryptoKit
import Foundation
import Security

/// Holds this device's long-term keys. Private keys are created inside the Secure Enclave when the device has
/// one; what the Keychain stores is then only the enclave's opaque key reference, which is useless off-device.
/// Without an enclave, software keys are stored in the Keychain. Items never sync and never leave this device.
final class KeyStore {
  private static let service = "app.pulse.identity.v1"
  private static let signAccount = "signing"
  private static let agreeAccount = "agreement"

  struct Identity {
    let signer: CapsuleSigner
    let agreer: CapsuleKeyAgreer
    let hardwareBacked: Bool
    var material: PairingMaterial { PairingMaterial(signKeyX963: signer.publicKeyX963, agreeKeyX963: agreer.publicKeyX963) }
  }

  private var cached: Identity?
  private let lock = NSLock()

  func loadOrCreate() throws -> Identity {
    lock.lock()
    defer { lock.unlock() }
    if let cached { return cached }
    let identity = try load() ?? create()
    cached = identity
    return identity
  }

  /// Deletes the identity. Every pairing made with it becomes invalid.
  func reset() {
    lock.lock()
    defer { lock.unlock() }
    cached = nil
    for account in [KeyStore.signAccount, KeyStore.agreeAccount] {
      SecItemDelete(baseQuery(account) as CFDictionary)
    }
  }

  private func load() throws -> Identity? {
    guard let sign = read(KeyStore.signAccount), let agree = read(KeyStore.agreeAccount) else { return nil }
    guard let kind = sign.first, kind == agree.first else { return nil }
    let signData = sign.dropFirst(), agreeData = agree.dropFirst()
    if kind == 1 {
      let s = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: Data(signData))
      let a = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: Data(agreeData))
      return Identity(signer: EnclaveSigner(key: s), agreer: EnclaveKeyAgreer(key: a), hardwareBacked: true)
    }
    let s = try P256.Signing.PrivateKey(rawRepresentation: Data(signData))
    let a = try P256.KeyAgreement.PrivateKey(rawRepresentation: Data(agreeData))
    return Identity(signer: SoftwareSigner(key: s), agreer: SoftwareKeyAgreer(key: a), hardwareBacked: false)
  }

  private func create() throws -> Identity {
    if SecureEnclave.isAvailable {
      let s = try SecureEnclave.P256.Signing.PrivateKey()
      let a = try SecureEnclave.P256.KeyAgreement.PrivateKey()
      try write(KeyStore.signAccount, Data([1]) + s.dataRepresentation)
      try write(KeyStore.agreeAccount, Data([1]) + a.dataRepresentation)
      return Identity(signer: EnclaveSigner(key: s), agreer: EnclaveKeyAgreer(key: a), hardwareBacked: true)
    }
    let s = P256.Signing.PrivateKey()
    let a = P256.KeyAgreement.PrivateKey()
    try write(KeyStore.signAccount, Data([0]) + s.rawRepresentation)
    try write(KeyStore.agreeAccount, Data([0]) + a.rawRepresentation)
    return Identity(signer: SoftwareSigner(key: s), agreer: SoftwareKeyAgreer(key: a), hardwareBacked: false)
  }

  private func baseQuery(_ account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: KeyStore.service,
      kSecAttrAccount as String: account,
    ]
  }

  private func read(_ account: String) -> Data? {
    var query = baseQuery(account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess else { return nil }
    return out as? Data
  }

  private func write(_ account: String, _ data: Data) throws {
    SecItemDelete(baseQuery(account) as CFDictionary)
    var query = baseQuery(account)
    query[kSecValueData as String] = data
    // Readable after first unlock so a queued SOS can still be signed; never migrates to another device or backup.
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw NSError(domain: "PulseCrypto", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Could not store the device key"])
    }
  }
}

private struct EnclaveSigner: CapsuleSigner {
  let key: SecureEnclave.P256.Signing.PrivateKey
  var publicKeyX963: Data { key.publicKey.x963Representation }
  func signature(for data: Data) throws -> Data { try key.signature(for: data).rawRepresentation }
}

private struct EnclaveKeyAgreer: CapsuleKeyAgreer {
  let key: SecureEnclave.P256.KeyAgreement.PrivateKey
  var publicKeyX963: Data { key.publicKey.x963Representation }
  func sharedSecret(with publicKey: P256.KeyAgreement.PublicKey) throws -> SharedSecret {
    try key.sharedSecretFromKeyAgreement(with: publicKey)
  }
}
