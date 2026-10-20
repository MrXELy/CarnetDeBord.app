import { describe, expect, it } from 'vitest';
import { newWaybill, type TripEvent } from '../types';
import { eventsToCsv, waybillsToCsv } from './csv';

function ev(id: string, occurred: string, extra: Partial<TripEvent> = {}): TripEvent {
  return {
    id, type: 'carburant', occurred_at: new Date(occurred).toISOString(),
    tractor_plate: 'GH-512-KL', trailer_plate: 'RT-998-AZ', odometer_km: 241290, notes: null,
    station: 'AS24', diesel_l: 412.5, adblue_l: 35, city: 'Mâcon', postcode: '71000',
    department: '71', country_code: 'FR', lat: null, lon: null, updated_at: '', deleted_at: null, ...extra,
  };
}

describe('eventsToCsv', () => {
  const lines = eventsToCsv([
    ev('b', '2026-10-16T10:10', { notes: 'Pompe 3; "rapide"' }),
    ev('a', '2026-10-15T08:00', { type: 'debut_journee', station: null, diesel_l: null, adblue_l: null }),
    ev('x', '2026-10-15T09:00', { deleted_at: '2026-10-15T10:00:00Z' }),
  ]).split('\r\n');

  it('commence par le BOM et l’en-tête', () => {
    expect(lines[0].startsWith('﻿Date;Heure;Type;')).toBe(true);
  });

  it('trie chronologiquement et ignore les étapes supprimées', () => {
    expect(lines).toHaveLength(4); // en-tête + 2 lignes + fin de fichier
    expect(lines[1].startsWith('15/10/2026;08:00;Début de journée;')).toBe(true);
  });

  it('utilise la virgule décimale et échappe les remarques', () => {
    expect(lines[2]).toBe(
      '16/10/2026;10:10;Carburant;GH-512-KL;RT-998-AZ;241290;Mâcon;71000;71;FR;;;AS24;412,5;Non;35;"Pompe 3; ""rapide"""',
    );
  });
});

describe('LV dans les exports', () => {
  const load = ev('load', '2026-10-12T08:00', { type: 'chargement', station: null, diesel_l: null, adblue_l: null, city: 'Cognac', department: '16' });
  const drop = ev('drop', '2026-10-12T15:00', { type: 'livraison', station: null, diesel_l: null, adblue_l: null, city: 'Tours', department: '37' });
  const waybills = [
    newWaybill({ number: '458712', consignee: 'Knauf', shipper: 'Placoplâtre', weight_kg: 12500.5, loading_event_id: 'load', delivery_event_id: 'drop' }),
    newWaybill({ consignee: 'Leroy Merlin', loading_event_id: 'load' }),
  ];

  it('liste les clients et numéros de chaque étape', () => {
    const lines = eventsToCsv([load, drop], waybills).split('\r\n');
    expect(lines[1]).toContain(';Knauf, Leroy Merlin;458712;');
    expect(lines[2]).toContain(';Knauf;458712;');
  });

  it('exporte une ligne par lettre de voiture', () => {
    const lines = waybillsToCsv(waybills, [load, drop]).split('\r\n');
    expect(lines[0]).toBe('﻿N° lettre de voiture;Expéditeur;Client;Marchandise;Poids (kg);Date chargement;Heure chargement;Lieu chargement;Ville prévue;Date livraison;Heure livraison;Lieu livraison;Statut;Remarque');
    expect(lines[1]).toBe('458712;Placoplâtre;Knauf;;12500,5;12/10/2026;08:00;Cognac (16);;12/10/2026;15:00;Tours (37);Livrée;');
    expect(lines[2]).toBe(';;Leroy Merlin;;;12/10/2026;08:00;Cognac (16);;;;;À compléter;');
  });
});
