import { describe, expect, it } from 'vitest';
import { newWaybill, type TripEvent } from '../types';
import { searchEvents, searchTerms } from './search';

let n = 0;
function ev(type: TripEvent['type'], occurred: string, extra: Partial<TripEvent> = {}): TripEvent {
  return {
    id: `e${n++}`,
    type,
    occurred_at: new Date(occurred).toISOString(),
    tractor_plate: 'AA-111-AA',
    trailer_plate: '',
    odometer_km: null,
    notes: null,
    client: null,
    cmr_number: null,
    station: null,
    diesel_l: null,
    adblue_l: null,
    city: 'Narbonne',
    postcode: null,
    department: '11',
    country_code: 'FR',
    lat: null,
    lon: null,
    updated_at: '',
    deleted_at: null,
    ...extra,
  };
}

const loading = ev('chargement', '2026-10-12T08:00', { city: 'Périgueux', department: '24' });
const delivery = ev('livraison', '2026-10-13T10:00', { city: 'Toulouse', department: '31' });
const fuel = ev('carburant', '2026-10-13T15:00', { city: 'Toulouse', department: '31', station: 'AS24' });
const old = ev('livraison', '2026-01-05T09:00', { city: 'Narbonne', client: 'Client Ancien', cmr_number: '77' });
const lv = newWaybill({
  loading_event_id: loading.id,
  delivery_event_id: delivery.id,
  number: '1234',
  shipper: 'Expéditeur Un',
  consignee: 'Destinataire Deux',
  goods: 'Plâtre',
});
const other = newWaybill({ loading_event_id: loading.id, number: '999', consignee: 'Autre Client' });
const events = [old, loading, delivery, fuel];
const waybills = [lv, other];
const ids = (query: string) => searchEvents(events, waybills, query).map((r) => r.event.id);

describe('searchTerms', () => {
  it('découpe en mots, sans accents ni majuscules', () => {
    expect(searchTerms('  Périgueux   Plâtre ')).toEqual(['perigueux', 'platre']);
  });
});

describe('searchEvents', () => {
  it('rien à chercher : aucun résultat', () => {
    expect(ids('  ')).toEqual([]);
  });

  it('trouve par ville, sans tenir compte des accents, les plus récentes en premier', () => {
    expect(ids('toulouse')).toEqual([fuel.id, delivery.id]);
    expect(ids('perigueux')).toEqual([loading.id]);
  });

  it('cherche aussi dans les LV de l’étape, au chargement comme à la livraison', () => {
    expect(ids('platre')).toEqual([delivery.id, loading.id]);
    expect(ids('LV 1234')).toEqual([delivery.id, loading.id]);
  });

  it('tous les mots doivent se retrouver, dans l’étape ou ses LV', () => {
    expect(ids('livraison toulouse')).toEqual([delivery.id]);
    expect(ids('toulouse as24')).toEqual([fuel.id]);
    expect(ids('destinataire perigueux')).toEqual([loading.id]);
    expect(ids('toulouse narbonne')).toEqual([]);
  });

  it('ne garde que les LV qui contiennent un des mots', () => {
    const [result] = searchEvents(events, waybills, 'autre client');
    expect(result.event.id).toBe(loading.id);
    expect(result.waybills.map((w) => w.id)).toEqual([other.id]);
  });

  it('anciennes étapes : client et numéro de LV de l’étape', () => {
    expect(ids('client ancien')).toEqual([old.id]);
    expect(ids('lv 77')).toEqual([old.id]);
  });

  it('plaque avec ou sans tirets, département', () => {
    expect(ids('aa111')).toHaveLength(4);
    expect(ids('AA-111')).toHaveLength(4);
    expect(ids('(24)')).toEqual([loading.id]);
  });
});
