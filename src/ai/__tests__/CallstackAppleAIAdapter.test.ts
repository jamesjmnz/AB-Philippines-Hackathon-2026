import { CallstackAppleAIAdapter } from '../callstack/CallstackAppleAIAdapter';
import type { AppleRuntime } from '../callstack/runtime.types';

const REPORT = 'Nadulas ako sa hagdan sa Building B. Masakit paa ko at kailangan ko ng tulong.';

function field(value: string, evidence: string) {
  return { value, evidence };
}
const unknown = field('unknown', '');

function runtime(overrides: Partial<AppleRuntime> = {}): AppleRuntime {
  return {
    packageVersion: '0.12.0',
    device: () => ({ model: 'Test iPhone', osVersion: '26.0' }),
    isTextAvailable: () => true,
    generateObject: async () => ({}),
    embeddingInfo: async () => ({ hasAvailableAssets: true, dimension: 512 }),
    embed: async (texts) => texts.map(() => [1, 0]),
    isTranscriptionAvailable: () => true,
    transcribe: async () => ({ text: 'hello', durationSeconds: 1 }),
    ...overrides,
  };
}

describe('CallstackAppleAIAdapter.extractIncidentReport', () => {
  it('keeps only fields whose evidence is verbatim in the report', async () => {
    const ai = new CallstackAppleAIAdapter(
      runtime({
        generateObject: async () => ({
          incidentType: field('Slipped on stairs', 'Nadulas ako sa hagdan'),
          building: field('Building B', 'Building B'),
          floor: field('Second floor', 'second floor'), // invented: not in the report
          locationText: unknown,
          symptom: field('Masakit paa ko', 'masakit  PAA ko'),
          assistanceRequested: field('yes', 'kailangan ko ng tulong'),
        }),
      }),
    );
    const r = await ai.extractIncidentReport({ text: REPORT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fields.building).toEqual({ value: 'Building B', evidence: 'Building B' });
    expect(r.value.fields.symptom?.value).toBe('Masakit paa ko');
    expect(r.value.fields.assistanceRequested?.value).toBe('Yes');
    expect(r.value.fields.floor).toBeUndefined();
    expect(r.value.dropped).toEqual(['floor']);
    expect(r.value.unknown).toEqual(expect.arrayContaining(['floor', 'locationText']));
    expect(r.meta.source).toBe('callstack-apple');
  });

  it('drops medical severity judgements even when evidence is quoted', async () => {
    const ai = new CallstackAppleAIAdapter(
      runtime({
        generateObject: async () => ({
          incidentType: field('Severe leg fracture', 'Masakit paa ko'),
          building: unknown,
          floor: unknown,
          locationText: unknown,
          symptom: field('Critical injury', 'Masakit paa ko'),
          assistanceRequested: unknown,
        }),
      }),
    );
    const r = await ai.extractIncidentReport({ text: REPORT });
    expect(r.ok && r.value.fields).toEqual({});
    expect(r.ok && r.value.dropped).toEqual(['incidentType', 'symptom']);
  });

  it('ignores extra keys such as age or severity by failing strict structure', async () => {
    const ai = new CallstackAppleAIAdapter(runtime({ generateObject: async () => ({ incidentType: 'fall', severity: 'high', age: 30 }) }));
    const r = await ai.extractIncidentReport({ text: REPORT });
    expect(r).toMatchObject({ ok: false, state: 'invalid_output' });
  });

  it('returns unavailable without calling the model when the text model is off', async () => {
    const generateObject = jest.fn();
    const ai = new CallstackAppleAIAdapter(runtime({ isTextAvailable: () => false, generateObject }));
    const r = await ai.extractIncidentReport({ text: REPORT });
    expect(r).toMatchObject({ ok: false, state: 'unavailable' });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 'MODEL_UNAVAILABLE', message: 'Apple Intelligence model is not available' }, 'unavailable'],
    [{ code: 'AppleLLM', message: 'Detected content likely to be unsafe' }, 'guardrail_refusal'],
    [{ code: 'AppleLLM', message: 'The model refused to answer' }, 'guardrail_refusal'],
    [{ code: 'AppleLLM', message: 'Unsupported language or locale' }, 'unsupported_locale'],
    [{ code: 'AppleLLM', message: 'Model assets are unavailable' }, 'model_assets_missing'],
    [{ code: 'AppleLLM', message: 'Exceeded model context window size' }, 'native_error'],
    [{ name: 'AI_NoObjectGeneratedError', message: 'No object generated: could not parse the response.' }, 'invalid_output'],
  ])('classifies provider error %j as %s', async (error, state) => {
    const ai = new CallstackAppleAIAdapter(
      runtime({
        generateObject: async () => {
          throw Object.assign(new Error(error.message), error);
        },
      }),
    );
    const r = await ai.extractIncidentReport({ text: REPORT });
    expect(r).toMatchObject({ ok: false, state });
  });

  it('times out and aborts instead of hanging', async () => {
    let aborted = false;
    const ai = new CallstackAppleAIAdapter(
      runtime({
        generateObject: ({ signal }) =>
          new Promise(() => {
            signal.addEventListener('abort', () => {
              aborted = true;
            });
          }),
      }),
      { timeoutMs: 20 },
    );
    const r = await ai.extractIncidentReport({ text: REPORT });
    expect(r).toMatchObject({ ok: false, state: 'timeout' });
    expect(aborted).toBe(true);
  });

  it('never throws when availability itself throws', async () => {
    const ai = new CallstackAppleAIAdapter(
      runtime({
        isTextAvailable: () => {
          throw new Error('native module missing');
        },
      }),
    );
    await expect(ai.extractIncidentReport({ text: REPORT })).resolves.toMatchObject({ ok: false, state: 'unavailable' });
  });
});

describe('CallstackAppleAIAdapter.suggestClarification', () => {
  const context = { report: REPORT, known: { building: 'Building B' }, skipped: [] as const };

  it('proposes one question about a missing field', async () => {
    const ai = new CallstackAppleAIAdapter(runtime({ generateObject: async () => ({ field: 'floor', question: 'Which floor of Building B are you on' }) }));
    const r = await ai.suggestClarification(context);
    expect(r.ok && r.value).toEqual({ field: 'floor', question: 'Which floor of Building B are you on?' });
  });

  it('rejects a question about a field that is already known', async () => {
    const ai = new CallstackAppleAIAdapter(runtime({ generateObject: async () => ({ field: 'building', question: 'Which building?' }) }));
    const r = await ai.suggestClarification(context);
    expect(r.ok && r.value).toBeNull();
  });

  it('does not ask again about a skipped field and skips the model when nothing is missing', async () => {
    const generateObject = jest.fn();
    const ai = new CallstackAppleAIAdapter(runtime({ generateObject }));
    const r = await ai.suggestClarification({
      report: REPORT,
      known: { building: 'Building B', locationText: 'stairs', assistanceRequested: 'Yes' },
      skipped: ['floor'],
    });
    expect(r.ok && r.value).toBeNull();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('rejects medical questions', async () => {
    const ai = new CallstackAppleAIAdapter(runtime({ generateObject: async () => ({ field: 'floor', question: 'How severe is the fracture?' }) }));
    const r = await ai.suggestClarification(context);
    expect(r.ok && r.value).toBeNull();
  });
});

describe('CallstackAppleAIAdapter.findConflicts', () => {
  const statements = [
    { id: 's1', author: 'Alex', text: 'I am on the second floor of Building B.' },
    { id: 's2', author: 'Mika', text: 'I think Alex is on the first floor.' },
  ];

  it('returns validated conflicts and ignores unknown ids and duplicates', async () => {
    const ai = new CallstackAppleAIAdapter(
      runtime({
        generateObject: async () => ({
          conflicts: [
            { field: 'floor', first: '[s1]', second: 's2', note: 'Different floors reported.' },
            { field: 'floor', first: 's2', second: 's1', note: 'Duplicate.' },
            { field: 'floor', first: 's1', second: 's9', note: 'Unknown id.' },
            { field: 'building', first: 's1', second: 's1', note: 'Same statement.' },
          ],
        }),
      }),
    );
    const r = await ai.findConflicts(statements);
    expect(r.ok && r.value).toEqual([{ field: 'floor', statementIds: ['s1', 's2'], note: 'Different floors reported.' }]);
  });

  it('does not call the model for fewer than two statements', async () => {
    const generateObject = jest.fn();
    const ai = new CallstackAppleAIAdapter(runtime({ generateObject }));
    const r = await ai.findConflicts(statements.slice(0, 1));
    expect(r.ok && r.value).toEqual([]);
    expect(generateObject).not.toHaveBeenCalled();
  });
});

describe('CallstackAppleAIAdapter.proposeNonMedicalTasks', () => {
  it('filters medical tasks and caps the list at three', async () => {
    const ai = new CallstackAppleAIAdapter(
      runtime({
        generateObject: async () => ({
          tasks: [
            { kind: 'communicate', title: 'Contact building security' },
            { kind: 'other', title: 'Give first aid to the leg' },
            { kind: 'go_to_requester', title: 'Meet requester near the stairs' },
            { kind: 'other', title: 'Move the person downstairs' },
            { kind: 'confirm_location', title: 'Confirm which floor' },
            { kind: 'other', title: 'Guide others to Building B' },
          ],
        }),
      }),
    );
    const r = await ai.proposeNonMedicalTasks({ report: REPORT, known: {}, skipped: [] });
    expect(r.ok && r.value.map((t) => t.title)).toEqual(['Contact building security', 'Meet requester near the stairs', 'Confirm which floor']);
  });
});

describe('CallstackAppleAIAdapter embeddings, transcription and capabilities', () => {
  it('computes cosine similarity from real vectors', async () => {
    const ai = new CallstackAppleAIAdapter(runtime({ embed: async () => [[1, 0], [0, 1]] }));
    const r = await ai.compareSemanticReports('a', 'b');
    expect(r).toMatchObject({ ok: true, similarity: 0, language: 'en' });
  });

  it('reports unsupported_locale for a language the embedding model rejects', async () => {
    const ai = new CallstackAppleAIAdapter(
      runtime({
        embed: async () => {
          throw Object.assign(new Error('Failed to create NLContextualEmbedding for language: tl'), { code: 'AppleEmbeddings' });
        },
      }),
      { embeddingLanguage: 'tl' },
    );
    await expect(ai.compareSemanticReports('a', 'b')).resolves.toMatchObject({ ok: false, state: 'unsupported_locale' });
  });

  it('reports unsupported_locale when the transcription locale is rejected', async () => {
    const ai = new CallstackAppleAIAdapter(
      runtime({
        transcribe: async () => {
          throw Object.assign(new Error('Locale not supported: fil-PH'), { code: 'AppleTranscription' });
        },
      }),
    );
    await expect(ai.transcribeLocal({ wavBytes: new Uint8Array(4) }, 'fil-PH')).resolves.toMatchObject({ ok: false, state: 'unsupported_locale' });
  });

  it('keeps capabilities independent of each other', async () => {
    const ai = new CallstackAppleAIAdapter(runtime({ isTextAvailable: () => false, embeddingInfo: async () => ({ hasAvailableAssets: false, dimension: 512 }) }));
    const caps = await ai.inspectCapabilities();
    expect(caps.text.state).toBe('unavailable');
    expect(caps.embeddings.state).toBe('model_assets_missing');
    expect(caps.transcription.state).toBe('ready');
    expect(caps.provider).toBe('Callstack Apple');
  });
});
