import PulsePeer from '../../modules/pulse-peer';
import { base64ToBytes, bytesToBase64 } from './base64';
import type { PeerTransport } from './types';

/** PeerTransport backed by the Swift Network-framework module. Foreground only. */
export function createNativePeerTransport(): PeerTransport {
  return {
    startDiscovery: (localDeviceId) => PulsePeer.start(localDeviceId),
    stopDiscovery: () => PulsePeer.stop(),
    connect: (peerId) => PulsePeer.connect(peerId),
    disconnect: (peerId) => PulsePeer.disconnect(peerId),
    sendOpaquePacket: (peerId, bytes) => PulsePeer.send(peerId, bytesToBase64(bytes)),
    onPeerFound: (listener) => {
      const sub = PulsePeer.addListener('onPeerFound', (e) => listener(e.peerId));
      return () => sub.remove();
    },
    onPeerLost: (listener) => {
      const sub = PulsePeer.addListener('onPeerLost', (e) => listener(e.peerId));
      return () => sub.remove();
    },
    onConnectionState: (listener) => {
      const sub = PulsePeer.addListener('onConnectionState', (e) => listener(e.peerId, e.state, e.reason));
      return () => sub.remove();
    },
    onOpaquePacket: (listener) => {
      const sub = PulsePeer.addListener('onPacket', (e) => {
        try {
          listener(e.peerId, base64ToBytes(e.data));
        } catch {
          // Undecodable payloads are dropped; the sender keeps the message queued until it gets a receipt.
        }
      });
      return () => sub.remove();
    },
    onError: (listener) => {
      const sub = PulsePeer.addListener('onTransportError', (e) => listener({ code: e.code, message: e.message }));
      return () => sub.remove();
    },
    stop: () => PulsePeer.stop(),
  };
}
