import { createIncidentRepository, type IncidentRepository } from './incidentRepository';
import { migrate } from './migrations';
import type { SqlDriver } from './sqlDriver';
import { createSqliteStore } from './sqliteStore';

/** Runs pending migrations and returns a repository over the driver. `nowMs` is only recorded in the migrations table. */
export async function createSqliteIncidentRepository(
  driver: SqlDriver,
  nowMs: () => number = () => 0,
): Promise<IncidentRepository> {
  await migrate(driver, nowMs());
  return createIncidentRepository(createSqliteStore(driver, nowMs));
}
