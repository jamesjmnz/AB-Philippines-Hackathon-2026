import CryptoKit
import ExpoModulesCore
import Foundation

struct RecipientRecord: Record {
  @Field var deviceId: String = ""
  @Field var agreeKey: String = ""
  @Field var sections: [String] = []
}

struct SectionRecord: Record {
  @Field var name: String = ""
  /// UTF-8 plaintext for this section.
  @Field var text: String = ""
}

struct HeaderRecord: Record {
  @Field var capsuleId: String = ""
  @Field var incidentRef: String = ""
  @Field var createdAtMs: Double = 0
  @Field var expiresAtMs: Double = 0
  @Field var hopLimit: Int = 0
}

/// JS bridge for identity, pairing and capsule crypto. Private keys never cross this boundary,
/// and nothing here logs plaintext or key material.
public class PulseCryptoModule: Module {
  private let store = KeyStore()

  public func definition() -> ModuleDefinition {
    Name("PulseCrypto")

    AsyncFunction("createOrLoadIdentity") { () -> [String: Any] in
      let identity = try self.store.loadOrCreate()
      return ["deviceId": identity.material.deviceId, "hardwareBacked": identity.hardwareBacked]
    }

    AsyncFunction("exportPublicPairingMaterial") { () -> String in
      try Self.json(try self.store.loadOrCreate().material)
    }

    /// Validates a peer's pairing material and returns the code both people must compare.
    AsyncFunction("verifyPeerPairing") { (peerMaterialJson: String) -> [String: Any] in
      let peer = try Self.decode(PairingMaterial.self, peerMaterialJson)
      _ = try peer.validated()
      let mine = try self.store.loadOrCreate().material
      guard peer.deviceId != mine.deviceId else { throw CryptoCoreError.invalidPairingMaterial }
      return ["deviceId": peer.deviceId, "code": DeviceIdentity.pairingCode(mine, peer)]
    }

    AsyncFunction("encryptForRecipients") { (header: HeaderRecord, sections: [SectionRecord], recipients: [RecipientRecord]) -> String in
      let identity = try self.store.loadOrCreate()
      let coreRecipients = try recipients.map { r -> CapsuleRecipient in
        guard let data = Data(base64Encoded: r.agreeKey), let key = try? P256.KeyAgreement.PublicKey(x963Representation: data) else {
          throw CryptoCoreError.invalidKey
        }
        return CapsuleRecipient(deviceId: r.deviceId, agreeKey: key, sections: r.sections)
      }
      let envelope = try CapsuleCore.seal(
        header: CapsuleHeader(
          capsuleId: header.capsuleId,
          incidentRef: header.incidentRef,
          senderId: identity.material.deviceId,
          createdAtMs: Int64(header.createdAtMs),
          expiresAtMs: Int64(header.expiresAtMs),
          hopLimit: header.hopLimit
        ),
        sections: sections.map { ($0.name, Data($0.text.utf8)) },
        recipients: coreRecipients,
        signer: identity.signer
      )
      return try Self.json(envelope)
    }

    /// Signature, sender, version and expiry only. This is all a relay-only device can do with a capsule.
    AsyncFunction("verifyEnvelope") { (envelopeJson: String, senderMaterialJson: String, nowMs: Double) -> Bool in
      let envelope = try Self.decode(CapsuleEnvelope.self, envelopeJson)
      let sender = try Self.decode(PairingMaterial.self, senderMaterialJson)
      try CapsuleCore.verify(envelope, senderSignKey: try sender.validated().sign, expectedSenderId: sender.deviceId, nowMs: Int64(nowMs))
      return true
    }

    AsyncFunction("decryptAuthorized") { (envelopeJson: String, senderMaterialJson: String, nowMs: Double) -> [String: String] in
      let identity = try self.store.loadOrCreate()
      let envelope = try Self.decode(CapsuleEnvelope.self, envelopeJson)
      let sender = try Self.decode(PairingMaterial.self, senderMaterialJson)
      let opened = try CapsuleCore.open(
        envelope,
        recipientId: identity.material.deviceId,
        agreer: identity.agreer,
        senderSignKey: try sender.validated().sign,
        expectedSenderId: sender.deviceId,
        nowMs: Int64(nowMs)
      )
      return opened.mapValues { String(decoding: $0, as: UTF8.self) }
    }

    AsyncFunction("signEvent") { (canonicalText: String) -> String in
      try self.store.loadOrCreate().signer.signature(for: Data(canonicalText.utf8)).base64EncodedString()
    }

    AsyncFunction("verifyEventSignature") { (canonicalText: String, signatureBase64: String, signerMaterialJson: String) -> Bool in
      let signer = try Self.decode(PairingMaterial.self, signerMaterialJson)
      guard
        let raw = Data(base64Encoded: signatureBase64),
        let signature = try? P256.Signing.ECDSASignature(rawRepresentation: raw)
      else { return false }
      return try signer.validated().sign.isValidSignature(signature, for: Data(canonicalText.utf8))
    }

    AsyncFunction("resetIdentity") {
      self.store.reset()
    }
  }

  private static func json<T: Encodable>(_ value: T) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return String(decoding: try encoder.encode(value), as: UTF8.self)
  }

  private static func decode<T: Decodable>(_ type: T.Type, _ text: String) throws -> T {
    do {
      return try JSONDecoder().decode(type, from: Data(text.utf8))
    } catch {
      throw CryptoCoreError.invalidEnvelope("malformed JSON")
    }
  }
}
