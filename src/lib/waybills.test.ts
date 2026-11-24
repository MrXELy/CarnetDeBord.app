import { describe, expect, it } from 'vitest';
import { newWaybill } from '../types';
import { waybillContent } from './waybills';

describe('waybillContent', () => {
  it('marchandise et poids en tonnes', () => {
    expect(waybillContent(newWaybill({ goods: ' 26 pal bouteilles ', weight_kg: 18650 }))).toBe(
      '26 pal bouteilles (18,7t)',
    );
  });
  it('un seul des deux, ou rien', () => {
    expect(waybillContent(newWaybill({ goods: 'Benne HF' }))).toBe('Benne HF');
    expect(waybillContent(newWaybill({ weight_kg: 24000 }))).toBe('24t');
    expect(waybillContent(newWaybill())).toBe('');
  });
});
