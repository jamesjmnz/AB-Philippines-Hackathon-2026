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
  const event = recordAssessment(state, world.as(MIKA), input(reportId, {
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
});

describe('authorization', () => {
  it('any participant may record one while the incident is open; a stranger may not', () => {
    const { world, state, reportId } = reported();
    for (const actor of [ALEX, MIKA, NOAH, JORDAN]) {
      expect(canRecordAssessment(state, actor)).toEqual({ ok: true });
      expect(canRecordAssessment(state, actor)).toEqual(canRecordAIProposal(state, actor));
    }
    expect(canRecordAssessment(state, STRANGER)).toEqual({ ok: false, code: 'not_participant' });
    expect(codeOf(() => recordAssessment(state, world.as(STRANGER), input(reportId)))).toBe('not_participant');

    const forged = forgeEvent(state, world.as(STRANGER), {
      type: 'STATEMENT_ASSESSED',
      payload: { assessmentId: 'assess:forged', reportId, provider: 'synthetic-test-model', overall: 'unrelated', items: [] },
    });
    const after = applyEvents(state, [forged]);
    expect(after.notApplied.map((n) => n.code)).toEqual(['not_participant']);
    expect(after.assessments).toEqual([]);
  });

  it('is refused once the incident is resolved or cancelled', () => {
    const { world, state, reportId } = reported();
    for (const closed of [resolveIncident(state, world.as(ALEX)).state, cancelIncident(state, world.as(ALEX)).state]) {
      expect(canRecordAssessment(closed, MIKA)).toEqual({ ok: false, code: 'incident_closed' });
      expect(codeOf(() => recordAssessment(closed, world.as(MIKA), input(reportId)))).toBe('incident_closed');
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

    const result = recordAssessment(before, world.as(MIKA), {
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
        recordedBy: MIKA,
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

  it('two devices assessing the same statement with the same prompt give one assessment', () => {
    const { world, state, reportId } = reported();
    const onMika = recordAssessment(state, world.as(MIKA), input(reportId));
    const onNoah = recordAssessment(state, world.as(NOAH), input(reportId, { overall: 'unrelated', items: [] }));
    expect(onMika.events[0]!.id).not.toBe(onNoah.events[0]!.id);

    const merged = replay(state.incidentId, [...state.events, ...onNoah.events, ...onMika.events]);
    expect(merged.assessments).toHaveLength(1);
    // First in replay order (lamport, deviceId, id) is kept: dev-mika sorts before dev-noah.
    expect(merged.assessments[0]).toMatchObject({ recordedBy: MIKA, overall: 'new_information' });
    expect(merged.notApplied).toEqual([
      { eventId: onNoah.events[0]!.id, type: 'STATEMENT_ASSESSED', actorDeviceId: NOAH.deviceId, code: 'duplicate_entity' },
    ]);

    // Locally, a repeat is refused; a new prompt version is a new assessment.
    expect(codeOf(() => recordAssessment(onMika.state, world.as(MIKA), input(reportId)))).toBe('duplicate_entity');
    const again = recordAssessment(onMika.state, world.as(MIKA), input(reportId, { promptVersion: 'delta-test-2' })).state;
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
    s = recordAssessment(s, world.as(MIKA), input(s.reports[1]!.id, {
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
