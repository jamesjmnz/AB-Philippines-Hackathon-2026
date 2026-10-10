import { assessmentIdFor } from '../assessments';
import {
  addObservation,
  addReport,
  cancelIncident,
  recordAIProposal,
  recordAssessment,
  resolveIncident,
  type AssessmentInput,
} from '../commands';
import {
  ASSESSMENT_CLASSES,
  ASSESSMENT_FIELD_CLASSES,
  DomainEventSchema,
  type DomainEvent,
  type PayloadOf,
} from '../events';
import { canRecordAIProposal, canRecordAssessment } from '../policy';
import { projectForLevel } from '../projection';
import { applyEvents, replay } from '../reducer';
import { DELTA_CLASSES } from '../rules';
import type { IncidentState } from '../state';
import {
  ALEX,
  JORDAN,
  MIKA,
  NOAH,
  STRANGER,
  codeOf,
  forgeEvent,
  makeWorld,
  shuffled,
  sosWithPeers,
  type World,
} from '../testing/fixtures';

/** Synthetic statements only. ALEX is the reporter. */

const TEXT = 'I am on the second floor of Building B.';
const FORBIDDEN = ['severity', 'priority', 'diagnosis', 'triage', 'medicalSeverity', 'urgency', 'injury', 'treatment'];

function reported(): { world: World; state: IncidentState; reportId: string; floorRevisionId: string } {
  const world = makeWorld('assess');
  const state = addReport(sosWithPeers(world).state, world.as(ALEX), { text: TEXT }).state;
  return { world, state, reportId: state.reports[0]!.id, floorRevisionId: state.claims.floor.revisions[0]!.id };
}

function input(reportId: string, patch: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    reportId,
    promptVersion: 'delta-test-1',
    provider: 'synthetic-test-model',
    overall: 'new_information',
    items: [{ field: 'floor', class: 'new_information' }],
    ...patch,
  };
}

function assessedEvent(): Extract<DomainEvent, { type: 'STATEMENT_ASSESSED' }> {
  const { world, state, reportId, floorRevisionId } = reported();
  const start = TEXT.indexOf('second floor');
  const event = recordAssessment(state, world.as(ALEX), input(reportId, {
    overall: 'confirmation',
    items: [
      { field: 'floor', class: 'confirmation', againstRevisionId: floorRevisionId, evidence: { start, end: start + 12, text: 'second floor' } },
      { field: 'building', class: 'new_information' },
    ],
  })).events[0];
  if (event?.type !== 'STATEMENT_ASSESSED') throw new Error('fixture: no assessment event');
  return event;
}

describe('STATEMENT_ASSESSED schema', () => {
  const event = assessedEvent();
  const withPayload = (patch: Record<string, unknown>) => ({ ...event, payload: { ...event.payload, ...patch } });
  const ok = (candidate: unknown) => DomainEventSchema.safeParse(candidate).success;

  it('accepts a valid payload made only of ids, classes and a span', () => {
    expect(ok(event)).toBe(true);
    expect(Object.keys(event.payload).sort()).toEqual(['assessmentId', 'items', 'overall', 'provider', 'reportId']);
    expect(ok(withPayload({ items: [] }))).toBe(true);
    for (const overall of ASSESSMENT_CLASSES) expect(ok(withPayload({ overall }))).toBe(true);
  });

  it('uses exactly the six delta classes, and the five field classes', () => {
    expect([...ASSESSMENT_CLASSES]).toEqual([...DELTA_CLASSES]);
    expect([...ASSESSMENT_FIELD_CLASSES]).toEqual(DELTA_CLASSES.filter((c) => c !== 'unrelated'));
  });

  it('rejects not_assessed, an unknown class, and unrelated on a single field', () => {
    expect(ok(withPayload({ overall: 'not_assessed' }))).toBe(false);
    expect(ok(withPayload({ overall: 'contradiction' }))).toBe(false);
    expect(ok(withPayload({ items: [{ field: 'floor', class: 'unrelated' }] }))).toBe(false);
    expect(ok(withPayload({ items: [{ field: 'floor', class: 'not_assessed' }] }))).toBe(false);
  });

  it('rejects two items for one field and more than six items', () => {
    expect(
      ok(withPayload({ items: [{ field: 'floor', class: 'confirmation' }, { field: 'floor', class: 'correction' }] })),
    ).toBe(false);
    const six = (['incidentType', 'building', 'floor', 'locationText', 'symptom', 'assistanceRequested'] as const).map(
      (field) => ({ field, class: 'new_information' as const }),
    );
    expect(ok(withPayload({ items: six }))).toBe(true);
    expect(ok(withPayload({ items: [...six, { field: 'floor', class: 'new_information' }] }))).toBe(false);
  });

  it('has no room for values, free text, notes or a missing or oversized id', () => {
    for (const key of ['value', 'text', 'note', 'summary', 'reason', 'explanation', 'promptVersion', ...FORBIDDEN]) {
      expect(ok(withPayload({ [key]: 'x' }))).toBe(false);
      expect(ok(withPayload({ items: event.payload.items.map((i) => ({ ...i, [key]: 'x' })) }))).toBe(false);
    }
    expect(ok({ ...event, severity: 'high' })).toBe(false);
    expect(ok(withPayload({ assessmentId: '' }))).toBe(false);
    expect(ok(withPayload({ assessmentId: 'a'.repeat(129) }))).toBe(false);
    expect(ok(withPayload({ reportId: undefined }))).toBe(false);
    expect(ok(withPayload({ provider: '' }))).toBe(false);
    expect(ok(withPayload({ items: [{ field: 'severity', class: 'new_information' }] }))).toBe(false);
    expect(ok(withPayload({ items: [{ field: 'floor', class: 'new_information', evidence: { start: 0, end: 1, text: 'I', severity: 1 } }] }))).toBe(false);
  });
});

describe('assessmentIdFor', () => {
  it('depends only on the statement and the prompt version, and fits an id', () => {
    expect(assessmentIdFor('rpt-1', 'p1')).toBe('assess:rpt-1:p1');
    expect(assessmentIdFor('rpt-1', 'p2')).not.toBe(assessmentIdFor('rpt-1', 'p1'));
    expect(assessmentIdFor('r'.repeat(128), 'p'.repeat(64))).toHaveLength(128);
  });

  it('does not collide when the report id is long', () => {
    const reportId = 'r'.repeat(120);
    const a = assessmentIdFor(reportId, 'delta-v1');
    const b = assessmentIdFor(reportId, 'delta-v2');
    expect(a).not.toBe(b);
    // The old id was the first 128 characters of the plain form, the same for both versions.
    expect(`assess:${reportId}:delta-v1`.slice(0, 128)).toBe(`assess:${reportId}:delta-v2`.slice(0, 128));
    for (const id of [a, b]) {
      expect(id.length).toBeLessThanOrEqual(128);
      expect(id).toMatch(/^assess~r+~[0-9a-f]{16}$/);
    }
    // Deterministic, and the same on every device: no clock, no randomness, integer arithmetic only.
    expect(assessmentIdFor(reportId, 'delta-v1')).toBe(a);
    expect(a).toBe(`assess~${'r'.repeat(104)}~${a.slice(-16)}`);
  });

  it('keeps ids distinct across many long ids and versions, and across the two forms', () => {
    const ids = new Set<string>();
    let count = 0;
    for (let i = 0; i < 40; i += 1) {
      for (let v = 0; v < 40; v += 1) {
        ids.add(assessmentIdFor(`${'x'.repeat(118)}${String(i).padStart(2, '0')}`, `prompt-${v}`));
        ids.add(assessmentIdFor(`rpt-${i}`, `prompt-${v}`));
        count += 2;
      }
    }
    expect(ids.size).toBe(count);
    // A report id with ":" in it cannot be mistaken for another id and version.
    expect(assessmentIdFor('a:b', 'c')).not.toBe(assessmentIdFor('a', 'b:c'));
    expect(assessmentIdFor('a', 'b:c')).toBe('assess:a:b:c');
    expect(assessmentIdFor('a:b', 'c')).toMatch(/^assess~a:b~[0-9a-f]{16}$/);
  });
});

describe('authorization', () => {
  it('only the incident owner may record an assessment or an AI proposal', () => {
    const { world, state, reportId } = reported();
    expect(canRecordAssessment(state, ALEX)).toEqual({ ok: true });
    expect(canRecordAIProposal(state, ALEX)).toEqual({ ok: true });
    for (const actor of [MIKA, NOAH, JORDAN, STRANGER]) {
      expect(canRecordAssessment(state, actor)).toEqual({ ok: false, code: 'not_reporter' });
      expect(canRecordAIProposal(state, actor)).toEqual({ ok: false, code: 'not_reporter' });
      expect(codeOf(() => recordAssessment(state, world.as(actor), input(reportId)))).toBe('not_reporter');
      expect(
        codeOf(() => recordAIProposal(state, world.as(actor), { provider: 'synthetic-test-model', findings: [{ field: 'floor', value: 'Fifth floor' }] })),
      ).toBe('not_reporter');
    }
  });

  it('a responder-authored assessment is stored but not applied, and does not block the owner’s', () => {
    const { world, state: base, reportId } = reported();
    // A real disagreement the owner should see.
    const state = addObservation(base, world.as(MIKA), { text: 'I think Alex is on the first floor.' }).state;
    const observationId = state.reports[1]!.id;
    const id = assessmentIdFor(observationId, 'delta-test-1');

    // A paired responder device claims there is nothing to see, under the owner's deterministic id.
    const forged = forgeEvent(state, world.as(MIKA), {
      type: 'STATEMENT_ASSESSED',
      payload: { assessmentId: id, reportId: observationId, provider: 'synthetic-test-model', overall: 'no_meaningful_change', items: [] },
    });
    const withForged = applyEvents(state, [forged]);
    expect(withForged.events.map((e) => e.id)).toContain(forged.id);
    expect(withForged.notApplied).toEqual([
      { eventId: forged.id, type: 'STATEMENT_ASSESSED', actorDeviceId: MIKA.deviceId, code: 'not_reporter' },
    ]);
    expect(withForged.assessments).toEqual([]);
    expect(withForged.timeline.map((t) => t.eventId)).not.toContain(forged.id);

    // The owner's own assessment, same id, made after the forged one, is applied.
    const owned = recordAssessment(withForged, world.as(ALEX), {
      reportId: observationId,
      promptVersion: 'delta-test-1',
      provider: 'synthetic-test-model',
      overall: 'possible_contradiction',
      items: [{ field: 'floor', class: 'possible_contradiction' }],
    });
    expect(owned.state.assessments).toHaveLength(1);
    expect(owned.state.assessments[0]).toMatchObject({ id, recordedBy: ALEX, overall: 'possible_contradiction' });
    expect(owned.state.notApplied.map((n) => n.code)).toEqual(['not_reporter']);

    // Whatever order the events arrive in, including the forged one first, the result is the same.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      expect(replay(state.incidentId, shuffled(owned.state.events, seed))).toEqual(owned.state);
    }
    expect(replay(state.incidentId, [forged, ...owned.state.events.filter((e) => e.id !== forged.id)])).toEqual(owned.state);
    // And a forged event that sorts before the owner's in replay order still loses.
    const early = { ...forged, id: 'evt-0000-forged-early' };
    const earlyState = replay(state.incidentId, [early, ...owned.state.events.filter((e) => e.id !== forged.id)]);
    expect(earlyState.assessments).toEqual(owned.state.assessments);
    expect(earlyState.claims).toEqual(owned.state.claims);
    expect(reportId).toBe(state.reports[0]!.id);
  });

  it('a responder-authored AI proposal is stored but not applied and changes no field', () => {
    const { world, state } = reported();
    const forged = forgeEvent(state, world.as(MIKA), {
      type: 'AI_PROPOSAL_CREATED',
      payload: { proposalId: 'prop-forged', provider: 'synthetic-test-model', findings: [{ findingId: 'find-forged', field: 'symptom', value: 'Something nobody said' }] },
    });
    const after = applyEvents(state, [forged]);
    expect(after.notApplied).toEqual([
      { eventId: forged.id, type: 'AI_PROPOSAL_CREATED', actorDeviceId: MIKA.deviceId, code: 'not_reporter' },
    ]);
    expect(after.aiFindings).toEqual([]);
    expect(after.claims).toEqual(state.claims);
    expect(after.claims.symptom).toMatchObject({ value: null, tag: 'unknown' });
  });

  it('is refused once the incident is resolved or cancelled', () => {
    const { world, state, reportId } = reported();
    for (const closed of [resolveIncident(state, world.as(ALEX)).state, cancelIncident(state, world.as(ALEX)).state]) {
      expect(canRecordAssessment(closed, ALEX)).toEqual({ ok: false, code: 'incident_closed' });
      expect(codeOf(() => recordAssessment(closed, world.as(ALEX), input(reportId)))).toBe('incident_closed');
    }
  });
});

describe('reducer', () => {
  it('records the assessment and changes no claim, contradiction, finding, task or status', () => {
    const { world, state: first } = reported();
    // An open contradiction, an AI proposal and a second statement, so there is something to disturb.
    let before = addObservation(first, world.as(MIKA), { text: 'I think Alex is on the first floor.' }).state;
    before = recordAIProposal(before, world.as(ALEX), {
      provider: 'synthetic-test-model',
      findings: [{ field: 'locationText', value: 'near the stairs' }],
    }).state;
    expect(before.contradictions).toHaveLength(1);
    const observation = before.reports[1]!;
    const against = before.claims.floor.revisions[0]!;

    const result = recordAssessment(before, world.as(ALEX), {
      reportId: observation.id,
      promptVersion: 'delta-test-1',
      provider: 'synthetic-test-model',
      overall: 'possible_contradiction',
      items: [{ field: 'floor', class: 'possible_contradiction', againstRevisionId: against.id }],
    });
    const after = result.state;

    expect(result.events.map((e) => e.type)).toEqual(['STATEMENT_ASSESSED']);
    expect(result.outbox).toEqual([]);
    expect(after.assessments).toEqual([
      {
        id: assessmentIdFor(observation.id, 'delta-test-1'),
        reportId: observation.id,
        provider: 'synthetic-test-model',
        overall: 'possible_contradiction',
        items: [
          { field: 'floor', class: 'possible_contradiction', againstRevisionId: against.id, evidence: null, evidenceVerified: null },
        ],
        recordedBy: ALEX,
        eventId: result.events[0]!.id,
        wallClockMs: result.events[0]!.clock.wallClockMs,
      },
    ]);
    for (const key of ['claims', 'contradictions', 'aiFindings', 'reports', 'questions', 'tasks', 'recipients', 'packets', 'status', 'closure', 'disclosure', 'capsules'] as const) {
      expect(after[key]).toEqual(before[key]);
    }
    expect(after.notApplied).toEqual([]);
    // Like an AI proposal, an applied assessment is one more timeline entry.
    expect(after.timeline.slice(0, -1)).toEqual(before.timeline);
    expect(after.timeline.at(-1)).toMatchObject({ type: 'STATEMENT_ASSESSED', eventId: result.events[0]!.id });
  });

  it('an assessment that says correction or contradiction opens, closes and corrects nothing', () => {
    const { world, state, reportId, floorRevisionId } = reported();
    const after = recordAssessment(state, world.as(ALEX), input(reportId, {
      overall: 'possible_contradiction',
      items: [
        { field: 'floor', class: 'possible_contradiction', againstRevisionId: floorRevisionId },
        { field: 'building', class: 'correction' },
      ],
    })).state;
    expect(after.contradictions).toEqual([]);
    expect(after.claims).toEqual(state.claims);
    expect(after.claims.floor).toMatchObject({ value: 'Second floor', tag: 'user_reported' });
  });

  it('the same statement assessed twice with the same prompt gives one assessment', () => {
    const { world, state, reportId } = reported();
    // Two runs on the owner's device that both started from the same state.
    const first = recordAssessment(state, world.as(ALEX), input(reportId));
    const second = recordAssessment(state, world.as(ALEX), input(reportId, { overall: 'unrelated', items: [] }));
    expect(first.events[0]!.id).not.toBe(second.events[0]!.id);

    const merged = replay(state.incidentId, [...state.events, ...second.events, ...first.events]);
    expect(merged.assessments).toHaveLength(1);
    // First in replay order (lamport, deviceId, id) is kept.
    expect(merged.assessments[0]).toMatchObject({ recordedBy: ALEX, overall: 'new_information', eventId: first.events[0]!.id });
    expect(merged.notApplied).toEqual([
      { eventId: second.events[0]!.id, type: 'STATEMENT_ASSESSED', actorDeviceId: ALEX.deviceId, code: 'duplicate_entity' },
    ]);

    // Locally, a repeat is refused; a new prompt version is a new assessment.
    const onMika = first;
    expect(codeOf(() => recordAssessment(onMika.state, world.as(ALEX), input(reportId)))).toBe('duplicate_entity');
    const again = recordAssessment(onMika.state, world.as(ALEX), input(reportId, { promptVersion: 'delta-test-2' })).state;
    expect(again.assessments.map((a) => a.id)).toEqual([assessmentIdFor(reportId, 'delta-test-1'), assessmentIdFor(reportId, 'delta-test-2')]);
  });

  it('refuses an unknown report', () => {
    const { world, state } = reported();
    expect(codeOf(() => recordAssessment(state, world.as(ALEX), input('rpt-missing')))).toBe('unknown_report');
  });

  it('refuses an againstRevisionId that is unknown, on another field, or an AI proposal', () => {
    const { world, state: base, reportId, floorRevisionId } = reported();
    const state = recordAIProposal(base, world.as(ALEX), {
      provider: 'synthetic-test-model',
      findings: [{ field: 'floor', value: 'Fifth floor' }],
    }).state;
    const aiRevisionId = state.aiFindings[0]!.revisionId;
    const buildingRevisionId = state.claims.building.revisions[0]!.id;

    for (const againstRevisionId of ['evt-missing#0', buildingRevisionId, aiRevisionId]) {
      const attempt = input(reportId, { items: [{ field: 'floor', class: 'correction', againstRevisionId }] });
      expect(codeOf(() => recordAssessment(state, world.as(ALEX), attempt))).toBe('unknown_revision');
    }
    // One bad item refuses the whole event: nothing is half-recorded.
    const mixed = input(reportId, {
      items: [
        { field: 'building', class: 'confirmation', againstRevisionId: buildingRevisionId },
        { field: 'floor', class: 'correction', againstRevisionId: aiRevisionId },
      ],
    });
    expect(codeOf(() => recordAssessment(state, world.as(ALEX), mixed))).toBe('unknown_revision');
    const good = input(reportId, { items: [{ field: 'floor', class: 'no_meaningful_change', againstRevisionId: floorRevisionId }] });
    expect(recordAssessment(state, world.as(ALEX), good).state.assessments).toHaveLength(1);
  });

  it('checks an evidence span against the stored statement and keeps a span that does not match', () => {
    const { world, state, reportId } = reported();
    const start = TEXT.indexOf('second floor');
    const after = recordAssessment(state, world.as(ALEX), input(reportId, {
      items: [
        { field: 'floor', class: 'new_information', evidence: { start, end: start + 12, text: 'second floor' } },
        { field: 'building', class: 'new_information', evidence: { start: 0, end: 10, text: 'Building Z' } },
        { field: 'locationText', class: 'new_information' },
      ],
    })).state;
    expect(after.notApplied).toEqual([]);
    expect(after.assessments[0]!.items.map((i) => [i.field, i.evidence?.text ?? null, i.evidenceVerified])).toEqual([
      ['floor', 'second floor', true],
      ['building', 'Building Z', false],
      ['locationText', null, null],
    ]);
  });
});

describe('replay', () => {
  function history() {
    const { world, state: base, reportId, floorRevisionId } = reported();
    let s = addObservation(base, world.as(MIKA), { text: 'Alex is on the 2nd floor.' }).state;
    s = recordAssessment(s, world.as(ALEX), input(s.reports[1]!.id, {
      overall: 'confirmation',
      items: [{ field: 'floor', class: 'confirmation', againstRevisionId: floorRevisionId, evidence: { start: 15, end: 24, text: '2nd floor' } }],
    })).state;
    s = recordAssessment(s, world.as(ALEX), input(reportId)).state;
    s = addReport(s, world.as(ALEX), { text: 'Please hurry.' }).state;
    return s;
  }

  it('is deterministic for any arrival order, with duplicates, and after a restart', () => {
    const s = history();
    expect(s.assessments).toHaveLength(2);
    expect(s.assessments[0]!.items[0]!.evidenceVerified).toBe(true);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      expect(replay(s.incidentId, shuffled(s.events, seed))).toEqual(s);
      expect(replay(s.incidentId, [...shuffled(s.events, seed), ...s.events])).toEqual(s);
    }
    expect(replay(s.incidentId, JSON.parse(JSON.stringify(s.events)) as DomainEvent[])).toEqual(s);
  });

  it('an assessment that arrives before its statement is held, then applied when the statement arrives', () => {
    const s = history();
    const observationEvent = s.events.find((e) => e.type === 'REPORT_ADDED' && e.actor.deviceId === MIKA.deviceId)!;
    const without = replay(s.incidentId, s.events.filter((e) => e.id !== observationEvent.id));

    // Held: it is in the ledger, listed as not applied, and has no effect.
    const held = without.notApplied.filter((n) => n.type === 'STATEMENT_ASSESSED');
    expect(held.map((n) => n.code)).toEqual(['unknown_report']);
    expect(without.assessments).toHaveLength(1);
    expect(without.ledger.missingParents).toContain(observationEvent.id);

    // The statement arrives: the next replay applies it and converges on the full state.
    expect(applyEvents(without, [observationEvent])).toEqual(s);
  });

  it('by contrast an AI proposal for a statement not yet seen is applied at once, with its span unverified', () => {
    const { world, state, reportId } = reported();
    const proposal = recordAIProposal(state, world.as(ALEX), {
      provider: 'synthetic-test-model',
      reportId,
      findings: [{ field: 'floor', value: 'Second floor', evidence: { start: 12, end: 24, text: 'second floor' } }],
    });
    const reportEvent = state.events.find((e) => e.type === 'REPORT_ADDED')!;
    const without = replay(state.incidentId, proposal.state.events.filter((e) => e.id !== reportEvent.id));
    expect(without.notApplied).toEqual([]);
    expect(without.aiFindings[0]!.evidenceVerified).toBeNull();
    expect(proposal.state.aiFindings[0]!.evidenceVerified).toBe(true);
  });
});

describe('projections sent to recipients carry no assessment', () => {
  it.each(['relay', 'trusted', 'authorized'] as const)('%s', (level) => {
    const { world, state, reportId, floorRevisionId } = reported();
    const assessed = recordAssessment(state, world.as(ALEX), input(reportId, {
      items: [{ field: 'floor', class: 'no_meaningful_change', againstRevisionId: floorRevisionId }],
    })).state;
    const policy = { shareDetailedLocation: true, shareSymptoms: true, recipients: assessed.disclosure.recipients };
    const projection = projectForLevel(assessed, level, policy);
    const json = JSON.stringify(projection);
    expect(json).not.toContain(assessed.assessments[0]!.id);
    expect(json).not.toContain('assessments');
    expect(json).not.toContain('STATEMENT_ASSESSED');
    expect(json).not.toContain('no_meaningful_change');
    // And it is the same projection the level got before the assessment existed.
    expect(projection).toEqual(projectForLevel(state, level, policy));
  });

  it('the payload type carries nothing but ids, classes and spans', () => {
    const payload: PayloadOf<'STATEMENT_ASSESSED'> = assessedEvent().payload;
    expect(payload.items.every((i) => Object.keys(i).every((k) => ['field', 'class', 'againstRevisionId', 'evidence'].includes(k)))).toBe(true);
  });
});
