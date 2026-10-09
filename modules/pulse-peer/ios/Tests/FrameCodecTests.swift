import XCTest
@testable import PulsePeerCore

final class FrameCodecTests: XCTestCase {
  func testRoundTripSingleFrame() throws {
    let payload = Data("hello".utf8)
    var decoder = FrameDecoder()
    XCTAssertEqual(try decoder.append(try FrameCodec.encode(payload)), [payload])
  }

  func testSplitAcrossChunks() throws {
    let payload = Data((0..<1000).map { UInt8($0 % 251) })
    let frame = try FrameCodec.encode(payload)
    var decoder = FrameDecoder()
    XCTAssertEqual(try decoder.append(frame.prefix(2)), [])
    XCTAssertEqual(try decoder.append(frame.dropFirst(2).prefix(500)), [])
    XCTAssertEqual(try decoder.append(frame.dropFirst(502)), [payload])
  }

  func testCoalescedFramesKeepOrder() throws {
    let a = Data("first".utf8), b = Data("second".utf8), c = Data("third".utf8)
    var stream = Data()
    for p in [a, b, c] { stream.append(try FrameCodec.encode(p)) }
    var decoder = FrameDecoder()
    XCTAssertEqual(try decoder.append(stream), [a, b, c])
  }

  func testRejectsOversizedDeclaredLength() {
    var decoder = FrameDecoder()
    let header = Data([0x7F, 0xFF, 0xFF, 0xFF])
    XCTAssertThrowsError(try decoder.append(header)) { error in
      XCTAssertEqual(error as? FrameCodec.FrameError, .tooLarge(0x7FFF_FFFF))
    }
  }

  func testRejectsEmptyAndOversizedPayloads() {
    XCTAssertThrowsError(try FrameCodec.encode(Data()))
    XCTAssertThrowsError(try FrameCodec.encode(Data(count: FrameCodec.maxFrameLength + 1)))
    var decoder = FrameDecoder()
    XCTAssertThrowsError(try decoder.append(Data([0, 0, 0, 0])))
  }

  func testHelloValidation() throws {
    XCTAssertTrue(PeerHello.isValidDeviceId("dev-ab12cd34"))
    XCTAssertFalse(PeerHello.isValidDeviceId("short"))
    XCTAssertFalse(PeerHello.isValidDeviceId("has spaces in it"))
    let hello = PeerHello(deviceId: "dev-ab12cd34")
    let decoded = try JSONDecoder().decode(PeerHello.self, from: JSONEncoder().encode(hello))
    XCTAssertEqual(decoded, hello)
    XCTAssertEqual(decoded.v, 1)
  }
}
