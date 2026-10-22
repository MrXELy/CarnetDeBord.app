import { describe, expect, it } from 'vitest';
import { newWaybill, type TripEvent } from '../types';
import { onSiteMinutes, onSiteTimes, unfinishedStep } from './onSite';

let n = 0;
function ev(type: TripEvent['type'], occurred: string, finished?: string, extra: Partial<TripEvent> = {}): TripEvent {
  return {
    id: `e${n++}`,
    type,
    occurred_at: new Date(occurred).toISOString(),
    finished_at: finished ? new Date(finished).toISOString() : null,
    tractor_plate: 'AA-111-AA',
    trailer_plate: '',
    odometer_km: null,
    notes: null,
    station: null,
    diesel_l: null,
    adblue_l: null,
    city: 'Narbonne',
    postcode: null,
    department: null,
    country_code: null,
    lat: null,
    lon: null,
    updated_at: '',
    deleted_at: null,
    ...extra,
  };
}

describe('unfinishedStep', () => {
  it('rend la dernière étape si c’est un chargement ou une livraison sans fin', () => {
    const load = ev('chargement', '2026-10-20T08:12');
    expect(unfinishedStep([load, ev('debut_journee', '2026-10-20T05:00')])).toBe(load);
  });

  it('rien si la fin est validée, si une autre étape a suivi, ou si c’est un plein', () => {
    expect(unfinishedStep([ev('livraison', '2026-10-20T08:12', '2026-10-20T09:00')])).toBeNull();
    expect(unfinishedStep([ev('livraison', '2026-10-20T11:00'), ev('chargement', '2026-10-20T08:12')])).not.toBeNull();
    expect(unfinishedStep([ev('carburant', '2026-10-20T11:00'), ev('chargement', '2026-10-20T08:12')])).toBeNull();
  });

  it('ignore les étapes supprimées', () => {
    const load = ev('chargement', '2026-10-20T08:12');
    expect(unfinishedStep([ev('fin_journee', '2026-10-20T18:00', undefined, { deleted_at: 'x' }), load])).toBe(load);
  });
});

describe('onSiteMinutes', () => {
  it('compte de l’arrivée à la fin, refuse une fin avant ou égale à l’arrivée, ou au-delà de 24 h', () => {
    expect(onSiteMinutes(ev('chargement', '2026-10-20T08:12', '2026-10-20T09:40'))).toBe(88);
    expect(onSiteMinutes(ev('chargement', '2026-10-20T08:12', '2026-10-20T08:00'))).toBeNull();
    expect(onSiteMinutes(ev('chargement', '2026-10-20T08:12', '2026-10-20T08:12'))).toBeNull();
    expect(onSiteMinutes(ev('chargement', '2026-10-20T08:12', '2026-10-22T08:00'))).toBeNull();
    expect(onSiteMinutes(ev('chargement', '2026-10-20T08:12'))).toBeNull();
  });
});

describe('onSiteTimes', () => {
  it('moyenne générale et par client, le plus long en premier', () => {
    const a = ev('chargement', '2026-10-20T08:00', '2026-10-20T09:00');
    const b = ev('livraison', '2026-10-20T14:00', '2026-10-20T16:00');
    const c = ev('chargement', '2026-10-21T08:00', '2026-10-21T08:30');
    const d = ev('livraison', '2026-10-21T14:00');
    const waybills = [
      newWaybill({ loading_event_id: a.id, delivery_event_id: b.id, shipper: 'Client A', consignee: 'Client B' }),
      newWaybill({ loading_event_id: a.id, shipper: 'Client A' }),
      newWaybill({ loading_event_id: c.id, delivery_event_id: d.id, shipper: 'Usine Client A', consignee: 'Client B' }),
    ];
    const range = { start: new Date('2026-10-18T22:00'), end: new Date('2026-10-25T22:00') };
    expect(onSiteTimes([d, c, b, a], waybills, range)).toEqual({
      average: 70,
      count: 3,
      clients: [
        { name: 'Client B', average: 120, count: 1 },
        { name: 'Client A', average: 45, count: 2 },
      ],
    });
  });
});
