import { EVENT_TYPES } from '../events';
import { fullScenario } from '../testing/fixtures';

describe('full synthetic scenario', () => {
  const scenario = fullScenario();

  it('applies every event and ends resolved', () => {
    expect(scenario.state.notApplied).toEqual([]);
    expect(scenario.state.status).toEqual({ status: 'resolved', reason: 'resolved_by_authorized_person' });
    expect(scenario.state.ledger.missingParents).toEqual([]);
  });

  it('exercises most of the vocabulary', () => {
    const used = new Set(scenario.events.map((e) => e.type));
    const unused = EVENT_TYPES.filter((t) => !used.has(t));
    expect(unused.sort()).toEqual(
      ['CLARIFICATION_SKIPPED', 'INCIDENT_CANCELLED', 'RESPONDER_DECLINED', 'TASK_DECLINED'].sort(),
    );
  });
});
