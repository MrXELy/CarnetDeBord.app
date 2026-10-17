import { describe, expect, it } from 'vitest';
import { applyReading, cityLabel, clientName, type ReadableFields } from './ocr';

const empty: ReadableFields = { number: '', shipper: '', consignee: '', planned_city: '', goods: '', weight_kg: '' };

// Ce que Claude devrait lire sur la lettre Doumen n° 1459874.
const reading = {
  number: '1459 874',
  shipper_name: 'Gaudon',
  shipper_city: 'Bonnat',
  shipper_department: '23',
  consignee_name: 'Chausson Mtx',
  consignee_city: 'Malemort',
  consignee_department: '19',
  goods: '9 pal eurocoustic',
  weight_kg: 2628.5,
};

describe('applyReading', () => {
  it('remplit une fiche vide', () => {
    const { fields, filled } = applyReading(empty, reading);
    expect(fields).toEqual({
      number: '1459874',
      shipper: 'Gaudon',
      consignee: 'Chausson Mtx',
      planned_city: 'Malemort (19)',
      goods: '9 pal eurocoustic',
      weight_kg: '2628,5',
    });
    expect(filled).toHaveLength(6);
  });

  it('ne remplace jamais ce qui est déjà saisi', () => {
    const { fields, filled } = applyReading({ ...empty, consignee: 'Chausson Matériaux', number: '42' }, reading);
    expect(fields.consignee).toBe('Chausson Matériaux');
    expect(fields.number).toBe('42');
    expect(filled).not.toContain('consignee');
    expect(filled).not.toContain('number');
  });

  it('ignore ce qui n’a pas pu être lu', () => {
    const { fields, filled } = applyReading(empty, {
      ...reading,
      number: null,
      consignee_department: null,
      goods: '  ',
      weight_kg: null,
    });
    expect(fields.number).toBe('');
    expect(fields.planned_city).toBe('Malemort');
    expect(filled).toEqual(['shipper', 'consignee', 'planned_city']);
  });
});

describe('cityLabel', () => {
  it('ajoute le département quand il est connu', () => {
    expect(cityLabel('Nîmes', '30')).toBe('Nîmes (30)');
    expect(cityLabel('Nîmes', null)).toBe('Nîmes');
    expect(cityLabel(null, '30')).toBe('');
  });
});

describe('clientName', () => {
  it('remplace la raison sociale ETEX par Siniat', () => {
    expect(clientName('ETEX France Building Performance SA')).toBe('Siniat');
    expect(clientName('Etex France')).toBe('Siniat');
    expect(clientName(' Gaudon ')).toBe('Gaudon');
    expect(clientName('Sotexpro')).toBe('Sotexpro'); // « etex » au milieu d'un mot : pas concerné
  });

  it('s’applique à la lecture d’une CMR Siniat', () => {
    const { fields } = applyReading(empty, { ...reading, shipper_name: 'ETEX France Building Performance SA' });
    expect(fields.shipper).toBe('Siniat');
  });
});

describe('relecture en mode fiable', () => {
  // Première lecture (économique) avec deux erreurs : numéro et destinataire.
  const first = applyReading(empty, { ...reading, number: '1459B74', consignee_name: 'Chausson Mix', goods: null });
  const previous = Object.fromEntries(first.filled.map((k) => [k, first.fields[k]]));

  it('remplace ce que la première lecture avait rempli', () => {
    const { fields } = applyReading(first.fields, reading, previous);
    expect(fields.number).toBe('1459874');
    expect(fields.consignee).toBe('Chausson Mtx');
  });

  it('ne touche pas un champ corrigé à la main entre-temps', () => {
    const { fields, filled } = applyReading({ ...first.fields, consignee: 'Chausson Matériaux' }, reading, previous);
    expect(fields.consignee).toBe('Chausson Matériaux');
    expect(filled).not.toContain('consignee');
  });

  it('remplit les champs restés vides', () => {
    const { fields } = applyReading(first.fields, reading, previous);
    expect(fields.goods).toBe('9 pal eurocoustic');
  });

  it('garde la première valeur si la relecture ne trouve rien', () => {
    const { fields } = applyReading(first.fields, { ...reading, shipper_name: null }, previous);
    expect(fields.shipper).toBe('Gaudon');
  });
});
