import { extractBuilding, extractFloor, extractFloors, floorLabel } from '../rules';

describe('floor extraction, English and Tagalog', () => {
  const cases: [text: string, value: string, span: string][] = [
    ['I am on the ground floor near the door', 'Ground floor', 'ground floor'],
    ['Stuck on the First Floor.', 'First floor', 'First Floor'],
    ['I think Alex is on the second floor.', 'Second floor', 'second floor'],
    ['third floor, east wing', 'Third floor', 'third floor'],
    ['We are at the 2nd floor lobby', 'Second floor', '2nd floor'],
    ['3rd flr hallway', 'Third floor', '3rd flr'],
    ['Room is on floor 4', 'Fourth floor', 'floor 4'],
    ['Meet at 5/F pantry', 'Fifth floor', '5/F'],
    ['on the 11th floor', '11th floor', '11th floor'],
    ['22nd floor', '22nd floor', '22nd floor'],
    ['Nasa unang palapag ako', 'First floor', 'unang palapag'],
    ['Nandito ako sa ikalawang palapag', 'Second floor', 'ikalawang palapag'],
    ['Nasa Ikatlong Palapag kami', 'Third floor', 'Ikatlong Palapag'],
    ['sa ika-lawang palapag', 'Second floor', 'ika-lawang palapag'],
    ['pangalawang palapag ng gusali', 'Second floor', 'pangalawang palapag'],
    ['ikaapat na palapag', 'Fourth floor', 'ikaapat na palapag'],
    ['sa ikalimang palapag', 'Fifth floor', 'ikalimang palapag'],
    ['ika-6 na palapag', 'Sixth floor', 'ika-6 na palapag'],
    ['Nasa 2nd floor ako ng Building B', 'Second floor', '2nd floor'],
    ['nasa second floor po ako', 'Second floor', 'second floor'],
    ['palapag 3 po', 'Third floor', 'palapag 3'],
  ];

  it.each(cases)('%s -> %s', (text, value, spanText) => {
    const match = extractFloor(text);
    expect(match?.value).toBe(value);
    expect(match?.span.text).toBe(spanText);
    // The span points at the exact characters in the original text.
    expect(text.slice(match?.span.start, match?.span.end)).toBe(spanText);
  });

  it.each([
    'Nadulas ako sa hagdan sa Building B. Masakit paa ko at kailangan ko ng tulong.',
    'I fell on the stairs',
    'The floor is wet',
    'I floored it',
    'palapag',
    '',
  ])('finds no floor in %j', (text) => {
    expect(extractFloor(text)).toBeNull();
    expect(extractFloors(text)).toEqual([]);
  });

  it('does not choose when the text names different floors, but reports each mention', () => {
    const text = 'I was between the second floor and the ikatlong palapag';
    expect(extractFloor(text)).toBeNull();
    expect(extractFloors(text).map((m) => [m.value, m.span.text])).toEqual([
      ['Second floor', 'second floor'],
      ['Third floor', 'ikatlong palapag'],
    ]);
  });

  it('accepts the same floor said twice', () => {
    expect(extractFloor('second floor, yes the 2nd floor')?.value).toBe('Second floor');
  });

  it('skips a negated mention', () => {
    expect(extractFloor('I am not on the second floor')).toBeNull();
    expect(extractFloor('Hindi sa ikalawang palapag')).toBeNull();
    expect(extractFloor('wala ako sa unang palapag, nasa ikalawang palapag ako')?.value).toBe('Second floor');
  });

  it('keeps ground and first distinct and labels any level', () => {
    expect(extractFloor('ground floor')?.level).toBe(0);
    expect(extractFloor('first floor')?.level).toBe(1);
    expect([0, 1, 2, 3, 10, 11, 12, 13, 21, 101, 111].map(floorLabel)).toEqual([
      'Ground floor',
      'First floor',
      'Second floor',
      'Third floor',
      'Tenth floor',
      '11th floor',
      '12th floor',
      '13th floor',
      '21st floor',
      '101st floor',
      '111th floor',
    ]);
  });
});

describe('building extraction', () => {
  it.each([
    ['Nadulas ako sa hagdan sa Building B. Masakit paa ko.', 'Building B', 'Building B'],
    ['im at building c, hurry', 'Building C', 'building c'],
    ['Bldg 4 lobby', 'Building 4', 'Bldg 4'],
    ['bldg. A2 rooftop', 'Building A2', 'bldg. A2'],
    ['nasa gusali 3 ako', 'Building 3', 'gusali 3'],
    ['I am in building A.', 'Building A', 'building A'],
  ])('%s -> %s', (text, value, spanText) => {
    const match = extractBuilding(text);
    expect(match?.value).toBe(value);
    expect(match && text.slice(match.span.start, match.span.end)).toBe(spanText);
  });

  it.each([
    'They are building a shelter',
    'the building is on fire',
    'building I saw yesterday',
    'Building Bravo',
    'I fell on the stairs',
  ])('finds no building in %j', (text) => {
    expect(extractBuilding(text)).toBeNull();
  });

  it('does not choose between two buildings', () => {
    expect(extractBuilding('between Building A and Building B')).toBeNull();
  });
});
