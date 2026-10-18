import { describe, expect, it } from 'vitest';
import { newWaybill, type TripEvent, type Waybill } from '../types';
import { weekStart } from './dates';
import { buildWeekSheet, fuelColumn, sheetPlace, sheetPlate, type SheetSettings } from './weekSheet';

let n = 0;
function ev(
  type: TripEvent['type'],
  local: string,
  city: string,
  department: string,
  km: number | null,
  extra: Partial<TripEvent> = {},
): TripEvent {
  return {
    id: `e${n++}`,
    type,
    occurred_at: new Date(local).toISOString(),
    tractor_plate: 'AA-111-AA',
    trailer_plate: 'BB-222-BB',
    odometer_km: km,
    notes: null,
    client: null,
    cmr_number: null,
    station: null,
    diesel_l: null,
    adblue_l: null,
    city,
    postcode: null,
    department,
    country_code: 'FR',
    lat: null,
    lon: null,
    updated_at: '',
    deleted_at: null,
    ...extra,
  };
}

const settings: SheetSettings = {
  driver: 'DUPONT Jean',
  agency: 'Toulouse',
  depots: [
    { label: 'Narbonne', cities: '' },
    { label: 'Toulouse', cities: 'Blagnac, Colomiers' },
  ],
};

// Semaine du lundi 2 mars 2026.
const start = weekStart(new Date('2026-03-02T12:00'));

describe('sheetPlate et sheetPlace', () => {
  it('écrit la plaque et le lieu comme sur papier', () => {
    expect(sheetPlate('AB-123-CD')).toBe('AB 123 CD');
    expect(sheetPlace({ city: 'Narbonne', department: '11', country_code: 'FR' })).toBe('Narbonne 11');
    expect(sheetPlace({ city: 'Irun', department: null, country_code: 'ES' })).toBe('Irun ES');
  });
});

describe('fuelColumn', () => {
  it('range AS24 et DKV dans leur colonne, les dépôts selon la ville, le reste dans Divers', () => {
    expect(fuelColumn({ station: 'AS24', city: 'Narbonne' }, settings.depots)).toBe(5);
    expect(fuelColumn({ station: 'DKV', city: 'Narbonne' }, settings.depots)).toBe(6);
    expect(fuelColumn({ station: 'Doumen', city: 'Narbonne' }, settings.depots)).toBe(0);
    expect(fuelColumn({ station: 'Doumen', city: 'Blagnac' }, settings.depots)).toBe(1);
    expect(fuelColumn({ station: 'Doumen', city: 'Colomiers' }, settings.depots)).toBe(1);
    expect(fuelColumn({ station: 'Doumen', city: 'Périgueux' }, settings.depots)).toBe(7);
  });
});

describe('buildWeekSheet', () => {
  it('remplit la page 1 et la page 4 (départs, km de la semaine, pleins)', () => {
    const events = [
      ev('debut_journee', '2026-03-02T06:00', 'Narbonne', '11', 100_000),
      ev('carburant', '2026-03-02T10:00', 'Blagnac', '31', 100_200, {
        station: 'Doumen',
        diesel_l: 400,
        adblue_l: 50,
      }),
      ev('fin_journee', '2026-03-02T18:00', 'Toulouse', '31', 100_500),
      ev('debut_journee', '2026-03-03T06:00', 'Toulouse', '31', 100_500),
      ev('carburant', '2026-03-03T09:00', 'Périgueux', '24', 100_600, { station: 'AS24', diesel_l: 150 }),
      ev('fin_journee', '2026-03-03T18:00', 'Narbonne', '11', 101_000),
    ];
    const sheet = buildWeekSheet(events, [], start, settings);
    expect(sheet.week).toBe(10);
    expect(sheet.tractor).toBe('AA 111 AA');
    expect(sheet.departures[1]).toMatchObject({ place: 'Narbonne 11', km: 100_000 });
    expect(sheet.departures[2]).toMatchObject({ place: 'Toulouse 31', km: 100_500 });
    expect(sheet.departures[0]).toBeNull();
    expect(sheet).toMatchObject({ startPlace: 'Narbonne', endPlace: 'Narbonne', startKm: 100_000, endKm: 101_000 });
    expect(sheet.totalKm).toBe(1000);
    expect(sheet.fuel[0]).toEqual([expect.objectContaining({ column: 1, litres: 400, adblue: 50, full: true })]);
    expect(sheet.fuel[1]).toEqual([expect.objectContaining({ column: 5, litres: 150, full: false })]);
    expect(sheet.totalLitres).toBe(550);
    expect(sheet.depotLabels).toEqual(['Narbonne', 'Toulouse', '', '', '']);
  });

  it('met un départ du dimanche soir sur la ligne Dimanche', () => {
    const events = [ev('debut_journee', '2026-03-01T22:30', 'Narbonne', '11', 100_000)];
    const sheet = buildWeekSheet(events, [], start, settings);
    expect(sheet.departures[0]).toMatchObject({ place: 'Narbonne 11' });
  });

  it('note chaque opération au jour où elle a lieu, la livraison sur la ligne de son chargement du même jour', () => {
    const loadMon = ev('chargement', '2026-03-02T08:00', 'Toulouse', '31', 100_050);
    const deliverTue = ev('livraison', '2026-03-03T08:00', 'Narbonne', '11', 100_300);
    const loadTue = ev('chargement', '2026-03-03T10:00', 'Narbonne', '11', 100_310);
    const deliverTue2 = ev('livraison', '2026-03-03T14:00', 'Périgueux', '24', 100_600);
    const lv = (extra: Partial<Waybill>): Waybill => newWaybill(extra);
    const waybills = [
      lv({
        loading_event_id: loadMon.id,
        delivery_event_id: deliverTue.id,
        shipper: 'Usine A',
        consignee: 'Client B',
        number: '123',
        goods: 'sec',
        weight_kg: 24_000,
      }),
      lv({
        loading_event_id: loadTue.id,
        delivery_event_id: deliverTue2.id,
        shipper: 'Usine C',
        consignee: 'Client D',
      }),
    ];
    const sheet = buildWeekSheet([loadMon, deliverTue, loadTue, deliverTue2], waybills, start, settings);
    expect(sheet.operations[0]).toEqual([
      expect.objectContaining({
        trailer: 'BB 222 BB',
        shipper: 'Usine A',
        shipperPlace: 'Toulouse 31',
        consignee: '',
        number: '123',
        weightKg: 24_000,
      }),
    ]);
    expect(sheet.operations[1]).toEqual([
      // La livraison du lendemain répète la nature, le poids et le n° de la LV.
      expect.objectContaining({
        trailer: 'BB 222 BB',
        shipper: '',
        consignee: 'Client B',
        consigneeKm: 100_300,
        goods: 'sec',
        weightKg: 24_000,
        number: '123',
      }),
      expect.objectContaining({ shipper: 'Usine C', consignee: 'Client D', consigneePlace: 'Périgueux 24' }),
    ]);
  });

  it('fait une ligne par LV, au chargement comme à la livraison', () => {
    const load = ev('chargement', '2026-03-02T08:00', 'Toulouse', '31', 100_050, { client: 'Usine A' });
    const first = ev('livraison', '2026-03-03T08:00', 'Narbonne', '11', 100_300);
    const second = ev('livraison', '2026-03-03T10:00', 'Narbonne', '11', 100_310);
    const waybills = [
      newWaybill({
        loading_event_id: load.id,
        delivery_event_id: second.id,
        number: '2',
        goods: 'placo',
        weight_kg: 12_000,
        consignee: 'Client D',
      }),
      newWaybill({
        loading_event_id: load.id,
        delivery_event_id: first.id,
        number: '1',
        goods: 'placo',
        weight_kg: 15_000,
        consignee: 'Client C',
      }),
    ];
    const sheet = buildWeekSheet([load, first, second], waybills, start, settings);
    expect(sheet.operations[0].map((r) => [r.trailer, r.shipper, r.goods, r.weightKg, r.number])).toEqual([
      ['BB 222 BB', 'Usine A', 'placo', 15_000, '1'],
      ['', '', 'placo', 12_000, '2'],
    ]);
    expect(sheet.operations[1].map((r) => [r.trailer, r.consignee, r.weightKg, r.number])).toEqual([
      ['BB 222 BB', 'Client C', 15_000, '1'],
      ['', 'Client D', 12_000, '2'],
    ]);
  });

  it('met une livraison du jour même sur la ligne de sa LV', () => {
    const load = ev('chargement', '2026-03-02T08:00', 'Toulouse', '31', 100_050);
    const first = ev('livraison', '2026-03-02T11:00', 'Narbonne', '11', 100_200);
    const second = ev('livraison', '2026-03-02T12:00', 'Narbonne', '11', 100_210);
    const waybills = [
      newWaybill({ loading_event_id: load.id, delivery_event_id: second.id, number: '1', consignee: 'Client C' }),
      newWaybill({ loading_event_id: load.id, delivery_event_id: first.id, number: '2', consignee: 'Client D' }),
    ];
    const rows = buildWeekSheet([load, first, second], waybills, start, settings).operations[0];
    expect(rows.map((r) => [r.number, r.consignee, r.consigneeKm])).toEqual([
      ['1', 'Client C', 100_210],
      ['2', 'Client D', 100_200],
    ]);
  });

  it('livre plusieurs LV ensemble sur une ligne chacune, le destinataire sur la première', () => {
    const delivery = ev('livraison', '2026-03-02T09:00', 'Narbonne', '11', 100_100);
    const waybills = ['1', '2'].map((number) =>
      newWaybill({
        loading_event_id: 'chargement-semaine-avant',
        delivery_event_id: delivery.id,
        number,
        consignee: 'Client C',
      }),
    );
    const rows = buildWeekSheet([delivery], waybills, start, settings).operations[0];
    expect(rows.map((r) => [r.trailer, r.consignee, r.number])).toEqual([
      ['BB 222 BB', 'Client C', '1'],
      ['', '', '2'],
    ]);
  });

  it('range les livraisons qui se suivent sous une seule ligne (anciennes étapes sans LV)', () => {
    const events = [
      ev('livraison', '2026-03-02T08:00', 'Narbonne', '11', 100_100, { client: 'Client A' }),
      ev('livraison', '2026-03-02T09:00', 'Narbonne', '11', 100_110, { client: 'Client B' }),
      ev('chargement', '2026-03-02T10:00', 'Toulouse', '31', 100_200, { client: 'Usine C' }),
      ev('chargement', '2026-03-02T11:00', 'Toulouse', '31', 100_210, { client: 'Usine D' }),
      ev('livraison', '2026-03-02T14:00', 'Périgueux', '24', 100_500, { client: 'Client E' }),
      ev('livraison', '2026-03-02T15:00', 'Périgueux', '24', 100_510, { client: 'Client F' }),
    ];
    const rows = buildWeekSheet(events, [], start, settings).operations[0];
    expect(rows.map((r) => [r.trailer, r.shipper, r.consignee])).toEqual([
      ['BB 222 BB', '', 'Client A'],
      ['', '', 'Client B'],
      ['BB 222 BB', 'Usine C', ''],
      ['BB 222 BB', 'Usine D', 'Client E'],
      ['', '', 'Client F'],
    ]);
  });
});
