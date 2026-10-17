import { describe, expect, it } from 'vitest';
import { departmentFromPostcode, formatPlace, placeFromPhoton } from './geo';

describe('departmentFromPostcode', () => {
  it.each([
    ['75008', '75'],
    ['69003', '69'],
    ['01000', '01'],
    ['20000', '2A'],
    ['20167', '2A'],
    ['20200', '2B'],
    ['20600', '2B'],
    ['97400', '974'],
    ['97110', '971'],
  ])('%s → %s', (cp, dep) => expect(departmentFromPostcode(cp)).toBe(dep));

  it('ignore les codes invalides', () => {
    expect(departmentFromPostcode(null)).toBeNull();
    expect(departmentFromPostcode('')).toBeNull();
    expect(departmentFromPostcode('1000')).toBeNull();
  });
});

describe('placeFromPhoton', () => {
  it('lit une ville française', () => {
    const p = placeFromPhoton({
      geometry: { coordinates: [4.83, 45.76] },
      properties: { name: 'Lyon', type: 'city', postcode: '69001;69002', countrycode: 'fr' },
    });
    expect(p).toMatchObject({ city: 'Lyon', postcode: '69001', department: '69', country_code: 'FR', lat: 45.76 });
  });

  it("n'attribue pas de département hors de France", () => {
    const p = placeFromPhoton({
      geometry: { coordinates: [2.17, 41.38] },
      properties: { name: 'Carrer de Mallorca', type: 'street', city: 'Barcelona', postcode: '08013', countrycode: 'es' },
    });
    expect(p).toMatchObject({ city: 'Barcelona', department: null, country_code: 'ES' });
    expect(formatPlace(p)).toBe('Barcelona (ES)');
  });
});
