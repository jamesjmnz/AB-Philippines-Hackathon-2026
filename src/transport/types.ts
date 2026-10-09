export type PeerConnectionState = 'connecting' | 'connected' | 'disconnected';

export type TransportError = { code: string; message: string };

export type Unsubscribe = () => void;

/**
 * Moves opaque bytes between nearby devices. It knows nothing about incidents, trust or encryption.
 * `sendOpaquePacket` resolving means the bytes were handed to the radio stack: a send attempt.
 * Delivery is only ever established by a signed receipt handled in the sync layer.
 */
export interface PeerTransport {
  /** Starts advertising and browsing. Triggers the iOS Local Network prompt on first use. */
  startDiscovery(localDeviceId: string): Promise<void>;
  stopDiscovery(): Promise<void>;
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  sendOpaquePacket(peerId: string, bytes: Uint8Array): Promise<void>;
  onPeerFound(listener: (peerId: string) => void): Unsubscribe;
  onPeerLost(listener: (peerId: string) => void): Unsubscribe;
  onConnectionState(listener: (peerId: string, state: PeerConnectionState, reason: string | null) => void): Unsubscribe;
  onOpaquePacket(listener: (peerId: string, bytes: Uint8Array) => void): Unsubscribe;
  onError(listener: (error: TransportError) => void): Unsubscribe;
  stop(): Promise<void>;
}
