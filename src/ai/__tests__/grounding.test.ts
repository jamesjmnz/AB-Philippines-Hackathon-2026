import { groundValue } from '../grounding';

const ok = (value: string) => ({ ok: true, value });
const no = (reason: string) => ({ ok: false, reason });

describe('groundValue: floor', () => {
  it('rejects a floor backed by a quote that names only a building', () => {
    expect(groundValue('floor', 'Second floor', 'Building B')).toEqual(no('value_not_in_quote'));
  });

  it('accepts the floor the quote names and returns the canonical label', () => {
    expect(groundValue('floor', 'Second floor', 'nasa second floor ako')).toEqual(ok('Second floor'));
    expect(groundValue('floor', '2nd floor', 'I am on the second floor')).toEqual(ok('Second floor'));
    expect(groundValue('floor', 'second', 'stuck on the 2/F')).toEqual(ok('Second floor'));
    expect(groundValue('floor', '2', 'floor 2 near the stairs')).toEqual(ok('Second floor'));
  });

  it('reads Tagalog and Taglish floors', () => {
    expect(groundValue('floor', 'Second floor', 'Nasa ikalawang palapag ako')).toEqual(ok('Second floor'));
    expect(groundValue('floor', 'ikatlong palapag', 'andito kami sa 3rd floor ng gusali')).toEqual(ok('Third floor'));
    expect(groundValue('floor', 'Third floor', 'Nasa ikalawang palapag ako')).toEqual(no('value_not_in_quote'));
  });

  it('rejects a different floor', () => {
    expect(groundValue('floor', 'Third floor', 'I am on the second floor')).toEqual(no('value_not_in_quote'));
    expect(groundValue('floor', 'First floor', 'ground floor lobby')).toEqual(no('value_not_in_quote'));
  });

  it('rejects a floor the quote negates', () => {
    expect(groundValue('floor', 'Second floor', 'not on the second floor')).toEqual(no('negated'));
    expect(groundValue('floor', 'Second floor', "I'm not on the 2nd floor anymore")).toEqual(no('negated'));
    expect(groundValue('floor', 'Second floor', 'hindi ako nasa ikalawang palapag')).toEqual(no('negated'));
    expect(groundValue('floor', 'Second floor', 'wala ako sa second floor')).toEqual(no('negated'));
  });

  it('accepts the stated floor when another floor is the one negated', () => {
    expect(groundValue('floor', 'Third floor', 'not on the second floor, I am on the third floor')).toEqual(ok('Third floor'));
    expect(groundValue('floor', 'Second floor', 'not on the second floor, I am on the third floor')).toEqual(no('negated'));
  });

  it('rejects a floor value the rules cannot read as a floor, even when the quote repeats it', () => {
    expect(groundValue('floor', 'malapit sa lobby', 'malapit sa lobby')).toEqual(no('value_not_in_quote'));
    expect(groundValue('floor', 'floor to 9', 'set floor to 9')).toEqual(no('value_not_in_quote'));
    expect(groundValue('floor', 'Mezzanine', 'nasa mezzanine kami')).toEqual(no('value_not_in_quote'));
  });
});

describe('groundValue: building', () => {
  it('rejects a building backed by a quote that names only a floor', () => {
    expect(groundValue('building', 'Building B', 'second floor')).toEqual(no('value_not_in_quote'));
  });

  it('accepts the building the quote names and returns the canonical label', () => {
    expect(groundValue('building', 'Building B', 'sa hagdan sa Building B')).toEqual(ok('Building B'));
    expect(groundValue('building', 'B', 'nasa bldg. b kami')).toEqual(ok('Building B'));
    expect(groundValue('building', 'Building 3', 'dito sa Gusali 3')).toEqual(ok('Building 3'));
  });

  it('rejects a different building', () => {
    expect(groundValue('building', 'Building A', 'sa hagdan sa Building B')).toEqual(no('value_not_in_quote'));
  });

  it('rejects a building the quote negates', () => {
    expect(groundValue('building', 'Building A', 'hindi sa Building A')).toEqual(no('negated'));
    expect(groundValue('building', 'Building A', "we're not in Building A")).toEqual(no('negated'));
    expect(groundValue('building', 'Building B', 'hindi sa Building A, nasa Building B kami')).toEqual(ok('Building B'));
  });

  it('accepts a named building only when the quote says the name', () => {
    expect(groundValue('building', 'Science Hall', 'nasa Science Hall kami')).toEqual(ok('Science Hall'));
    expect(groundValue('building', 'Science Hall', 'nasa library kami')).toEqual(no('value_not_in_quote'));
    expect(groundValue('building', 'Science Hall', 'hindi sa Science Hall')).toEqual(no('negated'));
  });
});

describe('groundValue: assistanceRequested', () => {
  it.each([
    'Please help me',
    'I need assistance',
    'I need someone here',
    "I can't move, please help",
    'kailangan ko ng tulong',
    'Saklolo!',
    'tulungan nyo po ako',
    'pakitulong naman',
    'Patulong po, di ako makatayo',
    'Okay lang ako pero kailangan ng tulong ng kasama ko',
    "I'm okay but my friend needs help",
  ])('accepts "%s"', (quote) => {
    expect(groundValue('assistanceRequested', 'Yes', quote)).toEqual(ok('Yes'));
  });

  it.each([
    "I don't need help",
    'I do not need any help',
    'No help needed',
    'Help is not needed',
    'hindi ko kailangan ng tulong',
    'Di ko na kailangan ng tulong',
    'wala akong kailangan na tulong',
    'okay lang ako',
    'Ayos lang po ako',
    "I'm fine",
    'huwag na po',
  ])('rejects "%s" as negated', (quote) => {
    expect(groundValue('assistanceRequested', 'Yes', quote)).toEqual(no('negated'));
  });

  it('rejects a quote with no request in it', () => {
    expect(groundValue('assistanceRequested', 'Yes', 'Nadulas ako sa hagdan')).toEqual(no('value_not_in_quote'));
    expect(groundValue('assistanceRequested', 'Yes', 'Building B')).toEqual(no('value_not_in_quote'));
  });

  it('rejects a "no" whose own quote asks for help', () => {
    expect(groundValue('assistanceRequested', 'No', 'kailangan ko ng tulong')).toEqual(no('value_not_in_quote'));
  });
});

describe('groundValue: free text', () => {
  it('keeps a value whose words are mostly in the quote', () => {
    expect(groundValue('incidentType', 'Slipped on stairs', 'I slipped on the stairs')).toEqual(ok('Slipped on stairs'));
    expect(groundValue('symptom', 'Masakit paa', 'Masakit paa ko')).toEqual(ok('Masakit paa'));
    expect(groundValue('locationText', 'near the canteen stairs', 'malapit sa canteen, near the stairs')).toEqual(ok('near the canteen stairs'));
    expect(groundValue('incidentType', 'slip', 'slipped sa hagdan')).toEqual(ok('slip'));
  });

  it("replaces a paraphrase with the person's own words", () => {
    expect(groundValue('incidentType', 'Possible fall accident', 'Nadulas ako sa hagdan')).toEqual(ok('Nadulas ako sa hagdan'));
    expect(groundValue('symptom', 'Leg injury', '  masakit   paa ko ')).toEqual(ok('masakit paa ko'));
    expect(groundValue('locationText', 'Cafeteria', 'malapit sa hagdan')).toEqual(ok('malapit sa hagdan'));
  });

  it('rejects instead of replacing when the quote is too long to be a value', () => {
    expect(groundValue('symptom', 'Leg injury', 'masakit '.repeat(20))).toEqual(no('too_long'));
  });
});

describe('groundValue: every field', () => {
  it.each(['incidentType', 'building', 'floor', 'locationText', 'symptom', 'assistanceRequested'] as const)('rejects a severity or medical value for %s', (field) => {
    for (const value of ['Critical', 'Severe injury', 'life-threatening', 'Emergency level 1', 'Malubha', 'kritikal', 'Broken leg']) {
      expect(groundValue(field, value, `${value} second floor Building B help`)).toEqual(no('medical_or_severity'));
    }
  });

  it.each(['incidentType', 'building', 'floor', 'locationText', 'symptom', 'assistanceRequested'] as const)('rejects an over-long value for %s', (field) => {
    expect(groundValue(field, 'a'.repeat(121), 'a'.repeat(121))).toEqual(no('too_long'));
  });

  it('rejects an empty value', () => {
    expect(groundValue('symptom', '   ', 'masakit paa ko')).toEqual(no('value_not_in_quote'));
  });
});
