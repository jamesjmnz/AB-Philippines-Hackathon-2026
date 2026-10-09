import { addObservation, addReport, confirmClaim, recordAIProposal, resolveConflict } from '../commands';
import type { DomainEvent } from '../events';
import { applyEvents, replay } from '../reducer';
import { DELTA_CLASSES, classifyStatementDelta, detectFieldConflicts, type StatementDelta } from '../rules';
import type { IncidentState } from '../state';
import { ALEX, MIKA, NOAH, forgeEvent, makeWorld, shuffled, sosWithPeers, type World } from '../testing/fixtures';

/** Synthetic statements only. ALEX is the reporter; MIKA and NOAH are responders. */

function start(): { world: World; state: IncidentState } {
  const world = makeWorld('delta');
  return { world, state: sosWithPeers(world).state };
}

function flagged(events: readonly DomainEvent[]): DomainEvent[] {
  return events.filter((e) => e.type === 'CONFLICT_FLAGGED');
}

function lastDelta(state: IncidentState): StatementDelta {
  const report = state.reports[state.reports.length - 1];
  const delta = report ? classifyStatementDelta(state, report.id) : null;
  if (!delta) throw new Error('fixture: no report to classify');
  return delta;
}

describe('same-author supersession in conflict detection', () => {
  it('a reporter who corrects their own floor raises no CONFLICT_FLAGGED and the field follows the correction', () => {
    const { world, state } = start();
    const first = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' });
    const second = addReport(first.state, world.as(ALEX), { text: 'Sorry, I am on the third floor.' });

    expect(flagged(second.events)).toEqual([]);
    expect(second.state.contradictions).toEqual([]);
    expect(detectFieldConflicts(second.state)).toEqual([]);
    expect(second.state.claims.floor).toMatchObject({ value: 'Third floor', tag: 'user_reported', candidates: [] });
    // Nothing is removed: the superseded statement stays in the history.
    expect(second.state.claims.floor.revisions.map((r) => r.value)).toEqual(['Second floor', 'Third floor']);

    expect(lastDelta(second.state)).toMatchObject({
      overall: 'correction',
      needsVerification: false,
      duplicateOfReportId: null,
      fields: [
        {
          field: 'floor',
          class: 'correction',
          reason: 'self_correction',
          value: 'Third floor',
          previousValue: 'Second floor',
          againstRevisionId: first.state.claims.floor.revisions[0]?.id,
          needsVerification: false,
        },
      ],
    });
  });

  it('a responder who corrects themselves is compared only by their latest statement', () => {
    const { world, state } = start();
    let s = addObservation(state, world.as(MIKA), { text: 'Alex is on the first floor.' }).state;
    const corrected = addObservation(s, world.as(MIKA), { text: 'Correction: the second floor.' });
    expect(flagged(corrected.events)).toEqual([]);
    expect(lastDelta(corrected.state)).toMatchObject({ overall: 'correction', fields: [{ reason: 'self_correction' }] });

    // Another responder is compared with that latest statement, not the superseded one.
    s = corrected.state;
    const agrees = addObservation(s, world.as(NOAH), { text: 'Second floor, I can see Alex.' });
    expect(flagged(agrees.events)).toEqual([]);
    const differs = addObservation(s, world.as(NOAH), { text: 'I think it is the first floor.' });
    expect(flagged(differs.events)).toHaveLength(1);
  });

  it('a responder naming a different floor is a possible contradiction and is still flagged', () => {
    const { world, state } = start();
    const reported = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' });
    const observed = addObservation(reported.state, world.as(MIKA), { text: 'I think Alex is on the first floor.' });

    expect(flagged(observed.events)).toHaveLength(1);
    expect(observed.state.contradictions).toHaveLength(1);
    expect(observed.state.claims.floor).toMatchObject({ tag: 'unresolved', value: null });
    expect(lastDelta(observed.state)).toMatchObject({
      overall: 'possible_contradiction',
      needsVerification: true,
      fields: [
        {
          field: 'floor',
          class: 'possible_contradiction',
          reason: 'differs_from_other',
          value: 'First floor',
          previousValue: 'Second floor',
          againstRevisionId: reported.state.claims.floor.revisions[0]?.id,
          needsVerification: true,
        },
      ],
    });
  });

  it('a statement that differs from a reporter-confirmed value is flagged even when the reporter makes it', () => {
    const { world, state } = start();
    const confirmed = confirmClaim(state, world.as(ALEX), { field: 'floor', value: 'Second floor' }).state;
    const confirmation = confirmed.claims.floor.revisions[0];

    for (const [actor, add] of [
      [ALEX, addReport],
      [MIKA, addObservation],
    ] as const) {
      const result = add(confirmed, world.as(actor), { text: 'It is the third floor.' });
      expect(flagged(result.events)).toHaveLength(1);
      expect(result.state.claims.floor.tag).toBe('unresolved');
      expect(lastDelta(result.state)).toMatchObject({
        overall: 'possible_contradiction',
        needsVerification: true,
        fields: [
          {
            class: 'possible_contradiction',
            reason: 'differs_from_confirmed',
            againstRevisionId: confirmation?.id,
            previousValue: 'Second floor',
            needsVerification: true,
          },
        ],
      });
    }
  });

  it('a responder who corrects themselves to agree with the reporter leaves the open contradiction open', () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' }).state;
    s = addObservation(s, world.as(MIKA), { text: 'I think Alex is on the first floor.' }).state;
    expect(s.contradictions.map((c) => c.status)).toEqual(['open']);

    const corrected = addObservation(s, world.as(MIKA), { text: 'My mistake, the second floor.' });
    expect(flagged(corrected.events)).toEqual([]);
    expect(corrected.state.contradictions.map((c) => c.status)).toEqual(['open']);
    expect(corrected.state.claims.floor).toMatchObject({ tag: 'unresolved', value: null });
    expect(lastDelta(corrected.state)).toMatchObject({
      overall: 'correction',
      needsVerification: false,
      fields: [{ reason: 'self_correction', value: 'Second floor', previousValue: 'First floor' }],
    });

    // Only the reporter's explicit event closes it.
    const resolved = resolveConflict(corrected.state, world.as(ALEX), {
      conflictId: corrected.state.contradictions[0]!.id,
      value: 'Second floor',
    }).state;
    expect(resolved.contradictions.map((c) => c.status)).toEqual(['resolved']);
  });

  it('a responder who changes their mind to a value the reporter did not state is still flagged', () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' }).state;
    s = addObservation(s, world.as(MIKA), { text: 'Alex is on the second floor.' }).state;
    const changed = addObservation(s, world.as(MIKA), { text: 'Actually the fourth floor.' });
    expect(flagged(changed.events)).toHaveLength(1);
    expect(lastDelta(changed.state)).toMatchObject({
      overall: 'possible_contradiction',
      needsVerification: true,
      fields: [{ reason: 'differs_from_other', previousValue: 'Second floor' }],
    });
  });

  it('a previously recorded CONFLICT_FLAGGED between one author’s statements still replays', () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' }).state;
    s = addReport(s, world.as(ALEX), { text: 'I am on the third floor.' }).state;
    expect(s.contradictions).toEqual([]);

    // What a build before this change recorded: a rule flag between the reporter's own statements.
    const [older, newer] = s.claims.floor.revisions;
    const legacy = forgeEvent(s, world.as(ALEX), {
      type: 'CONFLICT_FLAGGED',
      payload: {
        conflictId: 'conflict:floor:legacy',
        field: 'floor',
        revisionIds: [newer!.id, older!.id],
        detectedBy: 'rule',
      },
    });
    const after = applyEvents(s, [legacy]);
    expect(after.notApplied).toEqual([]);
    expect(after.contradictions).toHaveLength(1);
    expect(after.contradictions[0]).toMatchObject({ status: 'open', revisionIds: [newer!.id, older!.id] });
    expect(after.claims.floor).toMatchObject({ tag: 'unresolved', candidates: ['Second floor', 'Third floor'] });
    // Same ledger, any order, same state; and the rule neither repeats nor withdraws the flag.
    expect(replay(after.incidentId, shuffled(after.events, 11))).toEqual(after);
    expect(detectFieldConflicts(after)).toEqual([]);

    const resolved = resolveConflict(after, world.as(ALEX), { conflictId: 'conflict:floor:legacy', value: 'Third floor' }).state;
    expect(resolved.claims.floor).toMatchObject({ value: 'Third floor', tag: 'user_confirmed' });
  });
});

describe('movement phrasing', () => {
  it.each([
    ['English', 'I moved from the first floor to the second floor', 'second floor'],
    ['Taglish', 'Lumipat ako mula first floor papunta sa second floor', 'second floor'],
    ['Taglish, nasa ... na ako', 'Galing ako sa 1st floor, nasa 2nd floor na ako', '2nd floor'],
    ['elided destination', "I was on the first floor, now I'm on the second", 'second'],
  ])('%s: the destination is the floor, as a correction with reason moved', (_label, text, spanText) => {
    const { world, state } = start();
    const s = addReport(state, world.as(ALEX), { text: 'I am on the first floor.' }).state;
    const moved = addReport(s, world.as(ALEX), { text });

    expect(flagged(moved.events)).toEqual([]);
    expect(moved.state.claims.floor).toMatchObject({ value: 'Second floor', tag: 'user_reported' });
    const revision = moved.state.claims.floor.revisions.at(-1);
    expect(revision).toMatchObject({ extraction: 'rule', evidence: { text: spanText } });
    expect(text.slice(revision?.evidence?.start, revision?.evidence?.end)).toBe(spanText);
    expect(lastDelta(moved.state)).toMatchObject({
      overall: 'correction',
      needsVerification: false,
      fields: [{ field: 'floor', class: 'correction', reason: 'moved', value: 'Second floor', previousValue: 'First floor' }],
    });
  });

  it('a movement statement with nothing earlier is new information, not a correction', () => {
    const { world, state } = start();
    const s = addReport(state, world.as(ALEX), { text: 'I moved from the first floor to the second floor' }).state;
    expect(s.claims.floor.value).toBe('Second floor');
    expect(lastDelta(s)).toMatchObject({ overall: 'new_information', fields: [{ reason: 'first_value', previousValue: null }] });
  });

  it('an explicit floor still wins over the movement rule', () => {
    const { world, state } = start();
    const s = addReport(state, world.as(ALEX), {
      text: 'I moved from the first floor to the second floor',
      claims: [{ field: 'floor', value: 'Fifth floor' }],
    }).state;
    expect(s.claims.floor.revisions.map((r) => [r.value, r.extraction])).toEqual([['Fifth floor', 'explicit']]);
  });
});

describe('an explicit move does not conflict with an earlier statement of its origin', () => {
  const MOVES: [label: string, text: string][] = [
    ['English', 'I moved from the first floor to the second floor'],
    ['Taglish', 'Lumipat ako mula first floor papunta sa second floor'],
  ];

  function beforeMove(observation: string): { world: World; state: IncidentState } {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the first floor.' }).state;
    s = addObservation(s, world.as(MIKA), { text: observation }).state;
    return { world, state: s };
  }

  it.each(MOVES)('%s: a responder who had confirmed the origin is not contradicted by the move', (_label, text) => {
    const { world, state } = beforeMove('I see them on the first floor');
    expect(lastDelta(state)).toMatchObject({ overall: 'confirmation' });

    const moved = addReport(state, world.as(ALEX), { text });
    expect(flagged(moved.events)).toEqual([]);
    expect(moved.state.contradictions).toEqual([]);
    expect(detectFieldConflicts(moved.state)).toEqual([]);
    expect(moved.state.claims.floor).toMatchObject({ value: 'Second floor', tag: 'user_reported', candidates: [] });
    // The responder's statement is still in the history.
    expect(moved.state.claims.floor.revisions.map((r) => r.value)).toEqual(['First floor', 'First floor', 'Second floor']);
    expect(lastDelta(moved.state)).toMatchObject({
      overall: 'correction',
      needsVerification: false,
      fields: [{ class: 'correction', reason: 'moved', previousValue: 'First floor', needsVerification: false }],
    });

    // Any arrival order of the same events gives the same state, with no conflict to flag.
    for (const seed of [1, 2, 3, 4, 5]) {
      const replayed = replay(moved.state.incidentId, shuffled(moved.state.events, seed));
      expect(replayed).toEqual(moved.state);
      expect(detectFieldConflicts(replayed)).toEqual([]);
      expect(lastDelta(replayed)).toEqual(lastDelta(moved.state));
    }
  });

  it('a contradiction opened before the move, about a third floor, stays open and nothing is withdrawn', () => {
    const { world, state } = beforeMove('I think they are on the third floor');
    expect(state.contradictions.map((c) => c.status)).toEqual(['open']);
    const before = state.contradictions[0];

    const moved = addReport(state, world.as(ALEX), { text: 'I moved from the first floor to the second floor' });
    expect(flagged(moved.events)).toEqual([]);
    expect(moved.state.contradictions).toEqual([before]);
    expect(moved.state.claims.floor).toMatchObject({ tag: 'unresolved', value: null });
    expect(moved.state.events.filter((e) => e.type === 'CONFLICT_RESOLVED')).toEqual([]);
    // The move is still the reporter's correction, but the third floor is not explained by it.
    expect(lastDelta(moved.state)).toMatchObject({
      overall: 'correction',
      needsVerification: true,
      fields: [{ class: 'correction', reason: 'moved', needsVerification: true }],
    });
  });

  it('a third floor named before the move and not yet flagged is flagged, not explained away', () => {
    const { world, state } = start();
    const alex = addReport(state, world.as(ALEX), { text: 'I am on the first floor.' });
    // Concurrent with the reporter's first statement, so no device has flagged it yet.
    const noah = addObservation(state, world.as(NOAH), { text: 'I think it is the third floor.' });
    const merged = replay(state.incidentId, [...alex.state.events, ...noah.events]);
    expect(merged.contradictions).toEqual([]);
    const moved = addReport(merged, world.as(ALEX), { text: 'I moved from the first floor to the second floor' });
    expect(flagged(moved.events)).toHaveLength(1);
    // Candidates are listed in replay order: the responder's statement came first.
    expect(moved.state.claims.floor.candidates).toEqual(['Third floor', 'Second floor']);
  });

  it('a responder naming the origin floor after the move is flagged', () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the first floor.' }).state;
    s = addReport(s, world.as(ALEX), { text: 'I moved from the first floor to the second floor' }).state;
    const late = addObservation(s, world.as(MIKA), { text: 'I see them on the first floor' });
    expect(flagged(late.events)).toHaveLength(1);
    expect(late.state.claims.floor).toMatchObject({ tag: 'unresolved', candidates: ['Second floor', 'First floor'] });
    expect(lastDelta(late.state)).toMatchObject({
      overall: 'possible_contradiction',
      needsVerification: true,
      fields: [{ reason: 'differs_from_other', previousValue: 'Second floor' }],
    });
  });

  it('a responder who restates the origin after the move is flagged even though they also said it before', () => {
    const { world, state } = beforeMove('I see them on the first floor');
    const s = addReport(state, world.as(ALEX), { text: 'I moved from the first floor to the second floor' }).state;
    const again = addObservation(s, world.as(MIKA), { text: 'Still the first floor from what I see' });
    expect(flagged(again.events)).toHaveLength(1);
  });

  it('a move away from a reporter-confirmed floor is still flagged', () => {
    const { world, state } = start();
    const confirmed = confirmClaim(state, world.as(ALEX), { field: 'floor', value: 'First floor' }).state;
    const moved = addReport(confirmed, world.as(ALEX), { text: 'I moved from the first floor to the second floor' });
    expect(flagged(moved.events)).toHaveLength(1);
    expect(lastDelta(moved.state)).toMatchObject({
      overall: 'possible_contradiction',
      needsVerification: true,
      fields: [{ reason: 'differs_from_confirmed' }],
    });
  });

  it('a responder reporting the move does not contradict the reporter’s earlier origin statement', () => {
    const { world, state } = start();
    const s = addReport(state, world.as(ALEX), { text: 'I am on the first floor.' }).state;
    const seen = addObservation(s, world.as(MIKA), { text: 'Alex moved from the first floor to the second floor' });
    expect(flagged(seen.events)).toEqual([]);
    // The reporter's own statement still leads the field; the responder's is kept in history.
    expect(seen.state.claims.floor).toMatchObject({ value: 'First floor', tag: 'user_reported' });
    expect(lastDelta(seen.state)).toMatchObject({
      overall: 'new_information',
      needsVerification: false,
      fields: [{ class: 'new_information', reason: 'moved', previousValue: 'First floor' }],
    });
  });
});

describe('classifyStatementDelta', () => {
  it('returns null for an unknown report and never the model-only class', () => {
    const { world, state } = start();
    const s = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' }).state;
    expect(classifyStatementDelta(s, 'rpt-missing')).toBeNull();
    expect(DELTA_CLASSES).toEqual([
      'new_information',
      'confirmation',
      'correction',
      'possible_contradiction',
      'unrelated',
      'no_meaningful_change',
    ]);
  });

  it('the first report is new information, one entry per field it stated', () => {
    const { world, state } = start();
    const s = addReport(state, world.as(ALEX), {
      text: 'Nasa 2nd floor ako ng Building B',
      claims: [{ field: 'incidentType', value: 'Slip on stairs' }],
    }).state;
    const delta = lastDelta(s);
    expect(delta).toMatchObject({ overall: 'new_information', needsVerification: false, duplicateOfReportId: null });
    // The incident-creation revision of incidentType is not a statement to compare against.
    expect(delta.fields.map((f) => [f.field, f.class, f.reason, f.againstRevisionId])).toEqual([
      ['incidentType', 'new_information', 'first_value', null],
      ['building', 'new_information', 'first_value', null],
      ['floor', 'new_information', 'first_value', null],
    ]);
  });

  it('a responder naming the same floor is a confirmation by a second source', () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' }).state;
    const observed = addObservation(s, world.as(MIKA), { text: 'Alex is on the 2nd floor.' });
    s = observed.state;
    expect(flagged(observed.events)).toEqual([]);
    expect(lastDelta(s)).toMatchObject({
      overall: 'confirmation',
      needsVerification: false,
      fields: [{ class: 'confirmation', reason: 'second_source', value: 'Second floor', previousValue: 'Second floor' }],
    });
    // It is not a reporter confirmation: the tag stays user_reported.
    expect(s.claims.floor.tag).toBe('user_reported');
  });

  it('a reporter restating the same floor is no meaningful change', () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' }).state;
    s = addReport(s, world.as(ALEX), { text: 'Still here, 2nd floor by the stairs.' }).state;
    expect(lastDelta(s)).toMatchObject({
      overall: 'no_meaningful_change',
      needsVerification: false,
      duplicateOfReportId: null,
      fields: [{ class: 'no_meaningful_change', reason: 'restated' }],
    });
  });

  it('restating a confirmed value is a restatement for the reporter and a second source for a responder', () => {
    const { world, state } = start();
    const confirmed = confirmClaim(state, world.as(ALEX), { field: 'floor', value: 'Second floor' }).state;
    const own = addReport(confirmed, world.as(ALEX), { text: 'second floor' }).state;
    expect(lastDelta(own)).toMatchObject({ overall: 'no_meaningful_change', fields: [{ reason: 'restated' }] });
    const other = addObservation(confirmed, world.as(MIKA), { text: 'second floor' }).state;
    expect(lastDelta(other)).toMatchObject({ overall: 'confirmation', fields: [{ reason: 'second_source' }] });
  });

  it('the overall class is the highest-priority field class', () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the second floor of Building B.' }).state;
    // Same building (confirmation), different floor (possible contradiction), new location text.
    s = addObservation(s, world.as(MIKA), {
      text: 'Alex is in Building B on the first floor.',
      claims: [{ field: 'locationText', value: 'near the stairs' }],
    }).state;
    const delta = lastDelta(s);
    expect(delta.fields.map((f) => [f.field, f.class])).toEqual([
      ['building', 'confirmation'],
      ['floor', 'possible_contradiction'],
      ['locationText', 'new_information'],
    ]);
    expect(delta).toMatchObject({ overall: 'possible_contradiction', needsVerification: true });

    // Correction outranks new information and confirmation.
    s = addObservation(s, world.as(MIKA), { text: 'Sorry, Building B, second floor.' }).state;
    expect(lastDelta(s).fields.map((f) => [f.field, f.class])).toEqual([
      ['building', 'no_meaningful_change'],
      ['floor', 'correction'],
    ]);
    expect(lastDelta(s).overall).toBe('correction');
  });

  it('an AI proposal is neither classified nor compared against', () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I fell near the stairs.' }).state;
    s = recordAIProposal(s, world.as(ALEX), {
      provider: 'synthetic-test-model',
      reportId: s.reports[0]!.id,
      findings: [{ field: 'floor', value: 'Fifth floor' }],
    }).state;
    expect(classifyStatementDelta(s, s.reports[0]!.id)).toMatchObject({ overall: 'not_assessed', fields: [] });

    s = addReport(s, world.as(ALEX), { text: 'I am on the second floor.' }).state;
    expect(lastDelta(s)).toMatchObject({
      overall: 'new_information',
      fields: [{ reason: 'first_value', againstRevisionId: null, previousValue: null }],
    });
  });

  it('a statement with no extractable field is not assessed', () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the second floor.' }).state;
    s = addReport(s, world.as(ALEX), { text: 'Please hurry, it is getting dark.' }).state;
    expect(lastDelta(s)).toEqual({
      reportId: s.reports[1]!.id,
      overall: 'not_assessed',
      fields: [],
      needsVerification: false,
      duplicateOfReportId: null,
    });
  });

  it('a repeat or near-repeat of the author’s own earlier text is no meaningful change', () => {
    const { world, state } = start();
    const original = 'Nadulas ako sa hagdan, masakit paa ko at kailangan ko ng tulong';
    let s = addReport(state, world.as(ALEX), { text: original }).state;
    const firstId = s.reports[0]!.id;

    const cases: [text: string, duplicate: boolean][] = [
      ['  nadulas ako sa hagdan,  MASAKIT paa ko at kailangan ko ng tulong!! ', true],
      ['Masakit paa ko, kailangan ko ng tulong', true],
      // 11 of 12 distinct tokens are in the original: 0.92 >= 0.9
      ['nadulas ako sa hagdan masakit paa ko at kailangan ko ng tulong po', true],
      // 4 of 6: 0.67 < 0.9
      ['kailangan ko ng tulong, madilim na', false],
      // Fewer than three distinct tokens: only an exact repeat would count.
      ['tulong', false],
    ];
    for (const [text, duplicate] of cases) {
      const next = addReport(s, world.as(ALEX), { text }).state;
      expect(lastDelta(next)).toMatchObject({
        overall: duplicate ? 'no_meaningful_change' : 'not_assessed',
        duplicateOfReportId: duplicate ? firstId : null,
        fields: [],
        needsVerification: false,
      });
    }

    // Somebody else saying the same words is not a duplicate of the reporter's statement.
    s = addObservation(s, world.as(MIKA), { text: original }).state;
    expect(lastDelta(s)).toMatchObject({ overall: 'not_assessed', duplicateOfReportId: null });
    // An exact repeat of a short statement matches.
    s = addObservation(s, world.as(MIKA), { text: 'On my way' }).state;
    s = addObservation(s, world.as(MIKA), { text: 'on my way.' }).state;
    expect(lastDelta(s)).toMatchObject({ overall: 'no_meaningful_change', duplicateOfReportId: s.reports.at(-2)?.id });
  });

  it('gives the same deltas for any arrival order of the same events', () => {
    const { world, state } = start();
    let s = addReport(state, world.as(ALEX), { text: 'I am on the first floor of Building B.' }).state;
    s = addObservation(s, world.as(MIKA), { text: 'Alex is on the first floor.' }).state;
    s = addReport(s, world.as(ALEX), { text: 'Lumipat ako mula first floor papunta sa second floor' }).state;
    s = addObservation(s, world.as(NOAH), { text: 'I think it is the third floor.' }).state;
    s = addObservation(s, world.as(NOAH), { text: 'Sorry, the second floor.' }).state;
    s = addReport(s, world.as(ALEX), { text: 'Please hurry.' }).state;
    s = addReport(s, world.as(ALEX), { text: 'please hurry' }).state;
    s = confirmClaim(s, world.as(ALEX), { field: 'building', value: 'Building B' }).state;
    s = addObservation(s, world.as(MIKA), { text: 'Looks like Building C to me.' }).state;

    const deltas = (x: IncidentState) => x.reports.map((r) => classifyStatementDelta(x, r.id));
    const expected = deltas(s);
    expect(expected.map((d) => d?.overall)).toEqual([
      'new_information',
      'confirmation',
      'correction',
      'possible_contradiction',
      'correction',
      'not_assessed',
      'no_meaningful_change',
      'possible_contradiction',
    ]);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const replayed = replay(s.incidentId, shuffled(s.events, seed));
      expect(replayed).toEqual(s);
      expect(deltas(replayed)).toEqual(expected);
    }
    // A restart: rebuild from serialized events only.
    const restored = replay(s.incidentId, JSON.parse(JSON.stringify(s.events)) as DomainEvent[]);
    expect(deltas(restored)).toEqual(expected);
    // Classifying is read-only.
    expect(replay(s.incidentId, s.events)).toEqual(s);
  });
});
