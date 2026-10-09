import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { acknowledge } from '@/domain';
import { ALEX, MIKA, fullScenario, makeWorld, shuffled, sosWithPeers } from '@/domain/testing/fixtures';

import { MIGRATIONS, migrate, schemaVersion } from '../migrations';
import { createSqliteIncidentRepository } from '../sqliteRepository';
import { openBetterSqlite, type BetterSqliteHandle } from '../testing/betterSqliteDriver';
import { describeRepositoryContract } from '../testing/repositoryContract';

describeRepositoryContract('SQLite (better-sqlite3 driver)', () => {
  let handle: BetterSqliteHandle | null = null;
  return {
    async open() {
      handle = openBetterSqlite(':memory:');
      return createSqliteIncidentRepository(handle.driver, () => 1);
    },
    async close() {
      handle?.close();
      handle = null;
    },
  };
});

describe('SQLite persistence', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pulse-sqlite-'));
    file = join(dir, 'pulse-test.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('replays to the same state after the database file is closed and reopened', async () => {
    const scenario = fullScenario();

    const first = openBetterSqlite(file);
    const repoA = await createSqliteIncidentRepository(first.driver, () => 1);
    for (const event of shuffled(scenario.events, 4)) await repoA.appendEvents([event], { origin: 'remote' });
    await repoA.enqueue(scenario.outbox);
    await repoA.markSendAttempt(scenario.outbox[0]!.packetId, 50);
    await repoA.recordInbound('pkt-seen');
    const before = await repoA.replay(scenario.incidentId);
    const pendingBefore = await repoA.getPendingOutbox();
    first.close();

    const second = openBetterSqlite(file);
    const repoB = await createSqliteIncidentRepository(second.driver, () => 2);
    const after = await repoB.replay(scenario.incidentId);
    expect(after).toEqual(before);
    expect(after).toEqual(scenario.state);
    expect(JSON.stringify(after)).toBe(JSON.stringify(scenario.state));
    expect(await repoB.allIncidentIds()).toEqual([scenario.incidentId]);
    expect(await repoB.getPendingOutbox()).toEqual(pendingBefore);
    expect(pendingBefore.find((m) => m.packetId === scenario.outbox[0]!.packetId)).toMatchObject({ attempts: 1 });
    expect(await repoB.recordInbound('pkt-seen')).toBe('duplicate');
    second.close();
  });

  it('a manual SOS survives a restart before anything else happened', async () => {
    const world = makeWorld();
    const sos = sosWithPeers(world, []);
    const first = openBetterSqlite(file);
    await (await createSqliteIncidentRepository(first.driver)).commit(sos);
    first.close();

    const second = openBetterSqlite(file);
    const repo = await createSqliteIncidentRepository(second.driver);
    const state = await repo.replay(sos.incidentId);
    expect(state.incident?.reporter).toEqual(ALEX);
    expect(state.status).toEqual({ status: 'queued', reason: 'no_trusted_peer' });
    // Work continues on the reopened ledger with correct ordering metadata.
    const next = sosWithPeers(makeWorld('second'));
    await repo.commit(next);
    await repo.commit(acknowledge(await repo.replay(next.incidentId), makeWorld('third').as(MIKA)));
    expect((await repo.replay(next.incidentId)).ledger).toMatchObject({ eventCount: 2, maxLamport: 2 });
    second.close();
  });

  it('records migrations once and is safe to run on every start', async () => {
    const handle = openBetterSqlite(file);
    expect(await schemaVersion(handle.driver)).toBe(0);
    expect(await migrate(handle.driver, 10)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(await migrate(handle.driver, 20)).toEqual([]);
    expect(await schemaVersion(handle.driver)).toBe(MIGRATIONS[MIGRATIONS.length - 1]?.version);
    const rows = await handle.driver.all<{ version: number; name: string; applied_at_ms: number }>(
      'SELECT version, name, applied_at_ms FROM schema_migrations ORDER BY version',
    );
    expect(rows).toEqual(MIGRATIONS.map((m) => ({ version: m.version, name: m.name, applied_at_ms: 10 })));
    const tables = await handle.driver.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['events', 'outbox', 'inbox', 'sync_cursors', 'quarantine', 'schema_migrations']),
    );
    handle.close();
  });

  it('the events table is insert-only: UPDATE and DELETE are refused by the database', async () => {
    const handle = openBetterSqlite(file);
    const repo = await createSqliteIncidentRepository(handle.driver);
    const sos = sosWithPeers(makeWorld());
    await repo.commit(sos);

    await expect(handle.driver.run("UPDATE events SET body = '{}' WHERE id = ?", [sos.events[0]!.id])).rejects.toThrow(
      'append-only',
    );
    await expect(handle.driver.run('DELETE FROM events')).rejects.toThrow('append-only');
    expect(await repo.replay(sos.incidentId)).toEqual(sos.state);

    const columns = await handle.driver.all<{ name: string }>('PRAGMA table_info(events)');
    for (const forbidden of ['status', 'severity', 'priority', 'diagnosis']) {
      expect(columns.map((c) => c.name)).not.toContain(forbidden);
    }
    handle.close();
  });

  it('rolls back a driver transaction that throws', async () => {
    const handle = openBetterSqlite(file);
    await migrate(handle.driver, 1);
    await expect(
      handle.driver.transaction(async (tx) => {
        await tx.run('INSERT INTO inbox (packet_id, incident_id, from_device_id, received_at_ms) VALUES (?, ?, ?, ?)', [
          'pkt-1',
          null,
          null,
          1,
        ]);
        throw new Error('synthetic failure');
      }),
    ).rejects.toThrow('synthetic failure');
    expect(await handle.driver.all('SELECT * FROM inbox')).toEqual([]);
    // The driver is usable afterwards.
    await handle.driver.transaction(async (tx) => {
      await tx.run('INSERT INTO inbox (packet_id, incident_id, from_device_id, received_at_ms) VALUES (?, ?, ?, ?)', [
        'pkt-2',
        null,
        null,
        2,
      ]);
    });
    expect(await handle.driver.all('SELECT packet_id FROM inbox')).toEqual([{ packet_id: 'pkt-2' }]);
    handle.close();
  });
});
