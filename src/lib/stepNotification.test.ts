import { describe, expect, it } from 'vitest';
import type { TripEvent } from '../types';
import { applyFinishes, stepNotice } from './stepNotification';

function ev(type: TripEvent['type'], extra: Partial<TripEvent> = {}): TripEvent {
  return {
    id: 'e1',
    type,
    occurred_at: new Date('2026-10-20T14:35').toISOString(),
    finished_at: null,
    tractor_plate: 'AA-111-AA',
    trailer_plate: '',
    odometer_km: null,
    notes: null,
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

/** Store réduit : les étapes connues, et les fins validées. */
function fakeStore(events: TripEvent[]) {
  const finished: [string, string][] = [];
  return {
    finished,
    event: (id: string | null) => events.find((e) => e.id === id && !e.deleted_at) ?? null,
    finishStep: (id: string, at: string) => void finished.push([id, at]),
  };
}

describe('stepNotice', () => {
  it('livraison : lieu, arrivée et bouton', () => {
    expect(stepNotice(ev('livraison'))).toEqual({
      title: 'Livraison en cours',
      body: 'Narbonne (11) · Arrivée à 14:35',
      action: 'Fin de la livraison',
    });
  });

  it('chargement sans lieu', () => {
    expect(stepNotice(ev('chargement', { city: '' }))).toEqual({
      title: 'Chargement en cours',
      body: 'Arrivée à 14:35',
      action: 'Fin du chargement',
    });
  });
});

describe('applyFinishes', () => {
  const at = '2026-10-20T15:20:00.000Z';

  it('valide la fin d’une étape en cours', () => {
    const store = fakeStore([ev('livraison')]);
    applyFinishes(store, [{ eventId: 'e1', finishedAt: at }]);
    expect(store.finished).toEqual([['e1', at]]);
  });

  it('ignore une étape déjà finie, supprimée ou inconnue', () => {
    const done = fakeStore([ev('livraison', { finished_at: '2026-10-20T15:00:00.000Z' })]);
    applyFinishes(done, [{ eventId: 'e1', finishedAt: at }]);
    const deleted = fakeStore([ev('chargement', { deleted_at: at })]);
    applyFinishes(deleted, [{ eventId: 'e1', finishedAt: at }]);
    const other = fakeStore([ev('chargement')]);
    applyFinishes(other, [{ eventId: 'autre', finishedAt: at }]);
    expect([...done.finished, ...deleted.finished, ...other.finished]).toEqual([]);
  });
});
