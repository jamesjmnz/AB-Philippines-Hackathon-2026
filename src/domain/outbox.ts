import { z } from 'zod';

import { IdSchema, EventSignatureSchema } from './primitives';

/**
 * App-level receipt created by the recipient device after it validated and persisted a packet.
 * A transport send completion is not a receipt.
 */
export const PacketReceiptSchema = z.strictObject({
  receiptId: IdSchema,
  packetId: IdSchema,
  recipientDeviceId: IdSchema,
  receivedAtMs: z.number().int().nonnegative().optional(),
  signature: EventSignatureSchema.optional(),
});
export type PacketReceipt = z.infer<typeof PacketReceiptSchema>;

export const OUTBOX_KINDS = ['basic_alert', 'capsule', 'event_sync'] as const;
export const OUTBOX_STATUSES = ['pending', 'receipted', 'cancelled', 'expired'] as const;

/** One outbound packet. The packet id is stable across retries so the receiver can deduplicate. */
export const OutboxMessageSchema = z.strictObject({
  packetId: IdSchema,
  incidentId: IdSchema,
  recipientDeviceId: IdSchema,
  kind: z.enum(OUTBOX_KINDS),
  /** Ledger events this packet carries. Content is read from the ledger at send time. */
  eventIds: z.array(IdSchema).max(500),
  capsuleId: IdSchema.nullable(),
  status: z.enum(OUTBOX_STATUSES),
  attempts: z.number().int().nonnegative(),
  createdAtMs: z.number().int().nonnegative(),
  lastAttemptAtMs: z.number().int().nonnegative().nullable(),
  nextRetryAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative().nullable(),
  receiptId: IdSchema.nullable(),
});
export type OutboxMessage = z.infer<typeof OutboxMessageSchema>;
export type OutboxKind = OutboxMessage['kind'];
export type OutboxStatus = OutboxMessage['status'];

/** A packet id this device has already accepted. Used only for duplicate suppression. */
export const InboxMessageSchema = z.strictObject({
  packetId: IdSchema,
  incidentId: IdSchema.nullable(),
  fromDeviceId: IdSchema.nullable(),
  receivedAtMs: z.number().int().nonnegative(),
});
export type InboxMessage = z.infer<typeof InboxMessageSchema>;

/**
 * What a peer is known to hold for one incident: a version vector of per-device sequence numbers.
 * `seqByDevice[d] = n` means the peer holds every event of this incident authored by `d` with seq <= n.
 */
export const SyncCursorSchema = z.strictObject({
  peerDeviceId: IdSchema,
  incidentId: IdSchema,
  seqByDevice: z.record(IdSchema, z.number().int().nonnegative()),
  updatedAtMs: z.number().int().nonnegative(),
});
export type SyncCursor = z.infer<typeof SyncCursorSchema>;

export const OUTBOX_BACKOFF_BASE_MS = 2_000;
export const OUTBOX_BACKOFF_MAX_MS = 60_000;

/** Delay before the next retry after `attempts` send attempts: 2s, 4s, 8s ... capped at 60s. */
export function retryDelayMs(attempts: number): number {
  if (attempts <= 0) return 0;
  const exponent = Math.min(attempts - 1, 16);
  return Math.min(OUTBOX_BACKOFF_BASE_MS * 2 ** exponent, OUTBOX_BACKOFF_MAX_MS);
}

export function newOutboxMessage(input: {
  packetId: string;
  incidentId: string;
  recipientDeviceId: string;
  kind: OutboxKind;
  eventIds: readonly string[];
  capsuleId?: string | null;
  createdAtMs: number;
  expiresAtMs?: number | null;
}): OutboxMessage {
  return {
    packetId: input.packetId,
    incidentId: input.incidentId,
    recipientDeviceId: input.recipientDeviceId,
    kind: input.kind,
    eventIds: [...input.eventIds],
    capsuleId: input.capsuleId ?? null,
    status: 'pending',
    attempts: 0,
    createdAtMs: input.createdAtMs,
    lastAttemptAtMs: null,
    nextRetryAtMs: input.createdAtMs,
    expiresAtMs: input.expiresAtMs ?? null,
    receiptId: null,
  };
}
