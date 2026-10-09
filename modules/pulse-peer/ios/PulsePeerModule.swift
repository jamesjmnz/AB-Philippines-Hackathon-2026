import ExpoModulesCore
import Foundation

/// JS bridge for the local peer transport. Payloads cross the bridge as base64 and are never inspected or logged here.
public class PulsePeerModule: Module, PeerServiceDelegate {
  private let service = PeerService()

  public func definition() -> ModuleDefinition {
    Name("PulsePeer")

    Events("onPeerFound", "onPeerLost", "onConnectionState", "onPacket", "onTransportError")

    OnCreate {
      self.service.delegate = self
    }

    OnDestroy {
      self.service.stop()
    }

    AsyncFunction("start") { (deviceId: String) in
      try self.service.start(localId: deviceId)
    }

    AsyncFunction("stop") {
      self.service.stop()
    }

    AsyncFunction("connect") { (peerId: String) in
      self.service.connect(peerId: peerId)
    }

    AsyncFunction("disconnect") { (peerId: String) in
      self.service.disconnect(peerId: peerId)
    }

    AsyncFunction("send") { (peerId: String, base64: String, promise: Promise) in
      guard let payload = Data(base64Encoded: base64), !payload.isEmpty else {
        promise.reject("ERR_PEER_PAYLOAD", "Payload is not valid base64")
        return
      }
      self.service.send(peerId: peerId, payload: payload) { error in
        if let error {
          promise.reject("ERR_PEER_SEND", error.localizedDescription)
        } else {
          promise.resolve(nil)
        }
      }
    }

    Function("snapshot") { () -> [String: Any] in
      self.service.snapshot()
    }
  }

  func peerService(didFind peerId: String) {
    sendEvent("onPeerFound", ["peerId": peerId])
  }

  func peerService(didLose peerId: String) {
    sendEvent("onPeerLost", ["peerId": peerId])
  }

  func peerService(peerId: String, didChange state: String, reason: String?) {
    sendEvent("onConnectionState", ["peerId": peerId, "state": state, "reason": reason])
  }

  func peerService(peerId: String, didReceive payload: Data) {
    sendEvent("onPacket", ["peerId": peerId, "data": payload.base64EncodedString()])
  }

  func peerService(didFail code: String, message: String) {
    sendEvent("onTransportError", ["code": code, "message": message])
  }
}
