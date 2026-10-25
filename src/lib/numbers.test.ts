import { describe, expect, it } from 'vitest';
import { parseNum } from './numbers';

describe('parseNum', () => {
  it('lit la virgule et les espaces', () => {
    expect(parseNum('12 712,5')).toBe(12712.5);
  });
  it('refuse le vide, le texte, les négatifs et l’infini', () => {
    for (const s of ['', ' ', 'abc', '-300', 'Infinity']) expect(parseNum(s)).toBeNull();
  });
});
