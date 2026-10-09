import type { AIResult, IncidentProposal, LocalAIService } from '@/ai';
import { SimulatedAI } from '@/demo/SimulatedAI';

import { createTestNet, dev, must, type TestNet } from '../testing/harness';

let net: TestNet;
afterEach(async () => {
  await net.dispose();
});

const DEVICE = { model: 'Test iPhone', osVersion: '0' };
const REPORT = 'I slipped on the stairs in Building B, second floor. My leg hurts and I need help.';

describe('diagnoseExtraction', () => {
  it('returns a proposal for free text without creating an incident, writing an event or sending anything', async () => {
    net = await createTestNet({ devices: ['a', 'b'], trust: [['a', 'b', 'authorized', 'trusted']] });
    const a = dev(net, 'a');
    const b = dev(net, 'b');
    const existing = must(await a.core.actions.sendSOS());
    await net.settle();
    const before = {
      snapshot: a.core.getSnapshot(),
      events: (await a.repo.eventsForIncident(existing.incidentId)).length,
      wire: net.wire.length,
      kv: JSON.stringify(a.kv.dump()),
    };

    const result = await a.core.actions.diagnoseExtraction(REPORT);
    await net.settle();
    if (!result.ok) throw new Error(result.state);
    expect(result.meta).toEqual({ source: 'simulated', latencyMs: 0 });
    expect(result.value.fields.building).toMatchObject({ value: 'Building B' });

    expect(await a.repo.allIncidentIds()).toEqual([existing.incidentId]);
    expect((await a.repo.eventsForIncident(existing.incidentId)).length).toBe(before.events);
    expect(await a.repo.getPendingOutbox()).toEqual([]);
    expect(net.wire).toHaveLength(before.wire);
    expect(JSON.stringify(a.kv.dump())).toBe(before.kv);
    expect(a.core.getSnapshot()).toBe(before.snapshot);
    expect(b.core.getSnapshot().incidents).toHaveLength(1);
  });

  it('trims and bounds the text, and never calls the model for empty input', async () => {
    const seen: string[] = [];
    const base = new SimulatedAI({ device: DEVICE, textCapable: true });
    const ai: LocalAIService = Object.assign(Object.create(base) as LocalAIService, {
      extractIncidentReport: async (raw: { text: string }): Promise<AIResult<IncidentProposal>> => {
        seen.push(raw.text);
        return base.extractIncidentReport(raw);
      },
    });
    net = await createTestNet({ devices: ['a'], perDevice: { a: { ai } } });
    const a = dev(net, 'a');

    expect((await a.core.actions.diagnoseExtraction(`  \n${REPORT}\t `)).ok).toBe(true);
    expect(seen).toEqual([REPORT]);
    await a.core.actions.diagnoseExtraction(`  ${'x'.repeat(9_000)}`);
    expect(seen[1]).toBe('x'.repeat(4_000));
    expect(await a.core.actions.diagnoseExtraction(' \n ')).toMatchObject({ ok: false, state: 'invalid_output', message: 'empty_input' });
    expect(await a.core.actions.diagnoseExtraction(42 as never)).toMatchObject({ ok: false, state: 'invalid_output', message: 'empty_input' });
    expect(seen).toHaveLength(2);
    expect(await a.repo.allIncidentIds()).toEqual([]);
  });

  it('reports the same unavailable state as the report flow, and a failing model as a native error', async () => {
    net = await createTestNet({
      devices: ['a', 'b'],
      perDevice: {
        a: { ai: new SimulatedAI({ device: DEVICE, textCapable: false }) },
        b: {
          ai: Object.assign(Object.create(new SimulatedAI({ device: DEVICE, textCapable: true })) as LocalAIService, {
            extractIncidentReport: async () => {
              throw new Error('model crashed');
            },
          }),
        },
      },
    });
    const a = dev(net, 'a');
    const { incidentId } = must(await a.core.actions.sendSOS());
    const { reportId } = must(await a.core.actions.addReport(incidentId, REPORT, 'typed'));
    const viaReport = await a.core.actions.analyzeReport(incidentId, reportId);
    const direct = await a.core.actions.diagnoseExtraction(REPORT);
    expect(direct).toMatchObject({ ok: false, state: 'unavailable' });
    expect(direct).toEqual(viaReport);

    expect(await dev(net, 'b').core.actions.diagnoseExtraction(REPORT)).toMatchObject({ ok: false, state: 'native_error', message: 'ai_call_failed' });
  });
});
