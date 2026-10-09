import { isEvidenceInReport } from '@/ai';

import { SAMPLE_REPORT } from '../personas';
import { SimulatedAI, simulatedExtract, simulatedFloor } from '../SimulatedAI';

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
});
