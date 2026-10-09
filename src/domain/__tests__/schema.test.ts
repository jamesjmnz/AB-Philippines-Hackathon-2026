import { CLAIM_FIELDS, ClaimFieldSchema, PROVENANCE_TAGS } from '../claims';
import { DisclosurePolicySchema } from '../disclosure';
import {
  ADDED_EVENT_TYPES,
  CORE_EVENT_TYPES,
  DomainEventSchema,
  EVENT_TYPES,
  EventBatchSchema,
  type DomainEvent,
} from '../events';
import { OutboxMessageSchema, PacketReceiptSchema, retryDelayMs } from '../outbox';
import { TrustedPeerSchema } from '../people';
import { fullScenario } from '../testing/fixtures';

const FORBIDDEN = ['severity', 'priority', 'diagnosis', 'triage', 'medicalSeverity', 'urgency', 'injury', 'treatment'];

describe('vocabulary', () => {
  it('has exactly the 20 specified event names plus the two documented additions', () => {
    expect(CORE_EVENT_TYPES).toEqual([
      'INCIDENT_CREATED',
      'REPORT_ADDED',
      'AI_PROPOSAL_CREATED',
      'CLARIFICATION_REQUESTED',
      'CLAIM_CONFIRMED',
      'CONFLICT_FLAGGED',
      'CONFLICT_RESOLVED',
      'CAPSULE_PREPARED',
      'CAPSULE_QUEUED',
      'PACKET_SENT_ATTEMPT',
      'PACKET_RECEIVED_BY_PEER',
      'RESPONDER_ACKNOWLEDGED',
      'TASK_OFFERED',
      'TASK_ACCEPTED',
      'TASK_DECLINED',
      'TASK_PROGRESS_REPORTED',
      'TASK_COMPLETION_REPORTED',
      'TASK_COMPLETION_CONFIRMED',
      'INCIDENT_RESOLVED',
      'INCIDENT_CANCELLED',
    ]);
    expect(ADDED_EVENT_TYPES).toEqual(['CLARIFICATION_SKIPPED', 'RESPONDER_DECLINED']);
    expect(new Set(DomainEventSchema.options.map((o) => o.shape.type.value))).toEqual(new Set(EVENT_TYPES));
  });

  it('claim fields and tags are the agreed set', () => {
    expect(CLAIM_FIELDS).toEqual(['incidentType', 'building', 'floor', 'locationText', 'symptom', 'assistanceRequested']);
    expect(PROVENANCE_TAGS).toEqual(['user_reported', 'ai_proposed', 'user_confirmed', 'responder_reported', 'unresolved', 'unknown']);
  });
});

describe('no severity, priority or diagnosis anywhere (invariant 2)', () => {
  const { events } = fullScenario();

  it('every event of the scenario is schema-valid as produced', () => {
    for (const event of events) expect(DomainEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejects a forbidden key on the envelope and on every payload', () => {
    for (const event of events) {
      for (const key of FORBIDDEN) {
        expect(DomainEventSchema.safeParse({ ...event, [key]: 'high' }).success).toBe(false);
        expect(DomainEventSchema.safeParse({ ...event, payload: { ...event.payload, [key]: 'high' } }).success).toBe(false);
      }
    }
  });

  it('rejects a forbidden key inside nested claim, finding, receipt, policy and recipient objects', () => {
    const pick = <T extends DomainEvent['type']>(type: T) => {
      const found = events.find((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
      if (!found) throw new Error(`fixture: no ${type}`);
      return found;
    };
    const report = pick('REPORT_ADDED');
    const proposal = pick('AI_PROPOSAL_CREATED');
    const receipt = pick('PACKET_RECEIVED_BY_PEER');
    const capsule = pick('CAPSULE_PREPARED');
    const created = pick('INCIDENT_CREATED');
    const accepted = pick('TASK_ACCEPTED');

    const nested: unknown[] = [
      { ...report, payload: { ...report.payload, claims: report.payload.claims.map((c) => ({ ...c, severity: 'high' })) } },
      { ...proposal, payload: { ...proposal.payload, findings: proposal.payload.findings.map((f) => ({ ...f, diagnosis: 'sprain' })) } },
      { ...receipt, payload: { ...receipt.payload, receipt: { ...receipt.payload.receipt, priority: 1 } } },
      { ...capsule, payload: { ...capsule.payload, policy: { ...capsule.payload.policy, severity: 'high' } } },
      { ...created, payload: { ...created.payload, recipients: created.payload.recipients.map((r) => ({ ...r, priority: 1 })) } },
      { ...accepted, payload: { ...accepted.payload, assignee: { ...accepted.payload.assignee, triage: 'red' } } },
      { ...created, actor: { ...created.actor, severity: 'high' } },
      { ...created, clock: { ...created.clock, priority: 1 } },
    ];
    for (const candidate of nested) expect(DomainEventSchema.safeParse(candidate).success).toBe(false);
  });

  it('has no claim field for them, so neither a human nor an AI can state one', () => {
    for (const key of FORBIDDEN) expect(ClaimFieldSchema.safeParse(key).success).toBe(false);
    const report = events.find((e) => e.type === 'REPORT_ADDED');
    const proposal = events.find((e) => e.type === 'AI_PROPOSAL_CREATED');
    expect(
      DomainEventSchema.safeParse({
        ...report,
        payload: { ...report?.payload, claims: [{ field: 'severity', value: 'high', extraction: 'explicit' }] },
      }).success,
    ).toBe(false);
    expect(
      DomainEventSchema.safeParse({
        ...proposal,
        payload: { ...proposal?.payload, findings: [{ findingId: 'f', field: 'diagnosis', value: 'sprain' }] },
      }).success,
    ).toBe(false);
  });

  it('the other contracts are strict too', () => {
    const outbox = fullScenario().outbox[0];
    expect(OutboxMessageSchema.safeParse(outbox).success).toBe(true);
    expect(OutboxMessageSchema.safeParse({ ...outbox, priority: 1 }).success).toBe(false);
    expect(TrustedPeerSchema.safeParse({ deviceId: 'd', userName: 'n', level: 'trusted', severity: 1 }).success).toBe(false);
    expect(TrustedPeerSchema.safeParse({ deviceId: 'd', userName: 'n', level: 'owner' }).success).toBe(false);
    expect(DisclosurePolicySchema.safeParse({ shareDetailedLocation: true, shareSymptoms: true, recipients: [], shareSeverity: true }).success).toBe(false);
    expect(PacketReceiptSchema.safeParse({ receiptId: 'r', packetId: 'p', recipientDeviceId: 'd', diagnosis: 'x' }).success).toBe(false);
    expect(EventBatchSchema.safeParse({ version: 2, incidentId: 'i', fromDeviceId: 'd', events: [] }).success).toBe(false);
  });
});

describe('event envelope', () => {
  const { events } = fullScenario();
  const sample = events[0];

  it.each([
    ['unknown type', { type: 'INCIDENT_ESCALATED' }],
    ['empty id', { id: '' }],
    ['missing actor device', { actor: { userName: 'x' } }],
    ['zero lamport', { clock: { seq: 1, lamport: 0, wallClockMs: 1 } }],
    ['fractional seq', { clock: { seq: 1.5, lamport: 1, wallClockMs: 1 } }],
    ['parents not an array', { parents: 'evt-1' }],
    ['payload of another type', { payload: { taskId: 't' } }],
    ['malformed signature', { signature: { alg: 'ed25519' } }],
  ])('rejects %s', (_name, patch) => {
    expect(DomainEventSchema.safeParse({ ...sample, ...patch }).success).toBe(false);
  });

  it('accepts signature metadata', () => {
    expect(DomainEventSchema.safeParse({ ...sample, signature: { alg: 'ed25519', keyId: 'key-1', value: 'c2ln' } }).success).toBe(true);
  });

  it('backoff doubles from 2s and is capped at 60s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 50].map(retryDelayMs)).toEqual([0, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  });
});
