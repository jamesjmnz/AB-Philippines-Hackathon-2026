import { containsMedicalJudgement, isEvidenceInReport, locateEvidence, normalizeForMatch } from '../evidence';

/** The check as it was before `locateEvidence`: whole-string normalisation and a substring test. */
function legacyIsEvidenceInReport(evidence: string, report: string): boolean {
  const needle = normalizeForMatch(evidence).replace(/^["'.,;:!?\s]+|["'.,;:!?\s]+$/g, '');
  if (needle.length < 2) return false;
  return normalizeForMatch(report).includes(needle);
}

/** Small deterministic generator so the property checks are repeatable. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const PIECES = [
  'Nadulas', 'ako', 'sa', 'hagdan', 'Building', 'B', 'second', 'floor', 'ikalawang', 'palapag', 'tulong', 'Help', 'me',
  ' ', '  ', '\n', '\t', ' ', '. ', ', ', '! ', '?', '“', '”', '‘', '’', '"', "'",
  'ﬁre', 'oﬃce', '２', '３F', 'Ｂｌｄｇ', 'café', 'Piña', 'ñ', 'İstanbul', 'ΣΟΣ', 'ǅ',
  '🙏', '😭', '👨‍👩‍👧', '🇵🇭', '👍🏽', '한국', '한', '½', '…', '№', '㎏', '́',
];

function randomText(next: () => number, pieces: number): string {
  let out = '';
  for (let i = 0; i < pieces; i++) out += PIECES[Math.floor(next() * PIECES.length)];
  return out;
}

describe('locateEvidence', () => {
  it('returns the exact original substring for a plain quote', () => {
    const report = 'Nadulas ako sa hagdan sa Building B.';
    expect(locateEvidence(report, 'Building B')).toEqual({ start: 25, end: 35, text: 'Building B' });
  });

  it('holds the slice invariant, and agrees with the old check, over many generated inputs', () => {
    const next = rng(20261010);
    let located = 0;
    for (let round = 0; round < 3000; round++) {
      const report = randomText(next, 3 + Math.floor(next() * 14));
      // Half the quotes are cut out of the report (at arbitrary code-unit offsets), half are unrelated.
      let quote: string;
      if (next() < 0.5 && report.length > 0) {
        const a = Math.floor(next() * report.length);
        const b = a + 1 + Math.floor(next() * (report.length - a));
        quote = report.slice(a, b);
        if (next() < 0.3) quote = quote.toUpperCase();
        if (next() < 0.3) quote = `  ${quote.replace(/ /g, ' \n ')}. `;
      } else {
        quote = randomText(next, 1 + Math.floor(next() * 3));
      }
      const span = locateEvidence(report, quote);
      if (span) {
        located += 1;
        expect(span.start).toBeGreaterThanOrEqual(0);
        expect(span.end).toBeGreaterThan(span.start);
        expect(span.end).toBeLessThanOrEqual(report.length);
        expect(report.slice(span.start, span.end)).toBe(span.text);
        // The span is itself evidence, and it does not split a surrogate pair.
        expect(isEvidenceInReport(span.text, report)).toBe(true);
        expect(/^[\udc00-\udfff]/.test(span.text)).toBe(false);
        expect(/[\ud800-\udbff]$/.test(span.text)).toBe(false);
      }
      expect(isEvidenceInReport(quote, report)).toBe(span !== null);
    }
    expect(located).toBeGreaterThan(500);
  });

  it('agrees with the previous substring check on ordinary text', () => {
    const next = rng(7);
    const words = ['Nadulas', 'ako', 'sa', 'hagdan', 'Building', 'B', '“second', 'floor”', 'tulong!', 'it’s', 'Help', 'me.', '2nd', ' ', '\n', '  '];
    for (let round = 0; round < 2000; round++) {
      const pick = () => words[Math.floor(next() * words.length)];
      const report = Array.from({ length: 4 + Math.floor(next() * 10) }, pick).join(' ');
      const quote = Array.from({ length: 1 + Math.floor(next() * 3) }, pick).join(next() < 0.5 ? ' ' : '  ');
      expect(locateEvidence(report, quote) !== null).toBe(legacyIsEvidenceInReport(quote, report));
    }
  });

  it('matches straight quotes against curly ones and returns the curly original', () => {
    const report = 'Sabi niya “nasa second floor ako” at it’s dark.';
    const span = locateEvidence(report, '"nasa second floor ako" at it\'s dark');
    expect(span?.text).toBe('nasa second floor ako” at it’s dark');
    expect(locateEvidence('He said "wait here"', 'said “wait here”')?.text).toBe('said "wait here');
  });

  it('matches across doubled spaces and newlines, on either side', () => {
    const report = 'Nasa   second\n\nfloor ako ng Building B';
    const a = locateEvidence(report, 'second floor ako');
    expect(a).toEqual({ start: 7, end: 24, text: 'second\n\nfloor ako' });
    const b = locateEvidence('Nasa second floor ako', 'second \n  floor\tako');
    expect(b?.text).toBe('second floor ako');
  });

  it('ignores case and keeps the original casing in the span', () => {
    expect(locateEvidence('nasa BUILDING b ako', 'Building B')?.text).toBe('BUILDING b');
  });

  it('strips punctuation from the edges of the quote', () => {
    const report = 'Masakit paa ko at kailangan ko ng tulong';
    expect(locateEvidence(report, '"kailangan ko ng tulong."')).toEqual({ start: 18, end: 40, text: 'kailangan ko ng tulong' });
    expect(locateEvidence(report, '  Masakit paa ko!?  ')?.text).toBe('Masakit paa ko');
  });

  it('keeps UTF-16 offsets right after emoji and combining marks', () => {
    const report = '😭🙏 Piña café 👨‍👩‍👧 nasa second floor';
    const span = locateEvidence(report, 'second floor');
    expect(span).not.toBeNull();
    expect(span?.start).toBe(report.indexOf('second floor'));
    expect(report.slice(span?.start, span?.end)).toBe('second floor');
    // A precomposed quote finds the decomposed original, and the span keeps the combining mark.
    expect(locateEvidence(report, 'CAFÉ')?.text).toBe('café');
  });

  it('keeps offsets right when NFKC changes lengths', () => {
    const report = 'May ﬁre sa oﬃce, nasa ２/F ng Ｂｌｄｇ ３ kami';
    expect(locateEvidence(report, 'nasa 2/F')).toEqual({ start: report.indexOf('nasa'), end: report.indexOf('nasa') + 8, text: 'nasa ２/F' });
    expect(locateEvidence(report, 'bldg 3 kami')?.text).toBe('Ｂｌｄｇ ３ kami');
    expect(locateEvidence(report, 'fire sa office')?.text).toBe('ﬁre sa oﬃce');
    // A match that starts inside a ligature widens to the whole ligature.
    expect(locateEvidence(report, 'ice, nasa')?.text).toBe('ﬃce, nasa');
  });

  it('locates Tagalog text', () => {
    const report = 'Nadulas po ako sa hagdan. Nasa ikalawang palapag ako ng Gusali B, hindi ako makatayo.';
    const span = locateEvidence(report, 'nasa ikalawang palapag ako');
    expect(span?.text).toBe('Nasa ikalawang palapag ako');
    expect(locateEvidence(report, 'HINDI AKO MAKATAYO.')?.text).toBe('hindi ako makatayo');
  });

  it('prefers the first occurrence', () => {
    expect(locateEvidence('tulong po, tulong!', 'tulong')).toEqual({ start: 0, end: 6, text: 'tulong' });
  });

  it('returns null for a quote that is not there', () => {
    expect(locateEvidence('Nadulas ako sa hagdan sa Building B.', 'second floor')).toBeNull();
    expect(locateEvidence('', 'second floor')).toBeNull();
  });

  it('returns null for a quote that is too short', () => {
    expect(locateEvidence('a b c', 'a')).toBeNull();
    expect(locateEvidence('a b c', '')).toBeNull();
    expect(locateEvidence('wait... what', ' "." ')).toBeNull();
    expect(isEvidenceInReport('B', 'Building B')).toBe(false);
  });
});

describe('containsMedicalJudgement', () => {
  it.each(['Critical', 'severe pain', 'Severely hurt', 'life-threatening', 'life threatening', 'emergency level 3', 'Malubha ang lagay', 'malubhang sugat', 'kritikal', 'possible fracture', 'ｃｒｉｔｉｃａｌ'])(
    'flags %s',
    (text) => expect(containsMedicalJudgement(text)).toBe(true),
  );

  it.each(['Slipped on stairs', 'Masakit paa ko', 'Needs help', 'Second floor', 'emergency exit', 'persevere'])('does not flag %s', (text) =>
    expect(containsMedicalJudgement(text)).toBe(false),
  );
});
