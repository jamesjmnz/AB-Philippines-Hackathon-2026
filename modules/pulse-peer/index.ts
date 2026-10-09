import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

export type PeerConnectionState = 'connecting' | 'connected' | 'disconnected';

export type PulsePeerEvents = {
  onPeerFound: (event: { peerId: string }) => void;
  onPeerLost: (event: { peerId: string }) => void;
  onConnectionState: (event: { peerId: string; state: PeerConnectionState; reason: string | null }) => void;
  onPacket: (event: { peerId: string; data: string }) => void;
  onTransportError: (event: { code: string; message: string }) => void;
};

export type PulsePeerNativeModule = {
  start(deviceId: string): Promise<void>;
  stop(): Promise<void>;
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  /** Resolves when the bytes were handed to the network stack. This is a send attempt, not a delivery. */
  send(peerId: string, base64: string): Promise<void>;
  snapshot(): { running: boolean; localId: string; discovered: string[]; connected: string[] };
  addListener<K extends keyof PulsePeerEvents>(event: K, listener: PulsePeerEvents[K]): EventSubscription;
};

export default requireNativeModule<PulsePeerNativeModule>('PulsePeer');
