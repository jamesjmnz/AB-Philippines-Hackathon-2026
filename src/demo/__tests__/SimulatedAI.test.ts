import { PROPOSAL_FIELDS, isEvidenceInReport } from '@/ai';

import { SAMPLE_REPORT } from '../personas';
import { SimulatedAI, simulatedAssess, simulatedExtract, simulatedFloor, simulatedRelation } from '../SimulatedAI';

const device = { model: 'iPhone 17 Pro Max', osVersion: '26.0' };

describe('SimulatedAI', () => {
  it('extracts the design sample without inventing a floor or any severity', async () => {
    const ai = new SimulatedAI({ device, textCapable: true });
    const result = await ai.extractIncidentReport({ text: SAMPLE_REPORT });
    if (!result.ok) throw new Error(result.state);
    expect(result.meta).toEqual({ source: 'simulated', latencyMs: 0 });
    expect(result.value.fields).toEqual({
      incidentType: { value: 'Possible slip or fall', evidence: 'Nadulas ako sa hagdan' },
      building: { value: 'Building B', evidence: 'Building B' },
      symptom: { value: 'Leg pain', evidence: 'Masakit paa ko at kailangan ko ng tulong' },
      assistanceRequested: { value: 'Yes', evidence: 'kailangan ko ng tulong' },
    });
    expect(result.value.unknown.sort()).toEqual(['floor', 'locationText']);
    expect(result.value.dropped).toEqual([]);
    expect(JSON.stringify(result.value)).not.toMatch(/sever|priority|triage|diagnos/i);
    // Every proposed value points at words that are really in the report.
    for (const field of Object.values(result.value.fields)) expect(isEvidenceInReport(field.evidence, SAMPLE_REPORT)).toBe(true);
  });

  it('reports a floor only when the text names one', () => {
    expect(simulatedFloor('I am on the second floor near the stairs')).toEqual({ value: 'Second floor', evidence: 'second floor' });
    expect(simulatedFloor('nasa unang palapag ako')).toEqual({ value: 'First floor', evidence: 'unang palapag' });
    expect(simulatedFloor('ground floor lobby')?.value).toBe('Ground floor');
    expect(simulatedFloor('fifth floor')?.value).toBe('Fifth floor');
    expect(simulatedFloor('I fell on the floor')).toBeNull();
    expect(simulatedFloor('somewhere in Building B')).toBeNull();
    expect(simulatedExtract('I need help').fields).toEqual({ assistanceRequested: { value: 'Yes', evidence: 'need help' } });
    expect(simulatedExtract('...').fields).toEqual({});
  });

  it('labels its capabilities as a simulation and can be switched to unavailable', async () => {
    const ai = new SimulatedAI({ device, textCapable: true });
    expect(await ai.inspectCapabilities()).toMatchObject({ provider: 'Simulation', source: 'simulated', device, text: { state: 'ready' } });
    ai.setReady(false);
    expect((await ai.inspectCapabilities()).text.state).toBe('unavailable');
    expect(await ai.extractIncidentReport({ text: SAMPLE_REPORT })).toMatchObject({ ok: false, state: 'unavailable', meta: { source: 'simulated' } });
    expect(await ai.suggestClarification({ report: '', known: {}, skipped: [] })).toMatchObject({ ok: false, state: 'unavailable' });
    ai.setReady(true);
    expect((await ai.extractIncidentReport({ text: SAMPLE_REPORT })).ok).toBe(true);

    // A phone with no text model stays unavailable whatever the Demo Lab switch says.
    const old = new SimulatedAI({ device: { model: 'iPhone 13', osVersion: '26.0' }, textCapable: false });
    old.setReady(true);
    expect((await old.inspectCapabilities()).text.state).toBe('unavailable');
  });

  it('suggests one clarification at a time, flags differing floors, and only non-medical tasks', async () => {
    const ai = new SimulatedAI({ device, textCapable: true });
    expect(await ai.suggestClarification({ report: SAMPLE_REPORT, known: { building: 'Building B' }, skipped: [] })).toMatchObject({ ok: true, value: { field: 'floor' } });
    expect(await ai.suggestClarification({ report: SAMPLE_REPORT, known: {}, skipped: ['floor'] })).toMatchObject({ ok: true, value: { field: 'building' } });
    expect(await ai.suggestClarification({ report: SAMPLE_REPORT, known: { building: 'Building B', floor: 'Second floor' }, skipped: [] })).toMatchObject({ ok: true, value: null });

    const conflicts = await ai.findConflicts([
      { id: 's1', author: 'Alex', text: 'I am on the second floor' },
      { id: 's2', author: 'Mika', text: 'near the stairs' },
      { id: 's3', author: 'Noah', text: 'I think the first floor' },
    ]);
    expect(conflicts).toMatchObject({ ok: true, value: [{ field: 'floor', statementIds: ['s1', 's3'] }] });
    expect(await ai.findConflicts([{ id: 's1', author: 'Alex', text: 'second floor' }, { id: 's2', author: 'Mika', text: '2nd floor' }])).toMatchObject({ ok: true, value: [] });

    const tasks = await ai.proposeNonMedicalTasks({ report: SAMPLE_REPORT, known: {}, skipped: [] });
    expect(tasks.ok && tasks.value.map((t) => t.kind)).toEqual(['communicate', 'go_to_requester', 'confirm_location']);
    const similarity = await ai.compareSemanticReports('near the stairs', 'by the stairs');
    expect(similarity.ok && similarity.similarity > 0 && similarity.similarity < 1).toBe(true);
    expect(await ai.transcribeLocal({ wavBytes: new Uint8Array() }, 'fil-PH')).toMatchObject({ ok: true, value: { text: SAMPLE_REPORT, locale: 'fil-PH' } });
  });

  it('waits the configured delay through the injected timers', async () => {
    const waits: number[] = [];
    const ai = new SimulatedAI({
      device,
      textCapable: true,
      delayMs: 700,
      timers: {
        setTimeout: (fn, ms) => {
          waits.push(ms);
          fn();
          return 0;
        },
        clearTimeout: () => undefined,
        setInterval: () => 0,
        clearInterval: () => undefined,
      },
    });
    await ai.extractIncidentReport({ text: 'help' });
    ai.setDelay(0);
    await ai.extractIncidentReport({ text: 'help' });
    expect(waits).toEqual([700]);
  });

  describe('assessStatement', () => {
    const assess = async (statement: string, known: Parameters<SimulatedAI['assessStatement']>[0]['known'] = {}) => {
      const ai = new SimulatedAI({ device, textCapable: true });
      const result = await ai.assessStatement({ statement, known });
      if (!result.ok) throw new Error(result.state);
      return result;
    };

    it('reports what the statement states, each with words that are in the statement', async () => {
      const statement = 'I slipped near Building C, third floor. My leg hurts and I need help.';
      const result = await assess(statement);
      expect(result.meta).toEqual({ source: 'simulated', latencyMs: 0 });
      expect(result.value.fields).toEqual({
        incidentType: { value: 'Possible slip or fall', evidence: 'slipped' },
        building: { value: 'Building C', evidence: 'Building C' },
        floor: { value: 'Third floor', evidence: 'third floor' },
        symptom: { value: 'Leg pain', evidence: 'leg hurts' },
        assistanceRequested: { value: 'Yes', evidence: 'need help' },
      });
      for (const field of Object.values(result.value.fields)) expect(statement.includes(field.evidence)).toBe(true);
      expect(result.value.unknown).toEqual(['locationText']);
      expect(result.value.dropped).toEqual([]);
      // Nothing was known, so nothing was compared.
      expect(result.value.relations).toEqual({});
      expect(result.value.relationCall).toBe('skipped');
      expect(result.value.topic).toBe('about_request');
      expect(result.value.latenciesMs).toEqual([0]);
      expect(JSON.stringify(result.value)).not.toMatch(/sever|priority|triage|diagnos/i);
    });

    it('relates a free-text detail to the known one as same, adds_detail or different', async () => {
      // The known words are inside the new ones (and the reverse).
      expect((await assess('My leg hurts', { symptom: 'Leg pain' })).value.relations).toEqual({ symptom: 'same' });
      expect((await assess('It hurts', { symptom: 'it hurts a lot when I stand' })).value.relations).toEqual({ symptom: 'same' });
      // One content word in common.
      expect((await assess('My leg hurts', { symptom: 'arm pain' })).value.relations).toEqual({ symptom: 'adds_detail' });
      // Nothing in common.
      expect((await assess('My leg hurts', { symptom: 'dizzy' })).value.relations).toEqual({ symptom: 'different' });
      expect((await assess('I fell', { incidentType: 'locked in a room' })).value).toMatchObject({ relations: { incidentType: 'different' }, relationCall: 'ready' });
      expect((await assess('I slipped', { incidentType: 'Possible slip or fall' })).value.relations).toEqual({ incidentType: 'same' });

      expect(simulatedRelation('Leg pain', 'leg  PAIN.')).toBe('same');
      expect(simulatedRelation('pain', 'painting the wall')).toBe('different');
      expect(simulatedRelation('near the stairs', 'by the stairs')).toBe('adds_detail');
      expect(simulatedRelation('', 'pain')).toBe('different');
    });

    it('relates only details that are both stated and known, and never a floor or a building', async () => {
      const result = await assess('I am in Building B on the second floor and my leg hurts', {
        building: 'Building A',
        floor: 'First floor',
        locationText: 'near the canteen',
        incidentType: 'Possible slip or fall',
        symptom: 'Leg pain',
      });
      expect(result.value.fields.building?.value).toBe('Building B');
      expect(result.value.fields.floor?.value).toBe('Second floor');
      // Known but not stated (what happened, the place detail) is not compared; floor and building belong to the rules.
      expect(result.value.relations).toEqual({ symptom: 'same' });
      expect(result.value.relationCall).toBe('ready');

      // Stated but not known: no relation either.
      const fresh = await assess('my leg hurts', { building: 'Building A' });
      expect(fresh.value.relations).toEqual({});
      expect(fresh.value.relationCall).toBe('skipped');
      expect((await assess('my leg hurts', { symptom: '  ' })).value.relations).toEqual({});
    });

    it('calls a statement unrelated only when it states nothing and has no request word', async () => {
      expect((await assess('did anyone watch the game last night')).value).toMatchObject({ fields: {}, topic: 'unrelated', relations: {}, relationCall: 'skipped' });
      // Nothing structured, but still about the request.
      for (const text of ['which floor?', 'I am coming', 'papunta na ako', 'saan ka?', 'hurry', 'bilisan ninyo', 'we are here', 'nandito kami dito']) {
        const result = await assess(text);
        expect(result.value.fields).toEqual({});
        expect(result.value.topic).toBe('about_request');
      }
      // A stated field always makes it about the request.
      expect((await assess('my leg hurts')).value.topic).toBe('about_request');
      expect((await assess('')).value).toMatchObject({ fields: {}, topic: 'unrelated', latenciesMs: [0] });
    });

    it('never proposes a value without words from the statement behind it', async () => {
      const statements = ['', '...', 'ok', 'Nadulas ako sa hagdan. Masakit paa ko.', 'second floor, Building B, need help', 'the floor is wet', 'BUILDING 7 help!!', SAMPLE_REPORT];
      for (const statement of statements) {
        const result = await assess(statement, { floor: 'Ninth floor', building: 'Building Z', symptom: 'headache', incidentType: 'trapped', locationText: 'roof' });
        for (const field of Object.values(result.value.fields)) {
          expect(field.evidence.length).toBeGreaterThan(0);
          expect(statement.includes(field.evidence)).toBe(true);
        }
        // What is known is never copied into what the statement is said to state.
        expect(JSON.stringify(result.value.fields)).not.toMatch(/Ninth|Building Z|headache|trapped|roof/);
        expect(Object.keys(result.value.fields).sort()).toEqual(PROPOSAL_FIELDS.filter((f) => !result.value.unknown.includes(f)).sort());
      }
    });

    it('is unavailable exactly as extraction is when the model is switched off, and never throws', async () => {
      const ai = new SimulatedAI({ device, textCapable: true });
      ai.setReady(false);
      const extraction = await ai.extractIncidentReport({ text: SAMPLE_REPORT });
      const assessment = await ai.assessStatement({ statement: SAMPLE_REPORT, known: {} });
      expect(assessment).toEqual(extraction);
      expect(assessment).toMatchObject({ ok: false, state: 'unavailable', meta: { source: 'simulated', latencyMs: 0 } });
      ai.setReady(true);
      expect((await ai.assessStatement({ statement: SAMPLE_REPORT, known: {} })).ok).toBe(true);

      const old = new SimulatedAI({ device: { model: 'iPhone 13', osVersion: '26.0' }, textCapable: false });
      old.setReady(true);
      expect(await old.assessStatement({ statement: 'help', known: {} })).toMatchObject({ ok: false, state: 'unavailable' });

      // Input that breaks the contract still gets an answer.
      const broken = undefined as unknown as Parameters<SimulatedAI['assessStatement']>[0];
      await expect(ai.assessStatement(broken)).resolves.toMatchObject({ ok: true, value: { fields: {}, topic: 'unrelated' }, meta: { source: 'simulated', latencyMs: 0 } });
      expect(simulatedAssess({ statement: 'help', known: {} }).topic).toBe('about_request');
    });

    it('waits the configured delay like the other calls', async () => {
      const waits: number[] = [];
      const ai = new SimulatedAI({
        device,
        textCapable: true,
        delayMs: 400,
        timers: {
          setTimeout: (fn, ms) => {
            waits.push(ms);
            fn();
            return 0;
          },
          clearTimeout: () => undefined,
          setInterval: () => 0,
          clearInterval: () => undefined,
        },
      });
      const result = await ai.assessStatement({ statement: 'help', known: {} });
      expect(waits).toEqual([400]);
      // The wait is not reported as a measured latency.
      expect(result.meta.latencyMs).toBe(0);
    });
  });
});
