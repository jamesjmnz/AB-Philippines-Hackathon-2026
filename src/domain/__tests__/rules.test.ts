import { extractBuilding, extractFloor, extractFloorTransition, extractFloors, floorLabel } from '../rules';

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

describe('floor transition extraction, English and Tagalog', () => {
  const cases: [text: string, from: string, fromSpan: string, to: string, toSpan: string][] = [
    ['I moved from the first floor to the second floor', 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['We went from the 2nd floor to the 3rd floor.', 'Second floor', '2nd floor', 'Third floor', '3rd floor'],
    ["I'm going from the first floor to the second floor", 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['came down from the third floor to the ground floor', 'Third floor', 'third floor', 'Ground floor', 'ground floor'],
    ['now from the first floor to the second floor', 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['moved up to the 3rd floor from the 2nd floor', 'Second floor', '2nd floor', 'Third floor', '3rd floor'],
    ['moved up to the 3rd floor from the 2nd', 'Second floor', '2nd', 'Third floor', '3rd floor'],
    ['I moved from the first to the second floor', 'First floor', 'first', 'Second floor', 'second floor'],
    ["I was on the first floor, now I'm on the second", 'First floor', 'first floor', 'Second floor', 'second'],
    ['I was on the first floor. Now I am on the second floor.', 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['I was on the first floor, I am on the second floor now', 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['Lumipat ako mula first floor papunta sa second floor', 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['umakyat ako mula unang palapag papunta sa ikalawang palapag', 'First floor', 'unang palapag', 'Second floor', 'ikalawang palapag'],
    ['Bumaba ako mula 3rd floor papunta sa 2nd floor', 'Third floor', '3rd floor', 'Second floor', '2nd floor'],
    ['pumunta ako mula first floor papunta sa second floor', 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['umakyat ako sa 3rd floor galing 2nd floor', 'Second floor', '2nd floor', 'Third floor', '3rd floor'],
    ['galing ako sa 1st floor, nasa 2nd floor na ako', 'First floor', '1st floor', 'Second floor', '2nd floor'],
    ['Galing sa unang palapag, nasa ikalawang palapag na po ako.', 'First floor', 'unang palapag', 'Second floor', 'ikalawang palapag'],
    ['kanina nasa first floor ako, ngayon nasa second floor na ako', 'First floor', 'first floor', 'Second floor', 'second floor'],
  ];

  it.each(cases)('%s', (text, from, fromSpan, to, toSpan) => {
    const transition = extractFloorTransition(text);
    expect(transition?.from.value).toBe(from);
    expect(transition?.to.value).toBe(to);
    expect(transition && text.slice(transition.from.span.start, transition.from.span.end)).toBe(fromSpan);
    expect(transition && text.slice(transition.to.span.start, transition.to.span.end)).toBe(toSpan);
    expect(transition?.from.span.text).toBe(fromSpan);
    expect(transition?.to.span.text).toBe(toSpan);
  });

  it.each([
    // One floor, or none: nothing moved.
    'I am on the second floor',
    'I fell on the stairs',
    'wait a second, I am on the first floor',
    '',
    // Two floors with no stated direction.
    'I was between the second floor and the ikatlong palapag',
    'second floor or third floor',
    'Smoke from the first floor to the second floor',
    'Fire on the first floor, now I am on the second floor',
    // Interrupted, negated, future or hypothetical movement.
    'I was going from the second floor to the third floor.',
    'I did not move from the first floor to the second floor',
    'I moved from the first floor, not to the second floor',
    'I will have moved from the first floor to the second floor',
    'hindi ako lumipat mula first floor papunta sa second floor',
    'pupunta ako mula first floor papunta sa second floor',
    'Should I have moved from the first floor to the second floor?',
    // Contradictory markers, the same floor twice, or more than two mentions.
    'I was on the second floor now, from the first floor',
    'I went from the second floor to the second floor',
    'I moved from the first floor to the second floor then the third floor',
  ])('returns null for %j', (text) => {
    expect(extractFloorTransition(text)).toBeNull();
  });

  it('leaves extractFloor unchanged: two different floors still yield no single floor', () => {
    expect(extractFloor('I moved from the first floor to the second floor')).toBeNull();
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
