import { describe, expect, it } from 'vitest';
import { waybillContext } from './waybills';

const narbonne = { city: 'Narbonne', department: '11', country_code: 'FR' };
const toulouse = { city: 'Toulouse', department: '31', country_code: 'FR' };

describe('waybillContext', () => {
  it('chargement et livraison', () => {
    expect(
      waybillContext({ place: narbonne, at: '2026-10-16T06:30:00' }, { place: toulouse, at: '2026-10-19T10:23:00' }),
    ).toBe('Chargée : Narbonne (11) · 16/10 06:30\nLivrée : Toulouse (31) · 19/10 10:23');
  });

  it('pas encore livrée', () => {
    expect(waybillContext({ place: narbonne, at: '2026-10-16T06:30:00' }, null)).toBe(
      'Chargée : Narbonne (11) · 16/10 06:30\nÀ livrer',
    );
  });

  it('sans chargement, ou étape en cours de saisie sans lieu ni date', () => {
    expect(waybillContext(undefined, { place: toulouse, at: null })).toBe(
      'Chargement non renseigné\nLivrée : Toulouse (31)',
    );
    expect(waybillContext({ place: { city: '', department: null, country_code: null }, at: null }, null)).toBe(
      'Chargée : inconnu\nÀ livrer',
    );
  });
});
