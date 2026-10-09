import type { DomainEvent, EventOrigin, InboxMessage, OutboxMessage, OutboxStatus, SyncCursor } from '@/domain';

export interface QuarantinedEvent {
  incidentId: string | null;
  eventId: string | null;
  stage: string;
  /** JSON of what was received, truncated. Never logged. */
  body: string;
  receivedAtMs: number;
}

/**
 * Row-level persistence. Two implementations (SQLite and in-memory) sit under one repository, so
 * the Demo store and the real store share every rule.
 */
export interface LedgerStore {
  transaction<T>(fn: (tx: LedgerStore) => Promise<T>): Promise<T>;
  /** Insert-or-ignore by event id. Returns false when the id was already stored. */
  insertEvent(event: DomainEvent, origin: EventOrigin): Promise<boolean>;
  eventsFor(incidentId: string): Promise<DomainEvent[]>;
  incidentIds(): Promise<string[]>;
  /** Insert-or-ignore by packet id. */
  insertOutbox(message: OutboxMessage): Promise<boolean>;
  getOutbox(packetId: string): Promise<OutboxMessage | null>;
  updateOutbox(message: OutboxMessage): Promise<void>;
  listOutbox(filter: { status?: OutboxStatus; incidentId?: string }): Promise<OutboxMessage[]>;
  /** Insert-or-ignore by packet id. */
  insertInbox(message: InboxMessage): Promise<boolean>;
  getCursor(peerDeviceId: string, incidentId: string): Promise<SyncCursor | null>;
  putCursor(cursor: SyncCursor): Promise<void>;
  insertQuarantine(entry: QuarantinedEvent): Promise<void>;
  listQuarantine(): Promise<QuarantinedEvent[]>;
  reset(): Promise<void>;
}
