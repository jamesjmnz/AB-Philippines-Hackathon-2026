import CryptoKit
import XCTest
@testable import PulseCryptoCore

final class CapsuleCoreTests: XCTestCase {
  struct Device {
    let signer = SoftwareSigner()
    let agreer = SoftwareKeyAgreer()
    var material: PairingMaterial { PairingMaterial(signKeyX963: signer.publicKeyX963, agreeKeyX963: agreer.publicKeyX963) }
    var id: String { material.deviceId }
    var signPub: P256.Signing.PublicKey { signer.key.publicKey }
    var agreePub: P256.KeyAgreement.PublicKey { agreer.key.publicKey }
  }

  let alex = Device(), mika = Device(), noah = Device(), relay = Device(), stranger = Device()
  let summary = Data("{\"type\":\"slip\",\"building\":\"Building B\"}".utf8)
  let detail = Data("{\"symptom\":\"masakit paa ko\"}".utf8)
  let now: Int64 = 1_800_000_000_000

  func header(expiresIn: Int64 = 3_600_000) -> CapsuleHeader {
    CapsuleHeader(capsuleId: "cap-1", incidentRef: "inc-ref-1", senderId: alex.id, createdAtMs: now, expiresAtMs: now + expiresIn, hopLimit: 2)
  }

  func sealed(expiresIn: Int64 = 3_600_000) throws -> CapsuleEnvelope {
    try CapsuleCore.seal(
      header: header(expiresIn: expiresIn),
      sections: [("summary", summary), ("detail", detail)],
      recipients: [
        CapsuleRecipient(deviceId: mika.id, agreeKey: mika.agreePub, sections: ["summary"]),
        CapsuleRecipient(deviceId: noah.id, agreeKey: noah.agreePub, sections: ["summary", "detail"]),
        CapsuleRecipient(deviceId: relay.id, agreeKey: relay.agreePub, sections: []),
      ],
      signer: alex.signer
    )
  }

  func open(_ e: CapsuleEnvelope, as d: Device, at time: Int64? = nil, sender: Device? = nil) throws -> [String: Data] {
    let s = sender ?? alex
    return try CapsuleCore.open(e, recipientId: d.id, agreer: d.agreer, senderSignKey: s.signPub, expectedSenderId: s.id, nowMs: time ?? now + 1000)
  }

  func testTrustedRecipientReadsOnlySummary() throws {
    let opened = try open(try sealed(), as: mika)
    XCTAssertEqual(opened, ["summary": summary])
  }

  func testAuthorizedRecipientReadsSummaryAndDetail() throws {
    let opened = try open(try sealed(), as: noah)
    XCTAssertEqual(opened, ["summary": summary, "detail": detail])
  }

  func testRelayOnlyCannotDecryptButCanVerify() throws {
    let e = try sealed()
    XCTAssertNoThrow(try CapsuleCore.verify(e, senderSignKey: alex.signPub, expectedSenderId: alex.id, nowMs: now))
    XCTAssertThrowsError(try open(e, as: relay)) { XCTAssertEqual($0 as? CryptoCoreError, .notARecipient) }
    XCTAssertFalse(e.wraps.contains { $0.recipientId == relay.id })
  }

  func testEnvelopeContainsNoPlaintext() throws {
    let json = String(decoding: try JSONEncoder().encode(try sealed()), as: UTF8.self)
    for secret in ["Building B", "masakit", "slip", summary.base64EncodedString(), detail.base64EncodedString()] {
      XCTAssertFalse(json.contains(secret), "envelope leaked \(secret)")
    }
  }

  func testTrustedRecipientCannotUseAnotherRecipientsDetailWrap() throws {
    let e = try sealed()
    let stolen = e.wraps.filter { $0.recipientId == noah.id && $0.section == "detail" }.map {
      CapsuleKeyWrap(recipientId: mika.id, section: $0.section, wrappedKey: $0.wrappedKey)
    }
    let forged = CapsuleEnvelope(v: e.v, header: e.header, ephemeralKey: e.ephemeralKey, sections: e.sections, wraps: e.wraps + stolen, signature: e.signature)
    XCTAssertThrowsError(try open(forged, as: mika)) { XCTAssertEqual($0 as? CryptoCoreError, .badSignature) }
  }

  func testWrongKeyCannotOpen() throws {
    let e = try sealed()
    let impostor = Device()
    XCTAssertThrowsError(
      try CapsuleCore.open(e, recipientId: mika.id, agreer: impostor.agreer, senderSignKey: alex.signPub, expectedSenderId: alex.id, nowMs: now)
    ) { XCTAssertEqual($0 as? CryptoCoreError, .decryptionFailed) }
  }

  func testTamperedCiphertextIsRejected() throws {
    let e = try sealed()
    var bytes = Data(base64Encoded: e.sections[0].ct)!
    bytes[bytes.count - 1] ^= 0x01
    let sections = [CapsuleSection(name: e.sections[0].name, ct: bytes.base64EncodedString())] + e.sections.dropFirst()
    let tampered = CapsuleEnvelope(v: e.v, header: e.header, ephemeralKey: e.ephemeralKey, sections: Array(sections), wraps: e.wraps, signature: e.signature)
    XCTAssertThrowsError(try open(tampered, as: noah)) { XCTAssertEqual($0 as? CryptoCoreError, .badSignature) }
  }

  func testTamperedHeaderIsRejected() throws {
    let e = try sealed()
    let longer = CapsuleHeader(capsuleId: e.header.capsuleId, incidentRef: e.header.incidentRef, senderId: e.header.senderId, createdAtMs: e.header.createdAtMs, expiresAtMs: e.header.expiresAtMs + 86_400_000, hopLimit: 9)
    let tampered = CapsuleEnvelope(v: e.v, header: longer, ephemeralKey: e.ephemeralKey, sections: e.sections, wraps: e.wraps, signature: e.signature)
    XCTAssertThrowsError(try open(tampered, as: noah)) { XCTAssertEqual($0 as? CryptoCoreError, .badSignature) }
  }

  func testExpiredCapsuleIsRejected() throws {
    let e = try sealed(expiresIn: 1000)
    XCTAssertThrowsError(try open(e, as: noah, at: now + 1001)) { XCTAssertEqual($0 as? CryptoCoreError, .expired) }
  }

  func testUntrustedSenderIsRejected() throws {
    let forged = try CapsuleCore.seal(
      header: header(), sections: [("summary", summary)],
      recipients: [CapsuleRecipient(deviceId: mika.id, agreeKey: mika.agreePub, sections: ["summary"])],
      signer: stranger.signer
    )
    // Header claims Alex, but it was signed by a key Mika has not paired with.
    XCTAssertThrowsError(try open(forged, as: mika)) { XCTAssertEqual($0 as? CryptoCoreError, .badSignature) }
    XCTAssertThrowsError(try open(forged, as: mika, sender: stranger)) { XCTAssertEqual($0 as? CryptoCoreError, .senderMismatch) }
  }

  func testVersionDowngradeIsRejected() throws {
    let e = try sealed()
    let other = CapsuleEnvelope(v: 0, header: e.header, ephemeralKey: e.ephemeralKey, sections: e.sections, wraps: e.wraps, signature: e.signature)
    XCTAssertThrowsError(try open(other, as: noah)) { XCTAssertEqual($0 as? CryptoCoreError, .unsupportedVersion(0)) }
  }

  func testEachSealUsesFreshKeys() throws {
    let a = try sealed(), b = try sealed()
    XCTAssertNotEqual(a.ephemeralKey, b.ephemeralKey)
    XCTAssertNotEqual(a.sections[0].ct, b.sections[0].ct)
  }

  func testPairingCodeMatchesOnBothSidesAndDetectsKeySubstitution() throws {
    XCTAssertEqual(DeviceIdentity.pairingCode(alex.material, mika.material), DeviceIdentity.pairingCode(mika.material, alex.material))
    XCTAssertEqual(DeviceIdentity.pairingCode(alex.material, mika.material).count, 6)
    // A device in the middle that swaps in its own keys gives each phone a different code.
    XCTAssertNotEqual(DeviceIdentity.pairingCode(alex.material, stranger.material), DeviceIdentity.pairingCode(stranger.material, mika.material))
  }

  func testPairingMaterialValidation() throws {
    XCTAssertNoThrow(try alex.material.validated())
    let json = try JSONEncoder().encode(alex.material)
    var dict = try JSONSerialization.jsonObject(with: json) as! [String: Any]
    dict["deviceId"] = mika.id
    let spoofed = try JSONDecoder().decode(PairingMaterial.self, from: JSONSerialization.data(withJSONObject: dict))
    XCTAssertThrowsError(try spoofed.validated()) { XCTAssertEqual($0 as? CryptoCoreError, .invalidPairingMaterial) }
    dict["deviceId"] = alex.id
    dict["agreeKey"] = Data("not a key".utf8).base64EncodedString()
    let broken = try JSONDecoder().decode(PairingMaterial.self, from: JSONSerialization.data(withJSONObject: dict))
    XCTAssertThrowsError(try broken.validated())
  }

  func testDeviceIdIsStableAndTransportSafe() {
    XCTAssertEqual(alex.id, alex.material.deviceId)
    XCTAssertTrue(alex.id.hasPrefix("dev-"))
    XCTAssertEqual(alex.id.count, 24)
    XCTAssertNotEqual(alex.id, mika.id)
  }
}
