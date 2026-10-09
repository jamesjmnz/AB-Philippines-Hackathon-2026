import { DomainError } from '../errors';
import { DomainEventSchema, type DomainEvent, type EventSpec } from '../events';
import type { OutboxMessage } from '../outbox';
import type { Actor, Clock, IdGenerator } from '../primitives';
import { applyEvents } from '../reducer';
import type { IncidentState } from '../state';

/** Everything a command needs from outside the domain. All of it is injected. */
export interface CommandContext {
  /** The device and person issuing the command. Events are always authored as this actor. */
  actor: Actor;
  clock: Clock;
  ids: IdGenerator;
  /**
   * Optional device-wide sequence counter. Without it the sequence is per device within the
   * incident, which is still monotonic for that device.
   */
  nextSeq?: (deviceId: string) => number;
}

/** What a command returns: events to append, outbox rows to enqueue with them, and the resulting state. */
export interface CommandResult {
  events: DomainEvent[];
  outbox: OutboxMessage[];
  state: IncidentState;
}

/**
 * Builds one event on top of `state`, validates it against the schema and the reducer, and returns
 * it with the state after it. Throws a typed DomainError if the event is malformed or would not apply.
 */
export function buildEvent(
  state: IncidentState,
  ctx: CommandContext,
  spec: EventSpec,
): { event: DomainEvent; state: IncidentState } {
  const deviceId = ctx.actor.deviceId;
  const candidate = {
    id: ctx.ids.next('evt'),
    incidentId: state.incidentId,
    type: spec.type,
    actor: ctx.actor,
    clock: {
      seq: ctx.nextSeq ? ctx.nextSeq(deviceId) : (state.ledger.seqByDevice[deviceId] ?? 0) + 1,
      lamport: state.ledger.maxLamport + 1,
      wallClockMs: ctx.clock.nowMs(),
    },
    parents: [...state.ledger.heads],
    payload: spec.payload,
  };
  const parsed = DomainEventSchema.safeParse(candidate);
  if (!parsed.success) throw new DomainError('invalid_event', candidate.id);
  const event = parsed.data;
  const next = applyEvents(state, [event]);
  const refused = next.notApplied.find((n) => n.eventId === event.id);
  if (refused) throw new DomainError(refused.code, event.id);
  return { event, state: next };
}

/** Builds several events in sequence, each on the state left by the previous one. */
export function buildEvents(
  state: IncidentState,
  ctx: CommandContext,
  specs: readonly EventSpec[],
  outbox: OutboxMessage[] = [],
): CommandResult {
  const events: DomainEvent[] = [];
  let current = state;
  for (const spec of specs) {
    const built = buildEvent(current, ctx, spec);
    events.push(built.event);
    current = built.state;
  }
  return { events, outbox, state: current };
}
