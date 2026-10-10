import type { CapsuleCrypto, PairingMaterial } from '@/crypto/types';
import { pairingMaterialSchema } from '@/crypto/types';
import { NameSchema } from '@/domain';

import type { PairingPacket } from './packet';
import type { PeerRecord, SyncFailureCode, Timers } from './types';

/**
 * Pairing over the local transport.
 *
 *   A -> B  pair_hello   { material, name }        public keys only
 *   B -> A  pair_hello   { material, name }
 *   both    verifyPeerPairing(peer material) -> the same six-digit code on both phones
 *   human   compares the code and confirms on their own phone
 *   X -> Y  pair_confirm { signature }             signEvent over the pairing transcript
 *
 * A peer is stored as trusted only when this device's human confirmed AND a valid confirmation
 * signed by the peer's key arrived. The display name in `pair_hello` is a label, never identity.
 *
 * A confirmation can be lost, leaving one phone finished and the other waiting. The waiting side
 * repeats its `pair_confirm` (retry tick, link back up); the finished side checks the repeat against
 * the key material it stored and answers with its own confirmation, marked `answer` so that the
 * exchange ends there. Answering changes nothing on the device that answers.
 */

export type PairingStage = 'compare' | 'awaiting_peer' | 'failed';

export interface PairingView {
  peerDeviceId: string;
  peerName: string;
  code: string;
  stage: PairingStage;
  error: string | null;
}

interface Session {
  peerId: string;
  peerName: string;
  material: PairingMaterial | null;
  code: string;
  localConfirmed: boolean;
  peerConfirmed: boolean;
  helloSent: boolean;
  /** True when this device's human started the pairing. Only then is a failure surfaced. */
  initiated: boolean;
  stage: PairingStage | 'waiting_hello';
  error: SyncFailureCode | null;
}

export interface PairingDeps {
  crypto: CapsuleCrypto;
  timers: Timers;
  /** This device's id and display name, or null while the identity is unavailable. */
  self(): { deviceId: string; name: string } | null;
  /** Opens a link if there is none. Rejects when the peer cannot be reached. */
  connect(peerId: string): Promise<void>;
  send(peerId: string, packet: PairingPacket): Promise<void>;
  nextPacketId(): string;
  /** Called once both sides have confirmed. */
  trust(record: PeerRecord): Promise<void>;
  /** The stored record of a device this one already trusts. */
  trusted(peerId: string): PeerRecord | undefined;
  nowMs(): number;
  changed(): void;
  helloTimeoutMs: number;
}

export type PairingResult = { ok: true } | { ok: false; code: SyncFailureCode };

export function pairingTranscript(a: PairingMaterial, b: PairingMaterial, code: string): string {
  const parts = [a, b].map((m) => `${m.deviceId}:${m.signKey}:${m.agreeKey}`).sort();
  return `pulse-pair-v1|${parts.join('|')}|${code}`;
}

function confirmationText(transcript: string, confirmerId: string): string {
  return `${transcript}|confirmed-by|${confirmerId}`;
}

export class PairingManager {
  private session: Session | null = null;
  private helloWaiters: ((ok: boolean) => void)[] = [];

  constructor(private readonly deps: PairingDeps) {}

  view(): PairingView | null {
    const s = this.session;
    if (!s || s.stage === 'waiting_hello') return null;
    return { peerDeviceId: s.peerId, peerName: s.peerName, code: s.code, stage: s.stage, error: s.error };
  }

  private setFailed(code: SyncFailureCode): void {
    if (!this.session) return;
    this.session = { ...this.session, stage: 'failed', error: code, localConfirmed: false, peerConfirmed: false };
    this.resolveHello(false);
    this.deps.changed();
  }

  private resolveHello(ok: boolean): void {
    const waiters = this.helloWaiters;
    this.helloWaiters = [];
    for (const w of waiters) w(ok);
  }

  private async sendHello(peerId: string): Promise<boolean> {
    const self = this.deps.self();
    if (!self) return false;
    try {
      const material = await this.deps.crypto.exportPublicPairingMaterial();
      await this.deps.send(peerId, {
        v: 1,
        packetId: this.deps.nextPacketId(),
        kind: 'pair_hello',
        hops: 0,
        to: peerId,
        pairing: { material, name: self.name },
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Starts pairing with a discovered device and waits (bounded) for its key material. */
  async start(peerId: string): Promise<PairingResult> {
    if (!this.deps.self()) return { ok: false, code: 'identity_unavailable' };
    if (this.session && this.session.stage !== 'failed' && this.session.peerId !== peerId) {
      return { ok: false, code: 'pairing_busy' };
    }
    if (this.session && this.session.peerId === peerId && this.session.stage !== 'failed') return { ok: true };
    this.session = {
      peerId,
      peerName: '',
      material: null,
      code: '',
      localConfirmed: false,
      peerConfirmed: false,
      helloSent: false,
      initiated: true,
      stage: 'waiting_hello',
      error: null,
    };
    try {
      await this.deps.connect(peerId);
    } catch {
      this.session = null;
      return { ok: false, code: 'peer_unreachable' };
    }
    const current: Session | null = this.session;
    if (!current || current.peerId !== peerId) return { ok: false, code: 'pairing_cancelled' };
    if (current.stage !== 'waiting_hello') return current.stage === 'failed' ? { ok: false, code: current.error ?? 'pairing_cancelled' } : { ok: true };
    current.helloSent = true;
    if (!(await this.sendHello(peerId))) {
      if (this.session?.peerId === peerId) this.session = null;
      return { ok: false, code: 'pairing_send_failed' };
    }
    const after: Session | null = this.session;
    if (!after || after.peerId !== peerId) return { ok: false, code: 'pairing_cancelled' };
    if (after.stage === 'failed') return { ok: false, code: after.error ?? 'pairing_cancelled' };
    if (after.stage !== 'waiting_hello') return { ok: true };

    const answered = await new Promise<boolean>((resolve) => {
      const timer = this.deps.timers.setTimeout(() => resolve(false), this.deps.helloTimeoutMs);
      this.helloWaiters.push((ok) => {
        this.deps.timers.clearTimeout(timer);
        resolve(ok);
      });
    });
    const final: Session | null = this.session;
    if (answered && final && final.peerId === peerId && final.stage !== 'failed') return { ok: true };
    if (final && final.peerId === peerId && final.stage === 'failed') return { ok: false, code: final.error ?? 'pairing_cancelled' };
    if (final && final.peerId === peerId && final.stage === 'waiting_hello') this.session = null;
    return { ok: false, code: 'pairing_no_response' };
  }

  /** This device's human confirms that both phones show the same code. */
  async confirm(): Promise<PairingResult> {
    const s = this.session;
    const self = this.deps.self();
    if (!s || !s.material || s.stage !== 'compare' || !self) return { ok: false, code: 'pairing_no_session' };
    try {
      await this.sendConfirm(self.deviceId, s.peerId, s.material, s.code, false);
    } catch {
      return { ok: false, code: 'pairing_send_failed' };
    }
    if (this.session !== s) return { ok: false, code: 'pairing_cancelled' };
    s.localConfirmed = true;
    if (s.peerConfirmed) {
      await this.finish(s);
    } else {
      s.stage = 'awaiting_peer';
      this.deps.changed();
    }
    return { ok: true };
  }

  /** Signs and sends this device's confirmation of the pairing with `material` under `code`. */
  private async sendConfirm(selfId: string, peerId: string, material: PairingMaterial, code: string, answer: boolean): Promise<void> {
    const mine = await this.deps.crypto.exportPublicPairingMaterial();
    const signature = await this.deps.crypto.signEvent(confirmationText(pairingTranscript(mine, material, code), selfId));
    await this.deps.send(peerId, {
      v: 1,
      packetId: this.deps.nextPacketId(),
      kind: 'pair_confirm',
      hops: 0,
      to: peerId,
      pairing: { signature, ...(answer ? { answer: true as const } : {}) },
    });
  }

  /**
   * Repeats this device's confirmation while it is still waiting for the peer's: the peer may have
   * finished without its own confirmation ever arriving here. With `peerId`, only for that peer.
   */
  async resendConfirm(peerId?: string): Promise<void> {
    const s = this.session;
    const self = this.deps.self();
    if (!s || !s.material || !self || s.stage !== 'awaiting_peer' || !s.localConfirmed) return;
    if (peerId !== undefined && s.peerId !== peerId) return;
    try {
      await this.sendConfirm(self.deviceId, s.peerId, s.material, s.code, false);
    } catch {
      // Not reachable right now; the next tick or reconnect tries again.
    }
  }

  /**
   * A confirmation arrived from a device this one already finished pairing with. If it is that
   * device's valid confirmation of the same pairing (same stored keys, same code), this device's own
   * confirmation is sent again. Nothing is stored or changed here, whatever the packet says.
   */
  private async answerCompleted(fromPeer: string, signature: string): Promise<void> {
    const record = this.deps.trusted(fromPeer);
    const self = this.deps.self();
    if (!record || !self || record.material.deviceId !== fromPeer) return;
    try {
      const verified = await this.deps.crypto.verifyPeerPairing(record.material);
      if (!verified.ok || verified.value.deviceId !== fromPeer) return;
      const mine = await this.deps.crypto.exportPublicPairingMaterial();
      const text = confirmationText(pairingTranscript(mine, record.material, verified.value.code), fromPeer);
      if (!(await this.deps.crypto.verifyEventSignature(text, signature, record.material))) return;
      await this.sendConfirm(self.deviceId, fromPeer, record.material, verified.value.code, true);
    } catch {
      // The waiting side repeats its confirmation.
    }
  }

  async cancel(): Promise<void> {
    const s = this.session;
    this.session = null;
    this.resolveHello(false);
    this.deps.changed();
    if (!s || s.stage === 'failed') return;
    try {
      await this.deps.send(s.peerId, { v: 1, packetId: this.deps.nextPacketId(), kind: 'pair_cancel', hops: 0, to: s.peerId });
    } catch {
      // The other side simply never finishes.
    }
  }

  private async finish(s: Session): Promise<void> {
    if (!s.material) return;
    this.session = null;
    await this.deps.trust({
      deviceId: s.peerId,
      name: s.peerName,
      level: 'trusted',
      material: s.material,
      pairedAtMs: this.deps.nowMs(),
    });
    this.deps.changed();
  }

  /** Handles a pairing packet from the transport peer `fromPeer`. */
  async handle(fromPeer: string, packet: PairingPacket): Promise<void> {
    if (packet.kind === 'pair_hello') return this.onHello(fromPeer, packet.pairing.material, packet.pairing.name);
    if (packet.kind === 'pair_confirm') return this.onConfirm(fromPeer, packet.pairing.signature, packet.pairing.answer === true);
    const s = this.session;
    if (s && s.peerId === fromPeer) {
      if (s.initiated || s.localConfirmed) this.setFailed('pairing_cancelled');
      else {
        this.session = null;
        this.deps.changed();
      }
    }
  }

  private async onHello(fromPeer: string, rawMaterial: PairingMaterial, rawName: string): Promise<void> {
    const self = this.deps.self();
    if (!self) return;
    const existing = this.session;
    if (existing && existing.peerId !== fromPeer && existing.stage !== 'failed') return;
    const mine = existing && existing.peerId === fromPeer ? existing : null;

    const material = pairingMaterialSchema.safeParse(rawMaterial);
    const name = NameSchema.safeParse(rawName.trim());
    // The link the hello arrived on must belong to the device the material names.
    if (!material.success || !name.success || material.data.deviceId !== fromPeer) {
      if (mine?.initiated) this.setFailed('pairing_material_mismatch');
      return;
    }
    let verified;
    try {
      verified = await this.deps.crypto.verifyPeerPairing(material.data);
    } catch {
      verified = null;
    }
    if (this.session !== existing) return;
    if (!verified || !verified.ok || verified.value.deviceId !== fromPeer) {
      if (mine?.initiated) this.setFailed('pairing_material_mismatch');
      return;
    }
    if (mine && mine.material && (mine.material.signKey !== material.data.signKey || mine.material.agreeKey !== material.data.agreeKey)) {
      this.setFailed('pairing_material_changed');
      return;
    }
    if (mine && mine.stage !== 'waiting_hello' && mine.stage !== 'failed') return;

    const session: Session = {
      peerId: fromPeer,
      peerName: name.data,
      material: material.data,
      code: verified.value.code,
      localConfirmed: false,
      peerConfirmed: false,
      helloSent: mine?.helloSent ?? false,
      initiated: mine?.initiated ?? false,
      stage: 'compare',
      error: null,
    };
    this.session = session;
    this.resolveHello(true);
    this.deps.changed();
    if (!session.helloSent) {
      session.helloSent = true;
      await this.sendHello(fromPeer);
    }
  }

  private async onConfirm(fromPeer: string, signature: string, isAnswer: boolean): Promise<void> {
    const s = this.session;
    if (!s || s.peerId !== fromPeer) {
      // No pairing in progress with this device. It may be repeating a confirmation this side never answered.
      if (!isAnswer) await this.answerCompleted(fromPeer, signature);
      return;
    }
    if (!s.material || (s.stage !== 'compare' && s.stage !== 'awaiting_peer')) return;
    let valid = false;
    try {
      const mine = await this.deps.crypto.exportPublicPairingMaterial();
      valid = await this.deps.crypto.verifyEventSignature(
        confirmationText(pairingTranscript(mine, s.material, s.code), fromPeer),
        signature,
        s.material,
      );
    } catch {
      valid = false;
    }
    if (this.session !== s) return;
    if (!valid) {
      this.setFailed('pairing_bad_confirmation');
      return;
    }
    s.peerConfirmed = true;
    if (s.localConfirmed) await this.finish(s);
  }
}
