import type { AIResult, IncidentProposal, LocalAIService, Transcript } from '@/ai';
import { SimulatedAI } from '@/demo/SimulatedAI';

import { createTestNet, dev, must, type TestNet } from '../testing/harness';

let net: TestNet;
afterEach(async () => {
  await net.dispose();
});

const REPORT = 'Nadulas ako sa hagdan sa Building B. Masakit paa ko at kailangan ko ng tulong.';

describe('AI-backed actions', () => {
  it('returns the proposal unchanged, records it only as AI-proposed, and promotes a field only when the reporter confirms', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']] });
    const a = dev(net, 'a');
    const { incidentId } = must(await a.core.actions.sendSOS());
    const { reportId } = must(await a.core.actions.addReport(incidentId, REPORT, 'transcribed'));

    const analysis = await a.core.actions.analyzeReport(incidentId, reportId);
    if (!analysis.ok) throw new Error(analysis.state);
    expect(analysis.meta).toEqual({ source: 'simulated', latencyMs: 0 });
    expect(Object.keys(analysis.value.fields).sort()).toEqual(['assistanceRequested', 'building', 'incidentType', 'symptom']);
    expect(analysis.value.unknown).toEqual(expect.arrayContaining(['floor', 'locationText']));
    // Analysing records nothing.
    expect(a.incident(incidentId)?.state.aiFindings).toHaveLength(0);

    must(await a.core.actions.attachProposal(incidentId, reportId, analysis.value));
    const proposed = a.incident(incidentId)?.state;
    expect(proposed?.aiFindings).toHaveLength(4);
    expect(proposed?.aiFindings.every((f) => f.evidenceVerified === true)).toBe(true);
    expect(proposed?.claims.symptom).toMatchObject({ value: 'Leg pain', tag: 'ai_proposed' });
    // A human statement is never replaced by a proposal.
    expect(proposed?.claims.incidentType).toMatchObject({ value: 'Manual SOS', tag: 'user_reported' });
    expect(proposed?.claims.floor).toMatchObject({ value: null, tag: 'unknown' });
    const symptomFact = a.incident(incidentId)?.facts.find((f) => f.field === 'symptom');
    expect(symptomFact).toMatchObject({ tag: 'ai_proposed', evidence: 'Masakit paa ko at kailangan ko ng tulong' });

    must(await a.core.actions.confirmFact(incidentId, 'symptom', 'Leg pain'));
    must(await a.core.actions.confirmFact(incidentId, 'incidentType', 'Possible slip or fall'));
    const confirmed = a.incident(incidentId)?.state;
    expect(confirmed?.claims.symptom).toMatchObject({ value: 'Leg pain', tag: 'user_confirmed' });
    expect(confirmed?.claims.incidentType).toMatchObject({ value: 'Possible slip or fall', tag: 'user_confirmed' });
    expect(confirmed?.aiFindings.find((f) => f.field === 'symptom')?.confirmedByEventId).not.toBeNull();

    // A responder cannot confirm facts about someone else's request.
    await net.settle();
    expect(await dev(net, 'b').core.actions.confirmFact(incidentId, 'building', 'Building C')).toMatchObject({ ok: false, code: 'not_reporter' });
  });

  it('asks for the missing floor, records an answer or a skip, and stops asking after a skip', async () => {
    net = await createTestNet({ devices: ['a'] });
    const a = dev(net, 'a');
    const { incidentId } = must(await a.core.actions.sendSOS());
    must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));

    const first = await a.core.actions.suggestClarification(incidentId);
    expect(first).toMatchObject({ ok: true, value: { field: 'floor' } });
    must(await a.core.actions.skipClarification(incidentId, 'floor'));
    expect(a.incident(incidentId)?.state.questions).toEqual([expect.objectContaining({ field: 'floor', status: 'skipped' })]);
    expect(a.incident(incidentId)?.state.claims.floor.value).toBeNull();
    expect(await a.core.actions.suggestClarification(incidentId)).toMatchObject({ ok: true, value: null });

    // The person can still volunteer it later; free text is normalised by the deterministic rule, not by AI.
    must(await a.core.actions.answerClarification(incidentId, 'floor', 'nasa ikalawang palapag ako'));
    expect(a.incident(incidentId)?.state.claims.floor).toMatchObject({ value: 'Second floor', tag: 'user_confirmed' });

    const tasks = await a.core.actions.suggestTasks(incidentId);
    expect(tasks.ok && tasks.value.map((t) => t.kind)).toEqual(['communicate', 'go_to_requester', 'confirm_location']);
    must(await a.core.actions.offerTask(incidentId, { kind: 'communicate', title: 'Communicate with staff', aiSuggested: true }));
    expect(a.incident(incidentId)?.state.tasks[0]).toMatchObject({ origin: 'ai_suggested', status: 'unassigned' });
  });

  it('says so when the model is unavailable and leaves the report as written', async () => {
    const ai = new SimulatedAI({ device: { model: 'iPhone 13', osVersion: '26.0' }, textCapable: false });
    net = await createTestNet({ devices: ['a'], perDevice: { a: { ai } } });
    const a = dev(net, 'a');
    expect(a.core.getSnapshot().capabilities).toMatchObject({ source: 'simulated', text: { state: 'unavailable' } });
    const { incidentId } = must(await a.core.actions.sendSOS());
    const { reportId } = must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    expect(await a.core.actions.analyzeReport(incidentId, reportId)).toMatchObject({ ok: false, state: 'unavailable' });
    expect(await a.core.actions.analyzeReport(incidentId, 'rpt-missing')).toMatchObject({ ok: false, state: 'invalid_output' });
    expect(a.incident(incidentId)?.originalReport).toBe(REPORT);
    expect(a.incident(incidentId)?.state.aiFindings).toHaveLength(0);
    // The deterministic rule still found the building.
    expect(a.incident(incidentId)?.state.claims.building).toMatchObject({ value: 'Building B', tag: 'user_reported' });
  });

  it('transcribes through the injected file reader and maps failures to typed results', async () => {
    const seen: { bytes: number; locale: string }[] = [];
    const base = new SimulatedAI({ device: { model: 'Test', osVersion: '0' }, textCapable: true });
    let next: AIResult<Transcript> = { ok: true, value: { text: 'tulong po', locale: 'fil-PH', durationSeconds: 2 }, meta: { source: 'simulated', latencyMs: 0 } };
    const ai: LocalAIService = {
      inspectCapabilities: () => base.inspectCapabilities(),
      extractIncidentReport: (raw): Promise<AIResult<IncidentProposal>> => base.extractIncidentReport(raw),
      suggestClarification: (c) => base.suggestClarification(c),
      findConflicts: (s) => base.findConflicts(s),
      proposeNonMedicalTasks: (c) => base.proposeNonMedicalTasks(c),
      compareSemanticReports: (x, y) => base.compareSemanticReports(x, y),
      transcribeLocal: async (audio, locale) => {
        seen.push({ bytes: audio.wavBytes.byteLength, locale });
        return next;
      },
    };
    net = await createTestNet({ devices: ['a'], perDevice: { a: { ai } } });
    const a = dev(net, 'a');
    expect(await a.core.actions.transcribe('file:///tmp/report.wav', 'fil-PH')).toEqual({ ok: true, value: { text: 'tulong po' }, meta: { source: 'simulated', latencyMs: 0 } });
    expect(seen).toEqual([{ bytes: 3, locale: 'fil-PH' }]);

    next = { ok: false, state: 'unsupported_locale', message: 'no', meta: { source: 'simulated', latencyMs: 0 } };
    expect(await a.core.actions.transcribe('file:///tmp/report.wav', 'xx-XX')).toMatchObject({ ok: false, state: 'unsupported_locale' });
  });
});
