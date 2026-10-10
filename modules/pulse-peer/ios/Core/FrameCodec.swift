import Foundation

/// Length-prefixed framing for the peer stream: 4-byte big-endian length, then that many payload bytes.
/// TCP delivers a byte stream, so frames may arrive split or coalesced; `FrameDecoder` reassembles them.
public enum FrameCodec {
  /// Largest payload accepted; anything bigger is treated as a protocol violation.
  /// Must stay at or above the sync layer's packet cap (`MAX_PACKET_BYTES`, 512 KiB, in `src/sync/packet.ts`).
  public static let maxFrameLength = 1024 * 1024

  public enum FrameError: Error, Equatable {
    case empty
    case tooLarge(Int)
  }

  public static func encode(_ payload: Data) throws -> Data {
    guard !payload.isEmpty else { throw FrameError.empty }
    guard payload.count <= maxFrameLength else { throw FrameError.tooLarge(payload.count) }
    var length = UInt32(payload.count).bigEndian
    var frame = Data(bytes: &length, count: 4)
    frame.append(payload)
    return frame
  }
}

public struct FrameDecoder {
  private var buffer = Data()

  public init() {}

  /// Feeds received bytes and returns every complete frame now available, in order.
  public mutating func append(_ chunk: Data) throws -> [Data] {
    buffer.append(chunk)
    var frames: [Data] = []
    while buffer.count >= 4 {
      let length = buffer.prefix(4).reduce(0) { ($0 << 8) | Int($1) }
      guard length > 0 else { throw FrameCodec.FrameError.empty }
      guard length <= FrameCodec.maxFrameLength else { throw FrameCodec.FrameError.tooLarge(length) }
      guard buffer.count >= 4 + length else { break }
      let start = buffer.startIndex + 4
      frames.append(Data(buffer[start..<(start + length)]))
      buffer = Data(buffer[(start + length)...])
    }
    return frames
  }
}

/// First frame each side sends after connecting. It only names the device; it proves nothing.
/// Identity is established by signatures checked in the app layer, never by this message.
public struct PeerHello: Codable, Equatable {
  public static let protocolVersion = 1
  public let v: Int
  public let deviceId: String

  public init(deviceId: String) {
    self.v = PeerHello.protocolVersion
    self.deviceId = deviceId
  }

  public static func isValidDeviceId(_ id: String) -> Bool {
    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
    return id.count >= 8 && id.count <= 64 && id.unicodeScalars.allSatisfy(allowed.contains)
  }
}

/// Both devices may dial each other at the same moment, which leaves two links for one pair.
/// Each side must keep the same one, or each closes the link the other kept and nothing is left.
public enum LinkArbiter {
  /// Whether a newly identified link replaces the one already held for the same peer.
  /// Across directions the link dialed by the lower device id wins; in the same direction the newer one does,
  /// because the older is then a stale connection the peer has already replaced.
  public static func keepsNew(localId: String, peerId: String, newIsOutbound: Bool, existingIsOutbound: Bool) -> Bool {
    if newIsOutbound == existingIsOutbound { return true }
    let localDials = localId < peerId
    return newIsOutbound == localDials
  }
}
