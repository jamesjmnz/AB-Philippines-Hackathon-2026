import Foundation
import Network

/// Callbacks from the transport. All are invoked on the service's private queue.
protocol PeerServiceDelegate: AnyObject {
  func peerService(didFind peerId: String)
  func peerService(didLose peerId: String)
  func peerService(peerId: String, didChange state: String, reason: String?)
  func peerService(peerId: String, didReceive payload: Data)
  func peerService(didFail code: String, message: String)
}

/// Foreground-only local transport: Bonjour advertise + browse, TCP with peer-to-peer Wi-Fi allowed.
/// It moves opaque bytes between devices running PULSE and makes no trust decision: the device id in the
/// hello frame is a routing hint, and everything security-relevant is verified by the app layer.
final class PeerService {
  static let serviceType = "_sagip-sos._tcp"
  private static let maxConnections = 8

  weak var delegate: PeerServiceDelegate?

  private let queue = DispatchQueue(label: "app.pulse.peer")
  private var localId = ""
  private var listener: NWListener?
  private var browser: NWBrowser?
  private var discovered: [String: NWEndpoint] = [:]
  private var links: [String: PeerLink] = [:]
  /// Connections that have not completed the hello exchange yet.
  private var pending: [ObjectIdentifier: PeerLink] = [:]
  private var running = false

  func start(localId: String) throws {
    guard PeerHello.isValidDeviceId(localId) else {
      throw NSError(domain: "PulsePeer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid device id"])
    }
    try queue.sync {
      if running { stopLocked() }
      self.localId = localId
      running = true
      try startListener()
      startBrowser()
    }
  }

  func stop() {
    queue.sync { stopLocked() }
  }

  func connect(peerId: String) {
    queue.async { self.connectLocked(peerId: peerId) }
  }

  func disconnect(peerId: String) {
    queue.async {
      self.links[peerId]?.cancel()
    }
  }

  /// Completes when the bytes were handed to the network stack. That is a send attempt, not a delivery.
  func send(peerId: String, payload: Data, completion: @escaping (Error?) -> Void) {
    queue.async {
      guard let link = self.links[peerId], link.isReady else {
        completion(NSError(domain: "PulsePeer", code: 2, userInfo: [NSLocalizedDescriptionKey: "Peer is not connected"]))
        return
      }
      link.send(payload, completion: completion)
    }
  }

  func snapshot() -> [String: Any] {
    queue.sync {
      [
        "running": running,
        "localId": localId,
        "discovered": Array(discovered.keys).sorted(),
        "connected": links.filter { $0.value.isReady }.map { $0.key }.sorted(),
      ]
    }
  }

  // MARK: - Private (queue only)

  private func parameters() -> NWParameters {
    let tcp = NWProtocolTCP.Options()
    tcp.enableKeepalive = true
    tcp.keepaliveIdle = 10
    tcp.noDelay = true
    let params = NWParameters(tls: nil, tcp: tcp)
    // Allows AWDL / peer-to-peer Wi-Fi so two iPhones can connect with no access point and no internet.
    params.includePeerToPeer = true
    return params
  }

  private func startListener() throws {
    let listener = try NWListener(using: parameters())
    listener.service = NWListener.Service(name: localId, type: PeerService.serviceType)
    listener.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .failed(let error):
        self.delegate?.peerService(didFail: "listener_failed", message: error.localizedDescription)
      case .waiting(let error):
        self.delegate?.peerService(didFail: Self.permissionCode(error) ?? "listener_waiting", message: error.localizedDescription)
      default:
        break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in
      self?.adopt(connection, outbound: false, expectedPeer: nil)
    }
    listener.start(queue: queue)
    self.listener = listener
  }

  private func startBrowser() {
    let browser = NWBrowser(for: .bonjour(type: PeerService.serviceType, domain: nil), using: parameters())
    browser.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .failed(let error):
        self.delegate?.peerService(didFail: "browser_failed", message: error.localizedDescription)
      case .waiting(let error):
        self.delegate?.peerService(didFail: Self.permissionCode(error) ?? "browser_waiting", message: error.localizedDescription)
      default:
        break
      }
    }
    browser.browseResultsChangedHandler = { [weak self] results, _ in
      self?.updateDiscovered(results)
    }
    browser.start(queue: queue)
    self.browser = browser
  }

  /// Local network privacy denial surfaces as a DNS-SD "policy denied" error.
  private static func permissionCode(_ error: NWError) -> String? {
    if case .dns(let code) = error, code == kDNSServiceErr_PolicyDenied { return "local_network_denied" }
    return nil
  }

  private func updateDiscovered(_ results: Set<NWBrowser.Result>) {
    var next: [String: NWEndpoint] = [:]
    for result in results {
      if case .service(let name, _, _, _) = result.endpoint, name != localId, PeerHello.isValidDeviceId(name) {
        next[name] = result.endpoint
      }
    }
    for id in next.keys where discovered[id] == nil { delegate?.peerService(didFind: id) }
    for id in discovered.keys where next[id] == nil { delegate?.peerService(didLose: id) }
    discovered = next
  }

  private func connectLocked(peerId: String) {
    guard running, links[peerId] == nil else { return }
    guard let endpoint = discovered[peerId] else {
      delegate?.peerService(peerId: peerId, didChange: "disconnected", reason: "not_discovered")
      return
    }
    // Both sides see each other at about the same time. Only the lower id dials, so there is one link per pair.
    guard localId < peerId else { return }
    guard links.count + pending.count < PeerService.maxConnections else {
      delegate?.peerService(didFail: "too_many_connections", message: "Connection limit reached")
      return
    }
    delegate?.peerService(peerId: peerId, didChange: "connecting", reason: nil)
    adopt(NWConnection(to: endpoint, using: parameters()), outbound: true, expectedPeer: peerId)
  }

  private func adopt(_ connection: NWConnection, outbound: Bool, expectedPeer: String?) {
    guard running, links.count + pending.count < PeerService.maxConnections else {
      connection.cancel()
      return
    }
    let link = PeerLink(connection: connection, localId: localId, expectedPeer: expectedPeer, queue: queue)
    pending[ObjectIdentifier(link)] = link
    link.onIdentified = { [weak self, weak link] peerId in
      guard let self, let link else { return }
      self.pending[ObjectIdentifier(link)] = nil
      if let existing = self.links[peerId], existing !== link { existing.cancel(silent: true) }
      self.links[peerId] = link
      self.delegate?.peerService(peerId: peerId, didChange: "connected", reason: nil)
    }
    link.onPayload = { [weak self] peerId, payload in
      self?.delegate?.peerService(peerId: peerId, didReceive: payload)
    }
    link.onClosed = { [weak self, weak link] peerId, reason in
      guard let self, let link else { return }
      self.pending[ObjectIdentifier(link)] = nil
      if let peerId {
        if self.links[peerId] === link {
          self.links[peerId] = nil
          self.delegate?.peerService(peerId: peerId, didChange: "disconnected", reason: reason)
        }
      } else if let expectedPeer {
        self.delegate?.peerService(peerId: expectedPeer, didChange: "disconnected", reason: reason)
      }
    }
    link.start()
  }

  private func stopLocked() {
    running = false
    listener?.cancel()
    browser?.cancel()
    listener = nil
    browser = nil
    for link in links.values { link.cancel(silent: true) }
    for link in pending.values { link.cancel(silent: true) }
    links.removeAll()
    pending.removeAll()
    discovered.removeAll()
  }
}

/// One framed TCP connection to one peer.
private final class PeerLink {
  var onIdentified: ((String) -> Void)?
  var onPayload: ((String, Data) -> Void)?
  var onClosed: ((String?, String?) -> Void)?

  private let connection: NWConnection
  private let localId: String
  private let expectedPeer: String?
  private let queue: DispatchQueue
  private var decoder = FrameDecoder()
  private var peerId: String?
  private var closed = false
  private var silent = false
  private(set) var isReady = false

  init(connection: NWConnection, localId: String, expectedPeer: String?, queue: DispatchQueue) {
    self.connection = connection
    self.localId = localId
    self.expectedPeer = expectedPeer
    self.queue = queue
  }

  func start() {
    connection.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .ready:
        self.sendHello()
        self.receive()
      case .failed(let error):
        self.close(reason: error.localizedDescription)
      case .waiting(let error):
        // No route yet (peer walked away, radios off). Give up; the app layer keeps the message queued.
        self.close(reason: error.localizedDescription)
      case .cancelled:
        self.close(reason: "cancelled")
      default:
        break
      }
    }
    connection.start(queue: queue)
    // A peer that connects but never identifies itself is dropped.
    queue.asyncAfter(deadline: .now() + 8) { [weak self] in
      guard let self, self.peerId == nil, !self.closed else { return }
      self.close(reason: "hello_timeout")
    }
  }

  func send(_ payload: Data, completion: @escaping (Error?) -> Void) {
    do {
      let frame = try FrameCodec.encode(payload)
      connection.send(content: frame, completion: .contentProcessed { error in completion(error) })
    } catch {
      completion(error)
    }
  }

  func cancel(silent: Bool = false) {
    self.silent = silent
    close(reason: "cancelled")
  }

  private func sendHello() {
    guard let data = try? JSONEncoder().encode(PeerHello(deviceId: localId)), let frame = try? FrameCodec.encode(data) else { return }
    connection.send(content: frame, completion: .contentProcessed { [weak self] error in
      if let error { self?.close(reason: error.localizedDescription) }
    })
  }

  private func receive() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
      guard let self, !self.closed else { return }
      if let data, !data.isEmpty {
        do {
          for frame in try self.decoder.append(data) { self.handle(frame) }
        } catch {
          self.close(reason: "protocol_error")
          return
        }
      }
      if let error {
        self.close(reason: error.localizedDescription)
      } else if isComplete {
        self.close(reason: "closed_by_peer")
      } else {
        self.receive()
      }
    }
  }

  private func handle(_ frame: Data) {
    if let peerId {
      onPayload?(peerId, frame)
      return
    }
    guard
      let hello = try? JSONDecoder().decode(PeerHello.self, from: frame),
      hello.v == PeerHello.protocolVersion,
      PeerHello.isValidDeviceId(hello.deviceId),
      hello.deviceId != localId,
      expectedPeer == nil || expectedPeer == hello.deviceId
    else {
      close(reason: "bad_hello")
      return
    }
    peerId = hello.deviceId
    isReady = true
    onIdentified?(hello.deviceId)
  }

  private func close(reason: String?) {
    guard !closed else { return }
    closed = true
    isReady = false
    connection.stateUpdateHandler = nil
    connection.cancel()
    if !silent { onClosed?(peerId, reason) }
  }
}
