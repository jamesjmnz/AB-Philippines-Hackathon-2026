import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from '../base64';

describe('base64', () => {
  it('round-trips every length and byte value', () => {
    for (let length = 0; length < 70; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) % 256);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('matches Node for known vectors', () => {
    for (const text of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', 'Masakit paa ko — tulong']) {
      expect(bytesToBase64(utf8ToBytes(text))).toBe(Buffer.from(text, 'utf8').toString('base64'));
      expect(bytesToUtf8(base64ToBytes(Buffer.from(text, 'utf8').toString('base64')))).toBe(text);
    }
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base64ToBytes('@@@@')).toThrow();
  });
});
