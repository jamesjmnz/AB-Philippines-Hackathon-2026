import CryptoKit
import Foundation

/// Private-key operations, abstracted so Secure Enclave keys and software keys are interchangeable.
public protocol CapsuleSigner {
  var publicKeyX963: Data { get }
  func signature(for data: Data) throws -> Data
}

public protocol CapsuleKeyAgreer {
  var publicKeyX963: Data { get }
  func sharedSecret(with publicKey: P256.KeyAgreement.PublicKey) throws -> SharedSecret
}

public struct SoftwareSigner: CapsuleSigner {
  public let key: P256.Signing.PrivateKey
  public init(key: P256.Signing.PrivateKey = P256.Signing.PrivateKey()) { self.key = key }
  public var publicKeyX963: Data { key.publicKey.x963Representation }
  public func signature(for data: Data) throws -> Data { try key.signature(for: data).rawRepresentation }
}

public struct SoftwareKeyAgreer: CapsuleKeyAgreer {
  public let key: P256.KeyAgreement.PrivateKey
  public init(key: P256.KeyAgreement.PrivateKey = P256.KeyAgreement.PrivateKey()) { self.key = key }
  public var publicKeyX963: Data { key.publicKey.x963Representation }
  public func sharedSecret(with publicKey: P256.KeyAgreement.PublicKey) throws -> SharedSecret {
    try key.sharedSecretFromKeyAgreement(with: publicKey)
  }
}

public enum CryptoCoreError: Error, Equatable {
  case invalidKey
  case invalidPairingMaterial
  case invalidEnvelope(String)
  case unsupportedVersion(Int)
  case expired
  case badSignature
  case senderMismatch
  case notARecipient
  case decryptionFailed
}

/// What one device shows another during pairing. Contains public keys only.
public struct PairingMaterial: Codable, Equatable {
  public static let version = 1
  public let v: Int
  public let deviceId: String
  public let signKey: String
  public let agreeKey: String

  public init(signKeyX963: Data, agreeKeyX963: Data) {
    self.v = PairingMaterial.version
    self.signKey = signKeyX963.base64EncodedString()
    self.agreeKey = agreeKeyX963.base64EncodedString()
    self.deviceId = DeviceIdentity.deviceId(signKeyX963: signKeyX963, agreeKeyX963: agreeKeyX963)
  }

  /// Checks structure, that both keys are valid P-256 points, and that the device id is derived from them.
  public func validated() throws -> (sign: P256.Signing.PublicKey, agree: P256.KeyAgreement.PublicKey) {
    guard v == PairingMaterial.version, let s = Data(base64Encoded: signKey), let a = Data(base64Encoded: agreeKey) else {
      throw CryptoCoreError.invalidPairingMaterial
    }
    guard let sign = try? P256.Signing.PublicKey(x963Representation: s), let agree = try? P256.KeyAgreement.PublicKey(x963Representation: a) else {
      throw CryptoCoreError.invalidKey
    }
    guard DeviceIdentity.deviceId(signKeyX963: s, agreeKeyX963: a) == deviceId else { throw CryptoCoreError.invalidPairingMaterial }
    return (sign, agree)
  }
}

public enum DeviceIdentity {
  /// Pseudonymous device id: a hash of the device's public keys. It names a key pair, not a person.
  public static func deviceId(signKeyX963: Data, agreeKeyX963: Data) -> String {
    var hasher = SHA256()
    hasher.update(data: Data("PULSE-device-id-v1".utf8))
    hasher.update(data: Transcript.lengthPrefixed(signKeyX963))
    hasher.update(data: Transcript.lengthPrefixed(agreeKeyX963))
    return "dev-" + hasher.finalize().prefix(10).map { String(format: "%02x", $0) }.joined()
  }

  /// Six-digit code both people read aloud. It commits to both devices' keys, so a device that substituted
  /// its own keys in transit produces a different code on each phone.
  public static func pairingCode(_ a: PairingMaterial, _ b: PairingMaterial) -> String {
    let ordered = [a, b].sorted { $0.deviceId < $1.deviceId }
    var hasher = SHA256()
    hasher.update(data: Data("PULSE-pairing-code-v1".utf8))
    for m in ordered {
      hasher.update(data: Transcript.lengthPrefixed(Data(m.deviceId.utf8)))
      hasher.update(data: Transcript.lengthPrefixed(Data(base64Encoded: m.signKey) ?? Data()))
      hasher.update(data: Transcript.lengthPrefixed(Data(base64Encoded: m.agreeKey) ?? Data()))
    }
    let digest = Array(hasher.finalize())
    let number = digest.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) } % 1_000_000
    return String(format: "%06d", number)
  }
}

enum Transcript {
  static func lengthPrefixed(_ data: Data) -> Data {
    var length = UInt32(data.count).bigEndian
    var out = Data(bytes: &length, count: 4)
    out.append(data)
    return out
  }
}

/// Stable, content-free descriptions. The JS adapter maps these names to typed failure reasons.
extension CryptoCoreError: LocalizedError {
  public var errorDescription: String? {
    switch self {
    case .invalidKey: return "invalidKey"
    case .invalidPairingMaterial: return "invalidPairingMaterial"
    case .invalidEnvelope(let detail): return "invalidEnvelope: \(detail)"
    case .unsupportedVersion(let v): return "unsupportedVersion: \(v)"
    case .expired: return "expired"
    case .badSignature: return "badSignature"
    case .senderMismatch: return "senderMismatch"
    case .notARecipient: return "notARecipient"
    case .decryptionFailed: return "decryptionFailed"
    }
  }
}
