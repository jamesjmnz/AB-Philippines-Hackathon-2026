import { createMemoryHub } from '@/transport/testing';
import type { PeerTransport } from '@/transport/types';

async function drain(hub: ReturnType<typeof createMemoryHub>): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await hub.idle();
    await Promise.resolve();
  }
}

function listen(transport: PeerTransport) {
  const log = { found: [] as string[], lost: [] as string[], states: [] as string[], packets: [] as string[] };
  transport.onPeerFound((id) => log.found.push(id));
  transport.onPeerLost((id) => log.lost.push(id));
  transport.onConnectionState((id, state, reason) => log.states.push(`${id}:${state}:${reason ?? ''}`));
  transport.onOpaquePacket((id, bytes) => log.packets.push(`${id}:${Array.from(bytes).join(',')}`));
  return log;
}

describe('in-memory transport hub', () => {
  it('discovers, connects, delivers bytes and reports a cut link', async () => {
    const hub = createMemoryHub();
    const a = hub.createTransport();
    const b = hub.createTransport();
    const la = listen(a);
    const lb = listen(b);
    await a.startDiscovery('A');
    await b.startDiscovery('B');
    await drain(hub);
    expect(la.found).toEqual(['B']);
    expect(lb.found).toEqual(['A']);

    await expect(a.sendOpaquePacket('B', new Uint8Array([1]))).rejects.toThrow('not_connected');
    await a.connect('B');
    await drain(hub);
    expect(la.states).toEqual(['B:connected:']);
    expect(lb.states).toEqual(['A:connected:']);

    const payload = new Uint8Array([1, 2, 3]);
    await a.sendOpaquePacket('B', payload);
    payload[0] = 9;
    await drain(hub);
    expect(lb.packets).toEqual(['A:1,2,3']);

    hub.setLink('A', 'B', false);
    await drain(hub);
    expect(la.states).toContain('B:disconnected:link_lost');
    expect(la.lost).toEqual(['B']);
    await expect(a.connect('B')).rejects.toThrow('peer_unreachable');
    await expect(a.sendOpaquePacket('B', new Uint8Array([1]))).rejects.toThrow('not_connected');

    hub.setLink('A', 'B', true);
    await drain(hub);
    expect(la.found).toEqual(['B', 'B']);
  });

  it('drops, duplicates, holds and reorders per direction, and lets tests tap and inject', async () => {
    const hub = createMemoryHub();
    const a = hub.createTransport();
    const b = hub.createTransport();
    const lb = listen(b);
    const la = listen(a);
    const tapped: string[] = [];
    hub.tap((from, to, bytes) => tapped.push(`${from}>${to}:${bytes[0]}`));
    await a.startDiscovery('A');
    await b.startDiscovery('B');
    await a.connect('B');

    hub.setFault('A', 'B', { drop: true });
    await a.sendOpaquePacket('B', new Uint8Array([1]));
    await b.sendOpaquePacket('A', new Uint8Array([7]));
    await drain(hub);
    expect(lb.packets).toEqual([]);
    expect(la.packets).toEqual(['B:7']);

    hub.setFault('A', 'B', { duplicate: true });
    await a.sendOpaquePacket('B', new Uint8Array([2]));
    await drain(hub);
    expect(lb.packets).toEqual(['A:2', 'A:2']);

    hub.setFault('A', 'B', { hold: true });
    await a.sendOpaquePacket('B', new Uint8Array([3]));
    await a.sendOpaquePacket('B', new Uint8Array([4]));
    await drain(hub);
    expect(lb.packets).toHaveLength(2);
    hub.release('A', 'B', 'reverse');
    await drain(hub);
    expect(lb.packets.slice(2)).toEqual(['A:4', 'A:3']);

    hub.inject('Z', 'B', new Uint8Array([5]));
    await drain(hub);
    expect(lb.packets[4]).toBe('Z:5');
    expect(tapped).toEqual(['A>B:1', 'B>A:7', 'A>B:2', 'A>B:3', 'A>B:4']);
    expect(hub.pending).toBe(0);
  });

  it('starts with every link down when asked to, and stopping a device disconnects its peers', async () => {
    const hub = createMemoryHub({ defaultLinked: false });
    const a = hub.createTransport();
    const b = hub.createTransport();
    const la = listen(a);
    await a.startDiscovery('A');
    await b.startDiscovery('B');
    await drain(hub);
    expect(la.found).toEqual([]);
    expect(hub.isLinked('A', 'B')).toBe(false);
    hub.setLink('A', 'B', true);
    await a.connect('B');
    await drain(hub);
    await b.stop();
    await drain(hub);
    expect(la.states).toEqual(['B:connected:', 'B:disconnected:peer_stopped']);
    expect(la.lost).toEqual(['B']);
  });
});
