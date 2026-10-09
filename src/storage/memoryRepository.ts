import { createIncidentRepository, type IncidentRepository } from './incidentRepository';
import { createMemoryStore } from './memoryStore';

/** Repository for the Demo store. Same rules as the SQLite repository; data lives only in memory. */
export function createMemoryIncidentRepository(): IncidentRepository {
  return createIncidentRepository(createMemoryStore());
}
