import CryptoKit
import Foundation

/// Routing metadata that relays can read. It must never contain names, symptoms or report text.
public struct CapsuleHeader: Codable, Equatable {
  public let capsuleId: String
  /// Pseudonymous incident reference.
  public let incidentRef: String
  public let senderId: String
  public let createdAtMs: Int64
  public let expiresAtMs: Int64
  public let hopLimit: Int

  public init(capsuleId: String, incidentRef: String, senderId: String, createdAtMs: Int64, expiresAtMs: Int64, hopLimit: Int) {
    self.capsuleId = capsuleId
    self.incidentRef = incidentRef
    self.senderId = senderId
    self.createdAtMs = createdAtMs
    self.expiresAtMs = expiresAtMs
    self.hopLimit = hopLimit
  }
}

public struct CapsuleSection: Codable, Equatable {
  public let name: String
  /// ChaChaPoly combined box (nonce + ciphertext + tag), base64.
  public let ct: String
}

public struct CapsuleKeyWrap: Codable, Equatable {
  public let recipientId: String
  public let section: String
  /// The section key sealed to this recipient, base64.
  public let wrappedKey: String
}

public struct CapsuleEnvelope: Codable, Equatable {
  public static let version = 1
  public let v: Int
  public let header: CapsuleHeader
  public let ephemeralKey: String
  public let sections: [CapsuleSection]
  public let wraps: [CapsuleKeyWrap]
  public let signature: String
}

public struct CapsuleRecipient {
  public let deviceId: String
  public let agreeKey: P256.KeyAgreement.PublicKey
  /// Names of the sections this recipient may read. Empty means relay-only: no key is wrapped for them.
  public let sections: [String]

  public init(deviceId: String, agreeKey: P256.KeyAgreement.PublicKey, sections: [String]) {
    self.deviceId = deviceId
    self.agreeKey = agreeKey
    self.sections = sections
  }
}

/// Rescue Capsule sealing and opening.
///
/// Each section (for example "summary" and "detail") is encrypted once under its own random key with ChaChaPoly.
/// That key is then sealed separately to every recipient allowed to read the section, using an ECDH shared secret
/// between a per-capsule ephemeral key and the recipient's agreement key, expanded with HKDF-SHA256.
/// A device with no wrap for a section cannot derive its key. The whole envelope is signed by the sender.
public enum CapsuleCore {
  public static func seal(
    header: CapsuleHeader,
    sections: [(name: String, plaintext: Data)],
    recipients: [CapsuleRecipient],
    signer: CapsuleSigner
  ) throws -> CapsuleEnvelope {
    guard !sections.isEmpty, Set(sections.map { $0.name }).count == sections.count else {
      throw CryptoCoreError.invalidEnvelope("sections must be non-empty and uniquely named")
    }
    let ephemeral = P256.KeyAgreement.PrivateKey()
    let ephemeralPub = ephemeral.publicKey.x963Representation
    let headerBytes = try canonical(header)

    var sealedSections: [CapsuleSection] = []
    var sectionKeys: [String: SymmetricKey] = [:]
    for section in sections.sorted(by: { $0.name < $1.name }) {
      let key = SymmetricKey(size: .bits256)
      let box = try ChaChaPoly.seal(section.plaintext, using: key, authenticating: aad(headerBytes, section.name))
      sectionKeys[section.name] = key
      sealedSections.append(CapsuleSection(name: section.name, ct: box.combined.base64EncodedString()))
    }

    var wraps: [CapsuleKeyWrap] = []
    for recipient in recipients.sorted(by: { $0.deviceId < $1.deviceId }) {
      for name in Set(recipient.sections).sorted() {
        guard let sectionKey = sectionKeys[name] else { throw CryptoCoreError.invalidEnvelope("unknown section \(name)") }
        let shared = try ephemeral.sharedSecretFromKeyAgreement(with: recipient.agreeKey)
        let wrapKey = wrappingKey(shared: shared, header: header, recipientId: recipient.deviceId, section: name)
        let keyBytes = sectionKey.withUnsafeBytes { Data($0) }
        let box = try ChaChaPoly.seal(keyBytes, using: wrapKey, authenticating: aad(headerBytes, name))
        wraps.append(CapsuleKeyWrap(recipientId: recipient.deviceId, section: name, wrappedKey: box.combined.base64EncodedString()))
      }
    }

    let unsigned = signingInput(version: CapsuleEnvelope.version, headerBytes: headerBytes, ephemeralPub: ephemeralPub, sections: sealedSections, wraps: wraps)
    let signature = try signer.signature(for: unsigned)
    return CapsuleEnvelope(
      v: CapsuleEnvelope.version,
      header: header,
      ephemeralKey: ephemeralPub.base64EncodedString(),
      sections: sealedSections,
      wraps: wraps,
      signature: signature.base64EncodedString()
    )
  }

  /// Checks that cost nothing secret: version, expiry and the sender's signature. Relays run this too.
  public static func verify(_ envelope: CapsuleEnvelope, senderSignKey: P256.Signing.PublicKey, expectedSenderId: String, nowMs: Int64) throws {
    guard envelope.v == CapsuleEnvelope.version else { throw CryptoCoreError.unsupportedVersion(envelope.v) }
    guard envelope.header.senderId == expectedSenderId else { throw CryptoCoreError.senderMismatch }
    guard envelope.header.expiresAtMs > nowMs else { throw CryptoCoreError.expired }
    guard let ephemeralPub = Data(base64Encoded: envelope.ephemeralKey), let sig = Data(base64Encoded: envelope.signature) else {
      throw CryptoCoreError.invalidEnvelope("bad base64")
    }
    let input = signingInput(version: envelope.v, headerBytes: try canonical(envelope.header), ephemeralPub: ephemeralPub, sections: envelope.sections, wraps: envelope.wraps)
    guard let signature = try? P256.Signing.ECDSASignature(rawRepresentation: sig), senderSignKey.isValidSignature(signature, for: input) else {
      throw CryptoCoreError.badSignature
    }
  }

  /// Verifies, then decrypts exactly the sections that were wrapped for `recipientId`.
  public static func open(
    _ envelope: CapsuleEnvelope,
    recipientId: String,
    agreer: CapsuleKeyAgreer,
    senderSignKey: P256.Signing.PublicKey,
    expectedSenderId: String,
    nowMs: Int64
  ) throws -> [String: Data] {
    try verify(envelope, senderSignKey: senderSignKey, expectedSenderId: expectedSenderId, nowMs: nowMs)
    let mine = envelope.wraps.filter { $0.recipientId == recipientId }
    guard !mine.isEmpty else { throw CryptoCoreError.notARecipient }
    guard let ephemeralData = Data(base64Encoded: envelope.ephemeralKey), let ephemeralPub = try? P256.KeyAgreement.PublicKey(x963Representation: ephemeralData) else {
      throw CryptoCoreError.invalidKey
    }
    let headerBytes = try canonical(envelope.header)
    let shared = try agreer.sharedSecret(with: ephemeralPub)
    var opened: [String: Data] = [:]
    for wrap in mine {
      guard
        let section = envelope.sections.first(where: { $0.name == wrap.section }),
        let wrapped = Data(base64Encoded: wrap.wrappedKey),
        let ciphertext = Data(base64Encoded: section.ct)
      else { throw CryptoCoreError.invalidEnvelope("missing section \(wrap.section)") }
      do {
        let wrapKey = wrappingKey(shared: shared, header: envelope.header, recipientId: recipientId, section: wrap.section)
        let keyBytes = try ChaChaPoly.open(try ChaChaPoly.SealedBox(combined: wrapped), using: wrapKey, authenticating: aad(headerBytes, wrap.section))
        let plaintext = try ChaChaPoly.open(try ChaChaPoly.SealedBox(combined: ciphertext), using: SymmetricKey(data: keyBytes), authenticating: aad(headerBytes, wrap.section))
        opened[wrap.section] = plaintext
      } catch {
        throw CryptoCoreError.decryptionFailed
      }
    }
    return opened
  }

  // MARK: - Internals

  static func canonical(_ header: CapsuleHeader) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(header)
  }

  private static func aad(_ headerBytes: Data, _ section: String) -> Data {
    var out = Transcript.lengthPrefixed(headerBytes)
    out.append(Transcript.lengthPrefixed(Data(section.utf8)))
    return out
  }

  private static func wrappingKey(shared: SharedSecret, header: CapsuleHeader, recipientId: String, section: String) -> SymmetricKey {
    shared.hkdfDerivedSymmetricKey(
      using: SHA256.self,
      salt: Data(header.capsuleId.utf8),
      sharedInfo: Data("PULSE-capsule-wrap-v1|\(recipientId)|\(section)".utf8),
      outputByteCount: 32
    )
  }

  /// Unambiguous byte string covering every field of the envelope except the signature itself.
  private static func signingInput(version: Int, headerBytes: Data, ephemeralPub: Data, sections: [CapsuleSection], wraps: [CapsuleKeyWrap]) -> Data {
    var out = Data("PULSE-capsule-sig-v\(version)".utf8)
    out.append(Transcript.lengthPrefixed(headerBytes))
    out.append(Transcript.lengthPrefixed(ephemeralPub))
    out.append(Transcript.lengthPrefixed(Data("\(sections.count)".utf8)))
    for s in sections {
      out.append(Transcript.lengthPrefixed(Data(s.name.utf8)))
      out.append(Transcript.lengthPrefixed(Data(s.ct.utf8)))
    }
    out.append(Transcript.lengthPrefixed(Data("\(wraps.count)".utf8)))
    for w in wraps {
      out.append(Transcript.lengthPrefixed(Data(w.recipientId.utf8)))
      out.append(Transcript.lengthPrefixed(Data(w.section.utf8)))
      out.append(Transcript.lengthPrefixed(Data(w.wrappedKey.utf8)))
    }
    return out
  }
}
