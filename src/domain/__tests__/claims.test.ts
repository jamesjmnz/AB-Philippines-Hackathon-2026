import {
  addObservation,
  addReport,
  confirmClaim,
  flagConflict,
  flagDetectedConflicts,
  recordAIProposal,
  requestClarification,
  resolveConflict,
  skipClarification,
} from '../commands';
import { canResolveConflict } from '../policy';
import { applyEvents, replay } from '../reducer';
import { detectFieldConflicts } from '../rules';
import {
  ALEX,
  MIKA,
  NOAH,
  SAMPLE_REPORT,
  SAMPLE_SYMPTOM,
  codeOf,
  forgeEvent,
  makeWorld,
  sosWithPeers,
} from '../testing/fixtures';

function reported() {
  const world = makeWorld();
  let s = sosWithPeers(world).state;
  s = addReport(s, world.as(ALEX), { text: SAMPLE_REPORT, claims: [{ field: 'symptom', value: SAMPLE_SYMPTOM }] }).state;
  return { world, state: s };
}

describe('claims and provenance', () => {
  it('keeps the original report verbatim and the symptom in the person’s own words', () => {
    const { state } = reported();
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]).toMatchObject({ text: SAMPLE_REPORT, kind: 'report', role: 'reporter', author: ALEX });
    expect(state.claims.symptom).toMatchObject({ value: SAMPLE_SYMPTOM, tag: 'user_reported' });
    expect(state.claims.building).toMatchObject({ value: 'Building B', tag: 'user_reported' });
    expect(state.claims.building.revisions[0]).toMatchObject({
      extraction: 'rule',
      evidence: { text: 'Building B', reportId: state.reports[0]?.id },
    });
    expect(state.claims.floor.tag).toBe('unknown');
  });

  it('only the reporter adds the report; a responder adds observations tagged as theirs', () => {
    const { world, state } = reported();
    expect(codeOf(() => addReport(state, world.as(MIKA), { text: 'Some other account' }))).toBe('not_reporter');
    const s = addObservation(state, world.as(MIKA), { text: 'Alex is by the stairs on the 2nd floor.' }).state;
    expect(s.claims.floor).toMatchObject({ value: 'Second floor', tag: 'responder_reported' });
    expect(s.reports[1]).toMatchObject({ kind: 'observation', role: 'responder', author: MIKA });
    expect(s.contradictions).toEqual([]);
  });
});

describe('AI proposals have no authority (invariant 3)', () => {
  it('a proposal fills an unknown field only as ai_proposed', () => {
    const { world, state } = reported();
    const s = recordAIProposal(state, world.as(ALEX), {
      provider: 'synthetic-test-model',
      findings: [{ field: 'floor', value: 'Third floor' }],
    }).state;
    expect(s.claims.floor).toMatchObject({ value: 'Third floor', tag: 'ai_proposed' });
    expect(s.aiFindings[0]).toMatchObject({ field: 'floor', confirmedByEventId: null });
  });

  it('a proposal never changes or outranks a human claim, reported or confirmed', () => {
    const { world, state } = reported();
    const confirmed = confirmClaim(state, world.as(ALEX), { field: 'floor', value: 'Second floor' }).state;
    const s = recordAIProposal(confirmed, world.as(ALEX), {
      provider: 'synthetic-test-model',
      findings: [
        { field: 'floor', value: 'Fifth floor' },
        { field: 'building', value: 'Building Z' },
        { field: 'symptom', value: 'Something the person never said' },
      ],
    }).state;

    expect(s.claims.floor).toMatchObject({ value: 'Second floor', tag: 'user_confirmed' });
    expect(s.claims.building).toMatchObject({ value: 'Building B', tag: 'user_reported' });
    expect(s.claims.symptom).toMatchObject({ value: SAMPLE_SYMPTOM, tag: 'user_reported' });
    // The proposals are kept as history, not discarded.
    expect(s.claims.floor.revisions.map((r) => r.source.kind)).toEqual(['answer', 'ai_proposal']);
    // And the rules do not treat an AI proposal as a human disagreement.
    expect(detectFieldConflicts(s)).toEqual([]);
  });

  it('a later proposal does not win even when it arrives before the human claim in replay order', () => {
    const { world, state } = reported();
    const proposal = recordAIProposal(state, world.as(ALEX), {
      provider: 'synthetic-test-model',
      findings: [{ field: 'floor', value: 'Fifth floor' }],
    });
    const human = addObservation(proposal.state, world.as(MIKA), { text: 'Alex is on the second floor.' });
    expect(human.state.claims.floor).toMatchObject({ value: 'Second floor', tag: 'responder_reported' });
  });

  it('only a human CLAIM_CONFIRMED from the reporter promotes a proposal', () => {
    const { world, state } = reported();
    const s = recordAIProposal(state, world.as(ALEX), {
      provider: 'synthetic-test-model',
      findings: [{ field: 'floor', value: 'Third floor' }],
    }).state;
    const revisionId = s.aiFindings[0]!.revisionId;

    expect(codeOf(() => confirmClaim(s, world.as(MIKA), { field: 'floor', confirmsRevisionId: revisionId }))).toBe('not_reporter');
    expect(
      codeOf(() => confirmClaim(s, world.as(ALEX), { field: 'floor', value: 'Fourth floor', confirmsRevisionId: revisionId })),
    ).toBe('value_mismatch');

    const promoted = confirmClaim(s, world.as(ALEX), { field: 'floor', confirmsRevisionId: revisionId }).state;
    expect(promoted.claims.floor).toMatchObject({ value: 'Third floor', tag: 'user_confirmed' });
    expect(promoted.aiFindings[0]?.confirmedByEventId).toBe(promoted.events[promoted.events.length - 1]?.id);
    expect(promoted.claims.floor.revisions.at(-1)).toMatchObject({ confirmsRevisionId: revisionId, authority: 'confirmation' });
  });

  it('an AI cannot flag a conflict that involves its own proposal, and cannot resolve one', () => {
    const { world, state } = reported();
    const s = recordAIProposal(state, world.as(ALEX), {
      provider: 'synthetic-test-model',
      findings: [{ field: 'building', value: 'Building Z' }],
    }).state;
    const ids = s.claims.building.revisions.map((r) => r.id);
    expect(codeOf(() => flagConflict(s, world.as(ALEX), { field: 'building', revisionIds: ids, detectedBy: 'ai' }))).toBe(
      'invalid_conflict',
    );
    expect(s.claims.building.tag).toBe('user_reported');
  });

  it('checks a proposal’s evidence span against the stored report text', () => {
    const { world, state } = reported();
    const reportId = state.reports[0]!.id;
    const start = SAMPLE_REPORT.indexOf('Building B');
    const s = recordAIProposal(state, world.as(ALEX), {
      provider: 'synthetic-test-model',
      reportId,
      findings: [
        { field: 'building', value: 'Building B', evidence: { start, end: start + 10, text: 'Building B' } },
        { field: 'floor', value: 'Ninth floor', evidence: { start: 0, end: 11, text: 'ninth floor' } },
        { field: 'locationText', value: 'near the stairs' },
      ],
    }).state;
    expect(s.aiFindings.map((f) => f.evidenceVerified)).toEqual([true, false, null]);
  });
});

describe('unknown stays unknown (invariant 4)', () => {
  it('skipping a clarification leaves the field unknown', () => {
    const { world, state } = reported();
    let s = requestClarification(state, world.as(ALEX), { field: 'floor', prompt: 'Which floor are you on?', origin: 'ai' }).state;
    const questionId = s.questions[0]!.id;
    expect(codeOf(() => skipClarification(s, world.as(MIKA), { questionId }))).toBe('not_reporter');

    s = skipClarification(s, world.as(ALEX), { questionId }).state;
    expect(s.questions[0]).toMatchObject({ status: 'skipped' });
    expect(s.claims.floor).toMatchObject({ value: null, tag: 'unknown', revisions: [], candidates: [] });
    expect(codeOf(() => skipClarification(s, world.as(ALEX), { questionId }))).toBe('question_not_open');
  });

  it('answering a clarification confirms the value', () => {
    const { world, state } = reported();
    let s = requestClarification(state, world.as(MIKA), { field: 'floor', prompt: 'Which floor?', origin: 'human' }).state;
    s = confirmClaim(s, world.as(ALEX), { field: 'floor', value: 'Second floor', questionId: s.questions[0]!.id }).state;
    expect(s.questions[0]?.status).toBe('answered');
    expect(s.claims.floor).toMatchObject({ value: 'Second floor', tag: 'user_confirmed' });
  });

  it.each([
    'The fire is on the 3rd floor',
    'My son is on the 3rd floor, I am outside',
    'Is this the 3rd floor? I do not know',
    'I left the 3rd floor already',
    'Do not come to the 3rd floor',
    'Fire at 2nd floor. I am not on the 2nd floor',
    'Nasa 3rd floor ang apoy',
    'Umalis na ako sa 3rd floor',
    'Huwag kayong pumunta sa 3rd floor',
    'Ito ba ang 3rd floor? Hindi ko alam',
  ])('a report saying %j leaves the floor unknown', (text) => {
    const world = makeWorld();
    const s = addReport(sosWithPeers(world).state, world.as(ALEX), { text }).state;
    expect(s.reports[0]?.text).toBe(text);
    expect(s.claims.floor).toMatchObject({ value: null, tag: 'unknown', revisions: [] });
  });

  it('a report with an excluded mention and a valid one states the valid one', () => {
    const world = makeWorld();
    const s = addReport(sosWithPeers(world).state, world.as(ALEX), {
      text: 'My son is on the 3rd floor, I am on the 2nd floor',
    }).state;
    expect(s.claims.floor).toMatchObject({ value: 'Second floor', tag: 'user_reported' });
    expect(s.claims.floor.revisions[0]).toMatchObject({ extraction: 'rule', evidence: { text: '2nd floor' } });
  });

  it('a report that names two floors does not pick one', () => {
    const world = makeWorld();
    const s = addReport(sosWithPeers(world).state, world.as(ALEX), {
      text: 'I was going from the second floor to the third floor.',
    }).state;
    expect(s.claims.floor.tag).toBe('unknown');
  });
});

describe('contradictions keep both statements (invariant 4)', () => {
  function conflicted() {
    const { world, state } = reported();
    let s = confirmClaim(state, world.as(ALEX), { field: 'floor', value: 'Second floor' }).state;
    s = addObservation(s, world.as(MIKA), { text: 'I think Alex is on the first floor.' }).state;
    return { world, state: s };
  }

  it('a rule flags the disagreement without any model and the field becomes unresolved', () => {
    const { state } = conflicted();
    expect(state.aiFindings).toEqual([]);
    expect(state.contradictions).toHaveLength(1);
    expect(state.contradictions[0]).toMatchObject({ field: 'floor', detectedBy: 'rule', status: 'open', resolution: null });
    expect(state.claims.floor).toMatchObject({ value: null, tag: 'unresolved', candidates: ['Second floor', 'First floor'] });
    expect(state.claims.floor.revisions.map((r) => [r.source.actor.deviceId, r.value])).toEqual([
      [ALEX.deviceId, 'Second floor'],
      [MIKA.deviceId, 'First floor'],
    ]);
  });

  it('a responder cannot resolve it; they can ask for clarification or leave it open', () => {
    const { world, state } = conflicted();
    const conflictId = state.contradictions[0]!.id;
    for (const actor of [MIKA, NOAH]) {
      expect(codeOf(() => resolveConflict(state, world.as(actor), { conflictId, value: 'First floor' }))).toBe('not_reporter');
      expect(canResolveConflict(state, actor, conflictId)).toEqual({ ok: false, code: 'not_reporter' });
    }
    const forged = forgeEvent(state, world.as(MIKA), {
      type: 'CONFLICT_RESOLVED',
      payload: { conflictId, value: 'First floor' },
    });
    const after = applyEvents(state, [forged]);
    expect(after.notApplied.map((n) => n.code)).toEqual(['not_reporter']);
    expect(after.claims.floor.tag).toBe('unresolved');

    const asked = requestClarification(state, world.as(MIKA), {
      field: 'floor',
      prompt: 'Can you confirm your floor?',
      origin: 'human',
      conflictId,
    }).state;
    expect(asked.questions[0]).toMatchObject({ conflictId, status: 'open' });
    expect(asked.claims.floor.tag).toBe('unresolved');
  });

  it('a plain confirmation does not close a contradiction; only CONFLICT_RESOLVED does', () => {
    const { world, state } = conflicted();
    const s = confirmClaim(state, world.as(ALEX), { field: 'floor', value: 'Second floor' }).state;
    expect(s.contradictions[0]?.status).toBe('open');
    expect(s.claims.floor.tag).toBe('unresolved');
  });

  it('resolution by the reporter keeps the losing statement in history', () => {
    const { world, state } = conflicted();
    const conflict = state.contradictions[0]!;
    const before = state.claims.floor.revisions;
    const chosen = before.find((r) => r.source.actor.deviceId === ALEX.deviceId)!;

    const s = resolveConflict(state, world.as(ALEX), { conflictId: conflict.id, chosenRevisionId: chosen.id }).state;
    expect(s.claims.floor).toMatchObject({ value: 'Second floor', tag: 'user_confirmed', candidates: [] });
    expect(s.contradictions[0]).toMatchObject({
      status: 'resolved',
      revisionIds: conflict.revisionIds,
      resolution: { value: 'Second floor', chosenRevisionId: chosen.id, resolvedBy: ALEX },
    });
    // Every earlier revision is still there, unchanged, plus the resolution.
    expect(s.claims.floor.revisions.slice(0, before.length)).toEqual(before);
    expect(s.claims.floor.revisions).toHaveLength(before.length + 1);
    expect(s.reports.map((r) => r.text)).toContain('I think Alex is on the first floor.');
    // Resolved conflicts are not flagged again, and cannot be resolved twice.
    expect(detectFieldConflicts(s)).toEqual([]);
    expect(codeOf(() => resolveConflict(s, world.as(ALEX), { conflictId: conflict.id, value: 'First floor' }))).toBe('conflict_not_open');
  });

  it('a new disagreement after a resolution opens a new contradiction', () => {
    const { world, state } = conflicted();
    let s = resolveConflict(state, world.as(ALEX), { conflictId: state.contradictions[0]!.id, value: 'Second floor' }).state;
    s = addObservation(s, world.as(NOAH), { text: 'Alex is on the third floor now.' }).state;
    expect(s.contradictions.map((c) => c.status)).toEqual(['resolved', 'open']);
    expect(s.claims.floor).toMatchObject({ tag: 'unresolved', candidates: ['Second floor', 'Third floor'] });
  });

  it('a matching observation and a repeat of an open disagreement flag nothing new', () => {
    const { world, state } = conflicted();
    let s = addObservation(state, world.as(NOAH), { text: 'Alex is on the first floor.' }).state;
    expect(s.contradictions).toHaveLength(1);
    s = addObservation(s, world.as(NOAH), { text: 'Sorry, the second floor.' }).state;
    expect(s.contradictions).toHaveLength(1);
  });

  it('concurrent statements from two devices are both kept and flagged identically on each device', () => {
    const { world, state } = reported();
    const mika = addObservation(state, world.as(MIKA), { text: 'Alex is on the first floor.' }).events;
    const noah = addObservation(state, world.as(NOAH), { text: 'Alex is on the third floor.' }).events;
    const merged = replay(state.incidentId, [...state.events, ...mika, ...noah]);
    expect(merged.contradictions).toEqual([]);
    expect(merged.claims.floor.revisions).toHaveLength(2);

    const onMika = flagDetectedConflicts(merged, world.as(MIKA));
    const onNoah = flagDetectedConflicts(merged, world.as(NOAH));
    expect(onMika.events).toHaveLength(1);
    const both = replay(state.incidentId, [...merged.events, ...onMika.events, ...onNoah.events]);
    // Both devices derived the same conflict id, so there is one contradiction, not two.
    expect(both.contradictions).toHaveLength(1);
    expect(both.notApplied.map((n) => n.code)).toEqual(['duplicate_entity']);
    expect(both.claims.floor).toMatchObject({ tag: 'unresolved', value: null });
    expect([...both.claims.floor.candidates].sort()).toEqual(['First floor', 'Third floor']);
  });
});
