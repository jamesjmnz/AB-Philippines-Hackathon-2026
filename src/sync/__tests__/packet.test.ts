import { createFakeCapsuleCrypto, createFakeCryptoRealm } from '@/crypto/testing';
import { bytesToUtf8, utf8ToBytes } from '@/transport/base64';

import { MAX_PACKET_BYTES, PacketTooLargeError, capsuleIdFor, decodePacket, encodePacket, incidentRefFor, type Packet } from '../packet';
import { pairingTranscript } from '../pairing';
import { RelayStore } from '../relay';
import { receiptCanonicalText } from '../SyncEngine';

async function sealedPacket(): Promise<Packet> {
  const realm = createFakeCryptoRealm();
  const sender = createFakeCapsuleCrypto(realm, 'sender');
  const recipient = await createFakeCapsuleCrypto(realm, 'recipient').exportPublicPairingMaterial();
  const sealed = await sender.encryptForRecipients({
    capsuleId: capsuleIdFor('pkt-1'),
    incidentRef: incidentRefFor('inc-1'),
    createdAtMs: 1,
    expiresAtMs: 2,
    hopLimit: 2,
    sections: { summary: 'secret words' },
    recipients: [{ material: recipient, sections: ['summary'] }],
  });
  if (!sealed.ok) throw new Error('seal failed');
  return { v: 1, packetId: 'pkt-1', kind: 'capsule', hops: 0, to: recipient.deviceId, envelope: sealed.value };
}

describe('packet wire format', () => {
  it('round-trips a sealed packet and exposes only routing metadata', async () => {
    const packet = await sealedPacket();
    const bytes = encodePacket(packet);
    const text = bytesToUtf8(bytes);
    expect(text).not.toContain('secret words');
    const decoded = decodePacket(bytes);
    expect(decoded).toEqual({ ok: true, packet });
    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual(['envelope', 'hops', 'kind', 'packetId', 'to', 'v']);
  });

  it('rejects unknown versions, unknown kinds, extra fields, bad recipients and non-JSON', async () => {
    const packet = await sealedPacket();
    const mutate = (change: Record<string, unknown>) => decodePacket(utf8ToBytes(JSON.stringify({ ...packet, ...change })));
    expect(mutate({ v: 2 })).toEqual({ ok: false, reason: 'invalid_shape' });
    expect(mutate({ kind: 'gossip' })).toEqual({ ok: false, reason: 'invalid_shape' });
    expect(mutate({ note: 'plaintext rides along' })).toEqual({ ok: false, reason: 'invalid_shape' });
    expect(mutate({ to: 'Mika Santos' })).toEqual({ ok: false, reason: 'invalid_shape' });
    expect(mutate({ hops: -1 })).toEqual({ ok: false, reason: 'invalid_shape' });
    expect(mutate({ envelope: undefined })).toEqual({ ok: false, reason: 'invalid_shape' });
    expect(decodePacket(utf8ToBytes('{'))).toEqual({ ok: false, reason: 'not_json' });
    expect(decodePacket(new Uint8Array(MAX_PACKET_BYTES + 1))).toEqual({ ok: false, reason: 'too_large' });
  });

  it('refuses to encode an oversized packet', async () => {
    const packet = await sealedPacket();
    if (packet.kind !== 'capsule') throw new Error('expected capsule');
    const huge: Packet = { ...packet, envelope: { ...packet.envelope, sections: [{ name: 'summary', ct: 'x'.repeat(MAX_PACKET_BYTES) }] } };
    expect(() => encodePacket(huge)).toThrow(PacketTooLargeError);
  });

  it('accepts the three pairing packets and nothing sealed inside them', () => {
    const to = 'dev-0123456789abcdef0123';
    const hello = { v: 1, packetId: 'p1', kind: 'pair_hello', hops: 0, to, pairing: { material: { v: 1, deviceId: to, signKey: 's'.repeat(40), agreeKey: 'a'.repeat(40) }, name: 'Mika' } };
    expect(decodePacket(utf8ToBytes(JSON.stringify(hello))).ok).toBe(true);
    expect(decodePacket(utf8ToBytes(JSON.stringify({ v: 1, packetId: 'p2', kind: 'pair_confirm', hops: 0, to, pairing: { signature: 'sig-12345678' } }))).ok).toBe(true);
    expect(decodePacket(utf8ToBytes(JSON.stringify({ v: 1, packetId: 'p3', kind: 'pair_cancel', hops: 0, to }))).ok).toBe(true);
    expect(decodePacket(utf8ToBytes(JSON.stringify({ ...hello, pairing: { ...hello.pairing, report: 'my leg hurts' } }))).ok).toBe(false);
  });

  it('derives stable header ids', () => {
    expect(capsuleIdFor('pkt-alex-0001')).toBe('pkt-alex-0001');
    expect(capsuleIdFor('p1')).toHaveLength(8);
    expect(incidentRefFor('i')).toHaveLength(8);
    expect(incidentRefFor('x'.repeat(100))).toHaveLength(64);
    const a = { v: 1 as const, deviceId: 'dev-a', signKey: 'sa', agreeKey: 'aa' };
    const b = { v: 1 as const, deviceId: 'dev-b', signKey: 'sb', agreeKey: 'ab' };
    expect(pairingTranscript(a, b, '123456')).toBe(pairingTranscript(b, a, '123456'));
    expect(pairingTranscript(a, b, '123456')).not.toBe(pairingTranscript(a, b, '123457'));
    expect(receiptCanonicalText({ receiptId: 'r', packetId: 'p', recipientDeviceId: 'd', receivedAtMs: 5 })).toBe('pulse-receipt-v1|r|p|d|5');
  });
});

describe('relay store', () => {
  const entry = (packetId: string, expiresAtMs = 100) => ({ packetId, kind: 'capsule' as const, to: 'dev-c', origin: 'dev-a', receivedFrom: 'dev-a', expiresAtMs, json: '{"opaque":true}' });
  const memoryKv = () => {
    const data = new Map<string, string>();
    return {
      data,
      get: async (key: string) => data.get(key) ?? null,
      set: async (key: string, value: string) => void data.set(key, value),
      remove: async (key: string) => void data.delete(key),
    };
  };

  it('keeps one copy per packet id, survives a reload, drops expired entries and caps its size', async () => {
    const kv = memoryKv();
    const store = new RelayStore(kv, 2);
    await store.put(entry('p1'));
    await store.put(entry('p1'));
    expect(store.list()).toHaveLength(1);
    await store.put(entry('p2', 10));

    const reloaded = new RelayStore(kv, 2);
    await reloaded.load();
    expect(reloaded.list().map((p) => p.packetId)).toEqual(['p1', 'p2']);
    await reloaded.purgeExpired(50);
    expect(reloaded.list().map((p) => p.packetId)).toEqual(['p1']);

    await reloaded.put(entry('p3'));
    await reloaded.put(entry('p4'));
    expect(reloaded.list().map((p) => p.packetId)).toEqual(['p3', 'p4']);
    await reloaded.remove('p3');
    expect(reloaded.has('p3')).toBe(false);
  });

  it('starts empty when the stored queue is corrupt', async () => {
    const kv = memoryKv();
    kv.data.set('relay.queue', '{not json');
    const store = new RelayStore(kv, 5);
    await store.load();
    expect(store.list()).toEqual([]);
  });
});
