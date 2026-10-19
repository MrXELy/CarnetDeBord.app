import { describe, expect, it } from 'vitest';
import { applyReading, cityLabel, clientName, readingSummary, uncertainFields, type ReadableFields } from './ocr';

const empty: ReadableFields = { number: '', shipper: '', consignee: '', planned_city: '', goods: '', weight_kg: '' };

// Ce que Claude devrait lire sur une lettre de voiture fictive.
const reading = {
  number: '1234 567',
  shipper_name: 'Exemple Négoce',
  shipper_city: 'Narbonne',
  shipper_department: '11',
  consignee_name: 'Dépôt Exemple',
  consignee_city: 'Toulouse',
  consignee_department: '31',
  goods: '9 pal laine de roche',
  weight_kg: 2628.5,
};

describe('applyReading', () => {
  it('remplit une fiche vide', () => {
    const { fields, filled } = applyReading(empty, reading);
    expect(fields).toEqual({
      number: '1234567',
      shipper: 'Exemple Négoce',
      consignee: 'Dépôt Exemple',
      planned_city: 'Toulouse (31)',
      goods: '9 pal laine de roche',
      weight_kg: '2628,5',
    });
    expect(filled).toHaveLength(6);
  });

  it('ne remplace jamais ce qui est déjà saisi', () => {
    const { fields, filled } = applyReading({ ...empty, consignee: 'Dépôt Exemple Sud', number: '42' }, reading);
    expect(fields.consignee).toBe('Dépôt Exemple Sud');
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
    expect(fields.planned_city).toBe('Toulouse');
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
    expect(clientName(' Exemple Négoce ')).toBe('Exemple Négoce');
    expect(clientName('Sotexpro')).toBe('Sotexpro'); // « etex » au milieu d'un mot : pas concerné
  });

  it('s’applique à la lecture d’une CMR Siniat', () => {
    const { fields } = applyReading(empty, { ...reading, shipper_name: 'ETEX France Building Performance SA' });
    expect(fields.shipper).toBe('Siniat');
  });
});

describe('relecture en mode fiable', () => {
  // Première lecture (économique) avec deux erreurs : numéro et destinataire.
  const first = applyReading(empty, { ...reading, number: '1234S67', consignee_name: 'Dépôt Exenple', goods: null });
  const previous = Object.fromEntries(first.filled.map((k) => [k, first.fields[k]]));

  it('remplace ce que la première lecture avait rempli', () => {
    const { fields } = applyReading(first.fields, reading, previous);
    expect(fields.number).toBe('1234567');
    expect(fields.consignee).toBe('Dépôt Exemple');
  });

  it('ne touche pas un champ corrigé à la main entre-temps', () => {
    const { fields, filled } = applyReading({ ...first.fields, consignee: 'Dépôt Exemple Sud' }, reading, previous);
    expect(fields.consignee).toBe('Dépôt Exemple Sud');
    expect(filled).not.toContain('consignee');
  });

  it('remplit les champs restés vides', () => {
    const { fields } = applyReading(first.fields, reading, previous);
    expect(fields.goods).toBe('9 pal laine de roche');
  });

  it('garde la première valeur si la relecture ne trouve rien', () => {
    const { fields } = applyReading(first.fields, { ...reading, shipper_name: null }, previous);
    expect(fields.shipper).toBe('Exemple Négoce');
  });
});

describe('readingSummary', () => {
  const full: ReadableFields = {
    number: '000123',
    shipper: 'Exemple Matériaux',
    consignee: 'Dépôt Exemple',
    planned_city: 'Toulouse (31)',
    goods: '12 pal',
    weight_kg: '18450',
  };

  it('tout trouvé', () => {
    expect(readingSummary(full, ['number', 'shipper', 'consignee', 'planned_city', 'goods', 'weight_kg'])).toBe(
      '6 champs remplis · à vérifier',
    );
  });

  it('champs restés vides', () => {
    expect(readingSummary({ ...full, weight_kg: '' }, ['number', 'goods'])).toBe('2 champs remplis · 1 non trouvé');
    expect(readingSummary({ ...full, goods: '', weight_kg: '' }, ['number'])).toBe('1 champ rempli · 2 non trouvés');
  });

  it('rien de nouveau', () => {
    expect(readingSummary(full, [])).toBe('Rien de nouveau sur la photo');
  });
});

describe('uncertainFields', () => {
  it('champs de la fiche dont l’IA doute', () => {
    expect(uncertainFields({ ...reading, uncertain: ['weight_kg', 'consignee_city', 'shipper_city'] })).toEqual([
      'planned_city',
      'weight_kg',
    ]);
  });

  it('ancienne version du serveur : aucun doute', () => {
    expect(uncertainFields(reading)).toEqual([]);
  });
});
