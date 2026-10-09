import { addObservation, addReport, confirmClaim, offerTask, prepareCapsule } from '../commands';
import { canReadItem, type DisclosurePolicy } from '../disclosure';
import { levelForDevice, projectForDevice, projectForLevel } from '../projection';
import {
  ALEX,
  JORDAN,
  MIKA,
  NOAH,
  PEERS,
  SAMPLE_REPORT,
  SAMPLE_SYMPTOM,
  STRANGER,
  codeOf,
  makeWorld,
  sosWithPeers,
} from '../testing/fixtures';

const OBSERVATION = 'I think Alex is near the vending machines.';

function incident(policy?: Pick<DisclosurePolicy, 'shareDetailedLocation' | 'shareSymptoms'>) {
  const world = makeWorld();
  let s = sosWithPeers(world).state;
  s = addReport(s, world.as(ALEX), {
    text: SAMPLE_REPORT,
    claims: [
      { field: 'symptom', value: SAMPLE_SYMPTOM },
      { field: 'locationText', value: 'sa may hagdan' },
    ],
  }).state;
  s = confirmClaim(s, world.as(ALEX), { field: 'floor', value: 'Second floor' }).state;
  s = addObservation(s, world.as(MIKA), { text: OBSERVATION }).state;
  s = offerTask(s, world.as(ALEX), { kind: 'go_to_requester', title: 'Go to Alex' }).state;
  if (policy) {
    s = prepareCapsule(s, world.as(ALEX), {
      policy: { ...policy, recipients: PEERS.map((p) => ({ deviceId: p.deviceId, level: p.level })) },
    }).state;
  }
  return { world, state: s };
}

const SECRETS = [SAMPLE_REPORT, SAMPLE_SYMPTOM, 'Masakit', 'Nadulas', 'hagdan', OBSERVATION, 'vending'];
const NAMES = ['Alex', 'Mika', 'Noah', 'Rivera'];
const CONTENT = [...SECRETS, ...NAMES, 'Building B', 'Second floor', 'Manual SOS', 'Go to Alex'];

describe('disclosure projection (invariant 6, domain part)', () => {
  it('relay level contains routing metadata and no content at all', () => {
    const { state } = incident({ shareDetailedLocation: true, shareSymptoms: true });
    const projection = projectForLevel(state, 'relay');

    expect(Object.keys(projection).sort()).toEqual(['level', 'routing']);
    expect(projection.routing).toEqual({
      incidentId: state.incidentId,
      reporterDeviceId: ALEX.deviceId,
      recipientDeviceIds: PEERS.map((p) => p.deviceId),
    });
    const json = JSON.stringify(projection);
    for (const text of CONTENT) expect(json).not.toContain(text);
  });

  it('trusted level reads type, building and assistance; floor only with shareDetailedLocation', () => {
    const closed = projectForLevel(incident({ shareDetailedLocation: false, shareSymptoms: true }).state, 'trusted');
    if (closed.level !== 'trusted') throw new Error('expected trusted projection');
    expect(Object.keys(closed.summary.fields).sort()).toEqual(['assistanceRequested', 'building', 'incidentType']);
    expect('floor' in closed.summary.fields).toBe(false);
    expect('locationText' in closed.summary.fields).toBe(false);
    expect(closed.summary.fields.building).toEqual({ value: 'Building B', tag: 'user_reported', candidates: [] });
    expect(JSON.stringify(closed)).not.toContain('Second floor');
    expect('detail' in closed).toBe(false);

    const open = projectForLevel(incident({ shareDetailedLocation: true, shareSymptoms: true }).state, 'trusted');
    if (open.level !== 'trusted') throw new Error('expected trusted projection');
    expect(open.summary.fields.floor).toEqual({ value: 'Second floor', tag: 'user_confirmed', candidates: [] });
    expect(open.summary.fields.locationText?.value).toBe('sa may hagdan');

    // Even with both switches on, trusted never reads the symptom or the report text.
    for (const projection of [closed, open]) {
      expect('symptom' in projection.summary.fields).toBe(false);
      const json = JSON.stringify(projection);
      for (const secret of [SAMPLE_REPORT, SAMPLE_SYMPTOM, 'Masakit', 'Nadulas', OBSERVATION]) expect(json).not.toContain(secret);
    }
  });

  it('authorized level reads symptom and report text only with shareSymptoms', () => {
    const closed = projectForLevel(incident({ shareDetailedLocation: true, shareSymptoms: false }).state, 'authorized');
    expect('detail' in closed).toBe(false);
    const closedJson = JSON.stringify(closed);
    for (const secret of [SAMPLE_REPORT, SAMPLE_SYMPTOM, 'Masakit', OBSERVATION]) expect(closedJson).not.toContain(secret);

    const open = projectForLevel(incident({ shareDetailedLocation: true, shareSymptoms: true }).state, 'authorized');
    if (open.level !== 'authorized' || !open.detail) throw new Error('expected restricted detail');
    expect(open.detail.symptom).toEqual({ value: SAMPLE_SYMPTOM, tag: 'user_reported', candidates: [] });
    expect(open.detail.reports.map((r) => r.text)).toEqual([SAMPLE_REPORT, OBSERVATION]);
  });

  it('before any capsule is prepared nobody but the owner reads floor, symptom or report', () => {
    const { state } = incident();
    expect(state.disclosure).toMatchObject({ shareDetailedLocation: false, shareSymptoms: false });
    for (const level of ['trusted', 'authorized'] as const) {
      const json = JSON.stringify(projectForLevel(state, level));
      expect(json).toContain('Building B');
      for (const hidden of ['Second floor', SAMPLE_SYMPTOM, SAMPLE_REPORT, OBSERVATION]) expect(json).not.toContain(hidden);
    }
  });

  it('never exposes revision history or evidence spans below owner', () => {
    const { state } = incident({ shareDetailedLocation: true, shareSymptoms: true });
    for (const level of ['relay', 'trusted', 'authorized'] as const) {
      const json = JSON.stringify(projectForLevel(state, level));
      for (const key of ['revisions', 'evidence', '"events"', 'aiFindings', 'timeline']) expect(json).not.toContain(key);
    }
    const owner = projectForLevel(state, 'owner');
    expect(owner.level === 'owner' && owner.state).toBe(state);
  });

  it('maps devices to levels: reporter is owner, unlisted devices are relays', () => {
    const { state } = incident({ shareDetailedLocation: true, shareSymptoms: true });
    expect(levelForDevice(state, ALEX.deviceId)).toBe('owner');
    expect(levelForDevice(state, MIKA.deviceId)).toBe('authorized');
    expect(levelForDevice(state, NOAH.deviceId)).toBe('trusted');
    expect(levelForDevice(state, JORDAN.deviceId)).toBe('relay');
    expect(levelForDevice(state, STRANGER.deviceId)).toBe('relay');
    expect(projectForDevice(state, STRANGER.deviceId).level).toBe('relay');
    expect(projectForDevice(state, JORDAN.deviceId)).toEqual(projectForLevel(state, 'relay'));
  });

  it('a capsule update replaces the policy: a dropped recipient falls back to relay', () => {
    const { world, state } = incident({ shareDetailedLocation: true, shareSymptoms: true });
    const s = prepareCapsule(state, world.as(ALEX), {
      policy: { shareDetailedLocation: false, shareSymptoms: false, recipients: [{ deviceId: NOAH.deviceId, level: 'trusted' }] },
    }).state;
    expect(levelForDevice(s, MIKA.deviceId)).toBe('relay');
    expect(s.recipients.find((r) => r.deviceId === MIKA.deviceId)?.level).toBe('relay');
    expect(s.capsules).toHaveLength(2);
    expect(codeOf(() => prepareCapsule(s, world.as(MIKA), { policy: s.disclosure }))).toBe('not_reporter');
  });

  it('the access matrix is exhaustive and deterministic', () => {
    const all = { shareDetailedLocation: true, shareSymptoms: true };
    const none = { shareDetailedLocation: false, shareSymptoms: false };
    const items = ['incidentType', 'building', 'floor', 'locationText', 'symptom', 'assistanceRequested', 'originalReport'] as const;
    for (const item of items) {
      expect(canReadItem('owner', item, none)).toBe(true);
      expect(canReadItem('relay', item, all)).toBe(false);
    }
    expect(items.filter((i) => canReadItem('trusted', i, none))).toEqual(['incidentType', 'building', 'assistanceRequested']);
    expect(items.filter((i) => canReadItem('trusted', i, all))).toEqual([
      'incidentType',
      'building',
      'floor',
      'locationText',
      'assistanceRequested',
    ]);
    expect(items.filter((i) => canReadItem('authorized', i, none))).toEqual(['incidentType', 'building', 'assistanceRequested']);
    expect(items.filter((i) => canReadItem('authorized', i, all))).toEqual([...items]);
  });
});
