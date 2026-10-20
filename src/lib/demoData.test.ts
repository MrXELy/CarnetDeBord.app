import { describe, expect, it } from 'vitest';
import { newWaybill, type TripEvent } from '../types';
import { legacyWaybills, readDemoData } from './demoData';

let n = 0;
function ev(type: TripEvent['type'], occurred: string, extra: Record<string, unknown> = {}) {
  return {
    id: `e${++n}`,
    type,
    occurred_at: new Date(occurred).toISOString(),
    tractor_plate: '',
    trailer_plate: '',
    odometer_km: null,
    notes: null,
    station: null,
    diesel_l: null,
    adblue_l: null,
    city: '',
    postcode: null,
    department: null,
    country_code: null,
    lat: null,
    lon: null,
    updated_at: '',
    deleted_at: null,
    ...extra,
  } as TripEvent & { client?: string | null; cmr_number?: string | null };
}

describe('legacyWaybills', () => {
  it('fait une LV par ancien chargement, livrée par la livraison suivante', () => {
    const loadA = ev('chargement', '2026-03-02T08:00', { client: 'Usine A' });
    const loadB = ev('chargement', '2026-03-02T10:00', { client: 'Usine B', cmr_number: '12' });
    const dropA = ev('livraison', '2026-03-02T14:00', { client: 'Client C' });
    const dropB = ev('livraison', '2026-03-03T09:00');
    const alone = ev('livraison', '2026-03-04T09:00', { client: 'Client D' });
    const list = legacyWaybills([alone, dropB, dropA, loadB, loadA], []);
    expect(list.map((w) => [w.loading_event_id, w.delivery_event_id, w.shipper, w.consignee, w.number])).toEqual([
      [loadA.id, dropA.id, 'Usine A', 'Client C', null],
      [loadB.id, dropB.id, 'Usine B', null, '12'],
      [null, alone.id, null, 'Client D', null],
    ]);
  });

  it('laisse les étapes qui ont déjà une LV, et lit l’ancien format (liste des étapes)', () => {
    const load = ev('chargement', '2026-03-02T08:00', { client: 'Usine A' });
    expect(legacyWaybills([load], [newWaybill({ loading_event_id: load.id })])).toEqual([]);
    expect(readDemoData([load]).waybills).toHaveLength(1);
    expect(readDemoData([ev('chargement', '2026-03-02T08:00')])).toEqual({
      events: [expect.objectContaining({ type: 'chargement' })],
    });
  });
});
