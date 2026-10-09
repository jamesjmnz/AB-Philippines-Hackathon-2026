import {
  extractBuilding,
  extractFloor,
  extractFloorTransition,
  extractFloors,
  extractStatedFloor,
  floorLabel,
} from '../rules';

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
    ['At 2:30 I moved from the 2nd floor to the 3rd floor', 'Second floor', '2nd floor', 'Third floor', '3rd floor'],
    ["I've just moved from the first floor to the second floor", 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['I came down from the third floor to the ground floor', 'Third floor', 'third floor', 'Ground floor', 'ground floor'],
    ['I went to the second floor from the first floor yesterday', 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['I moved up to the 3rd floor from the 2nd floor', 'Second floor', '2nd floor', 'Third floor', '3rd floor'],
    ['I moved up to the 3rd floor from the 2nd', 'Second floor', '2nd', 'Third floor', '3rd floor'],
    ['I moved from the first to the second floor', 'First floor', 'first', 'Second floor', 'second floor'],
    ["I was on the first floor, now I'm on the second floor", 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['I was on the first floor, now I’m on the second', 'First floor', 'first floor', 'Second floor', 'second'],
    ['I was on the first floor. Now I am on the second floor.', 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['I was on the first floor, I am on the second floor now', 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['I was on the first floor then went to the second floor', 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['Lumipat ako mula first floor papunta sa second floor', 'First floor', 'first floor', 'Second floor', 'second floor'],
    ['umakyat ako mula unang palapag papunta sa ikalawang palapag', 'First floor', 'unang palapag', 'Second floor', 'ikalawang palapag'],
    ['Umakyat na kami mula 1st floor papunta sa 2nd floor', 'First floor', '1st floor', 'Second floor', '2nd floor'],
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
    expect(extractStatedFloor(text)?.value).toBe(to);
  });

  // Each of these was read as the author's own move before the rule required a first-person
  // subject bound to a completed movement. A wrong floor is worse than no floor.
  it.each([
    // Something or somebody else moved.
    'The fire is going from the first floor to the second floor',
    'Smoke is now spreading from the first floor to the second floor',
    'Water came from the third floor to the second floor',
    'The rescuers went from the first floor to the second floor',
    'My son left the first floor, he is now on the second floor',
    'I was on the first floor, my mother is now on the second floor',
    'the patient was on the 2nd floor, now on the 3rd floor is where the nurse is',
    'I was on the first floor when I heard them say now on the second floor there is fire',
    'Room 201 from the first floor went dark, now at the 2nd floor there is smoke',
    'Now the water is from the first floor to the second floor',
    'I am now trapped; people went from the first floor to the second floor without me',
    'Umakyat na ang tubig mula first floor papunta sa second floor',
    'Umakyat na ang baha mula unang palapag papunta sa ikalawang palapag',
    'Lumipat yung apoy mula 2nd floor papunta sa 3rd floor',
    'Bumaba ang kapitbahay mula 3rd floor papunta sa 2nd floor',
    'Galing sa third floor yung usok, nasa second floor na',
    'Kanina nasa first floor ang tubig, ngayon nasa second floor na',
    // The author moved something or someone else.
    'He moved my mother from the second floor to the third floor',
    'I moved the boxes from the first floor to the second floor',
    'I transferred my call from the 2nd floor to the 3rd floor desk',
    'From the first floor I went to shout to the second floor',
    // Reported speech and questions.
    'They said they moved everyone from the first floor to the second floor',
    'Is it true they moved from the first floor to the second floor',
    'Sabi nila lumipat daw sila mula first floor papunta sa second floor',
    'Pwede bang lumipat mula first floor papunta sa second floor',
    // Intention, attempt, obligation, hypothetical.
    "I'm going from the first floor to the second floor",
    'I tried going from the first floor to the second floor but the stairs are blocked',
    'I almost went from the first floor to the second floor',
    'I should have gone from the first floor to the second floor',
    'Gusto kong lumipat mula first floor papunta sa second floor',
    'Dapat lumipat kami mula first floor papunta sa second floor',
    // A reversal after the destination.
    'I went from the second floor to the third floor and came back down',
    // An elided ordinal in another sentence.
    'I was at the 3rd. Now I am on the 2nd floor',
  ])('no longer reads a move into %j', (text) => {
    expect(extractFloorTransition(text)).toBeNull();
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
    'From the first floor I can see the second floor',
    'From the first floor I can now see the second floor',
    'From the first floor I shouted to the second floor',
    'I left my phone on the first floor, now on the second floor it is dark',
    // No first-person subject.
    'moved up to the 3rd floor from the 2nd',
    'came down from the third floor to the ground floor',
    'now from the first floor to the second floor',
    'Alex moved from the first floor to the second floor',
    'Alex was on the first floor, I am now on the second floor',
    'I never left the first floor, but my son went to the second floor',
    'I am still on the first floor. The fire moved from the second floor to the third floor',
    // Interrupted, negated, future, hypothetical, told, asked.
    'I was going from the second floor to the third floor.',
    'I will be going from the first floor to the second floor',
    'I did not move from the first floor to the second floor',
    'I moved from the first floor, not to the second floor',
    'I will have moved from the first floor to the second floor',
    'I was told to go from the first floor to the second floor',
    'I was on the first floor an hour ago and I am not going to the second floor',
    'If I moved from the first floor to the second floor would it help',
    'Please tell Mika I moved from the 1st floor to the 2nd floor of Building B, not Building A',
    'hindi ako lumipat mula first floor papunta sa second floor',
    'pupunta ako mula first floor papunta sa second floor',
    'Kung pwede lang, lumipat sana ako mula first floor papunta sa second floor',
    'Lumipat ako mula first floor papunta sa second floor tapos bumalik ako',
    'Should I have moved from the first floor to the second floor?',
    'Did I move from the first floor to the second floor',
    // Bare ordinals that may be dates, and elided ordinals away from the other mention.
    'I arrived on the 3rd. I went to the 2nd floor',
    'I moved here on the 5th, from the 2nd floor',
    'I was on the 2nd floor from the 3rd to the 5th',
    'I was on the second. Moved to the first floor',
    'from the second floor went to the first',
    // Contradictory markers, the same floor twice, or more than two mentions.
    'I was on the second floor now, from the first floor',
    'I went from the second floor to the second floor',
    'I moved from the first floor to the second floor then the third floor',
    'I went from the first floor to the second floor? No, the third floor',
    'Can someone help, I went from the first floor to the second floor to look for my son and I am back on the first floor',
  ])('returns null for %j', (text) => {
    expect(extractFloorTransition(text)).toBeNull();
  });

  it('leaves extractFloor unchanged: two different floors still yield no single floor', () => {
    expect(extractFloor('I moved from the first floor to the second floor')).toBeNull();
  });

  it('extractStatedFloor gives no floor when a lone mention sits beside a bare ordinal on another level', () => {
    // extractFloor alone would name the floor the person may have left.
    expect(extractFloor('I was at the 3rd. Now I am on the 2nd floor')?.value).toBe('Second floor');
    expect(extractStatedFloor('I was at the 3rd. Now I am on the 2nd floor')).toBeNull();
    expect(extractFloor('I moved here on the 5th, from the 2nd floor')?.value).toBe('Second floor');
    expect(extractStatedFloor('I moved here on the 5th, from the 2nd floor')).toBeNull();
    // A single floor, or the same floor twice, is unaffected.
    expect(extractStatedFloor('I am on the second floor')?.value).toBe('Second floor');
    expect(extractStatedFloor('On the 2nd floor, yes on the 2nd.')?.value).toBe('Second floor');
    expect(extractStatedFloor('The fire is going from the first floor to the second floor')).toBeNull();
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
