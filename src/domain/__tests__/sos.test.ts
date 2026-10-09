import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { createManualSOS } from '../commands';
import { ALEX, PEERS, makeWorld, sosWithPeers } from '../testing/fixtures';

const DOMAIN_DIR = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

function importsOf(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  return [...source.matchAll(/(?:from|import|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
}

describe('manual SOS (invariants 1 and 12)', () => {
  it('persists with zero recipients, no AI and no transport', () => {
    const world = makeWorld();
    const sos = createManualSOS(world.as(ALEX), { recipients: [] });

    expect(sos.events).toHaveLength(1);
    expect(sos.events[0]?.type).toBe('INCIDENT_CREATED');
    expect(sos.outbox).toEqual([]);
    expect(sos.state.incident?.reporter).toEqual(ALEX);
    expect(sos.state.status).toEqual({ status: 'queued', reason: 'no_trusted_peer' });
    expect(sos.state.aiFindings).toEqual([]);
  });

  it('produces one outbox row per recipient, all pending and due immediately', () => {
    const sos = sosWithPeers(makeWorld());
    expect(sos.outbox.map((m) => m.recipientDeviceId)).toEqual(PEERS.map((p) => p.deviceId));
    expect(new Set(sos.outbox.map((m) => m.packetId)).size).toBe(PEERS.length);
    for (const message of sos.outbox) {
      expect(message).toMatchObject({ status: 'pending', attempts: 0, kind: 'basic_alert', receiptId: null });
      expect(message.eventIds).toEqual([sos.events[0]?.id]);
      expect(message.nextRetryAtMs).toBe(message.createdAtMs);
    }
    expect(sos.state.status).toEqual({ status: 'queued', reason: 'awaiting_peer' });
    expect(sos.state.recipients.every((r) => r.delivery === 'queued' && !r.acknowledged)).toBe(true);
  });

  it('ignores a duplicate recipient and the reporter listed as a recipient', () => {
    const sos = createManualSOS(makeWorld().as(ALEX), {
      recipients: [PEERS[0]!, PEERS[0]!, { ...ALEX, level: 'trusted' }],
    });
    expect(sos.state.recipients.map((r) => r.deviceId)).toEqual([PEERS[0]!.deviceId]);
    expect(sos.outbox).toHaveLength(1);
  });

  it('records what the person did and nothing they did not say', () => {
    const { state } = sosWithPeers(makeWorld());
    expect(state.claims.incidentType).toMatchObject({ value: 'Manual SOS', tag: 'user_reported' });
    expect(state.claims.assistanceRequested).toMatchObject({ value: 'yes', tag: 'user_reported' });
    for (const field of ['building', 'floor', 'locationText', 'symptom'] as const) {
      expect(state.claims[field]).toMatchObject({ value: null, tag: 'unknown', revisions: [] });
    }
  });

  it('createManualSOS reaches only domain modules', () => {
    const imports = importsOf(join(DOMAIN_DIR, 'commands', 'createManualSOS.ts'));
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((i) => i.startsWith('./') || i.startsWith('../'))).toBe(true);
  });

  it('no domain module imports React Native, Expo, AI, transport, crypto or storage', () => {
    const files = sourceFiles(DOMAIN_DIR);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      for (const imported of importsOf(file)) {
        const allowed = imported === 'zod' || imported.startsWith('./') || imported.startsWith('../');
        expect({ file, imported, allowed }).toEqual({ file, imported, allowed: true });
        expect(imported).not.toMatch(/\/(ai|transport|crypto|storage|app|ui)(\/|$)/);
      }
    }
  });
});
