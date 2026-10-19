import { describe, expect, it } from 'vitest';
import { finalProgress, liveProgress, liveSteps } from './liveReading';
import type { WaybillReading } from './photos';

// Réponse fictive (noms génériques, villes publiques).
const reading: WaybillReading = {
  remarks: ['Lettre pré-imprimée, remplie à la main', 'Bas de la photo flou : poids "illisible"'],
  number: '000123',
  shipper_name: 'Exemple Matériaux',
  shipper_city: 'Narbonne',
  shipper_department: '11',
  consignee_name: 'Dépôt Exemple',
  consignee_city: 'Toulouse',
  consignee_department: '31',
  goods: '12 pal plaques',
  weight_kg: null,
};
const json = JSON.stringify(reading);
const cut = (marker: string) => json.slice(0, json.indexOf(marker));

describe('liveProgress', () => {
  it('rien de lisible au tout début', () => {
    expect(liveProgress('{"rema')).toEqual({ remarks: [], found: [] });
  });

  it('garde les remarques terminées, pas celle en cours d’écriture', () => {
    const progress = liveProgress(cut('flou'));
    expect(progress.remarks).toEqual(['Lettre pré-imprimée, remplie à la main']);
  });

  it('remarques avec guillemets échappés', () => {
    expect(liveProgress(cut('"number"')).remarks[1]).toBe('Bas de la photo flou : poids "illisible"');
  });

  it('ignore une valeur à moitié reçue', () => {
    const progress = liveProgress(cut('Matériaux') + 'Mat');
    expect(progress.found).toEqual([{ label: 'N° de LV', value: '000123' }]);
  });

  it('un nombre n’est gardé qu’une fois terminé', () => {
    const text = '{"remarks":[],"weight_kg":184';
    expect(liveProgress(text).found).toEqual([]);
    expect(liveProgress(text + '50}').found).toEqual([{ label: 'Poids', value: '18 450 kg' }]);
  });

  it('réponse complète : les informations absentes sont « non trouvées »', () => {
    const steps = liveSteps(liveProgress(json));
    expect(steps[0]).toBe('Remarque : Lettre pré-imprimée, remplie à la main');
    expect(steps).toContain('Chargeur : Exemple Matériaux');
    expect(steps.at(-1)).toBe('Poids : non trouvé');
  });
});

describe('finalProgress', () => {
  it('villes avec leur département, toutes les informations listées', () => {
    const { found, remarks } = finalProgress(reading);
    expect(remarks).toHaveLength(2);
    expect(found).toHaveLength(7);
    expect(found).toContainEqual({ label: 'Ville de livraison', value: 'Toulouse (31)' });
    expect(found).toContainEqual({ label: 'Poids', value: null });
  });

  it('informations dont l’IA doute marquées, sauf si non trouvées', () => {
    const { found } = finalProgress({ ...reading, uncertain: ['goods', 'weight_kg'] });
    expect(found).toContainEqual({ label: 'Marchandise', value: reading.goods, doubt: true });
    expect(found.find((f) => f.label === 'Poids')?.doubt).toBeUndefined();
  });

  it('ancienne version du serveur, sans remarques', () => {
    const { remarks } = finalProgress({ ...reading, remarks: undefined });
    expect(remarks).toEqual([]);
  });
});
