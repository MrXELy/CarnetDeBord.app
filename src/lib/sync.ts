import type { TripEvent } from '../types';
import { supabase } from './supabase';

export interface SyncState {
  events: TripEvent[];
  pending: number;
  syncing: boolean;
  online: boolean;
  error: string | null;
}

const PAGE = 1000;

/**
 * Cache local des événements + file d'envoi.
 * Tout est d'abord enregistré dans le téléphone, puis envoyé à Supabase dès que le réseau le permet.
 */
export class EventStore {
  private events = new Map<string, TripEvent>();
  private outbox = new Set<string>();
  private cursor: string | null = null;
  private listeners = new Set<() => void>();
  private state: SyncState;
  private syncing = false;
  private error: string | null = null;

  constructor(private userId: string) {
    const saved = this.read<{ events: TripEvent[]; outbox: string[]; cursor: string | null }>('data');
    saved?.events.forEach((e) => this.events.set(e.id, e));
    saved?.outbox.forEach((id) => this.outbox.add(id));
    this.cursor = saved?.cursor ?? null;
    this.state = this.snapshot();
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.emit);
    void this.sync();
  }

  dispose() {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.emit);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  save(event: TripEvent) {
    this.events.set(event.id, { ...event, updated_at: new Date().toISOString() });
    this.outbox.add(event.id);
    if (!event.deleted_at) {
      this.write('plates', { tractor: event.tractor_plate, trailer: event.trailer_plate });
    }
    this.persist();
    void this.sync();
  }

  remove(event: TripEvent) {
    this.save({ ...event, deleted_at: new Date().toISOString() });
  }

  isPending(id: string) {
    return this.outbox.has(id);
  }

  /** Immatriculations de la dernière saisie, ou à défaut de l'événement le plus récent. */
  lastPlates(): { tractor: string; trailer: string } {
    const saved = this.read<{ tractor: string; trailer: string }>('plates');
    if (saved) return saved;
    const latest = this.state.events[0];
    return { tractor: latest?.tractor_plate ?? '', trailer: latest?.trailer_plate ?? '' };
  }

  /** Dernier kilométrage relevé pour ce tracteur avant cette date. */
  lastOdometer(tractor: string, before: Date, excludeId?: string): number | null {
    const iso = before.toISOString();
    const e = this.state.events.find(
      (e) => e.id !== excludeId && e.tractor_plate === tractor && e.odometer_km != null && e.occurred_at <= iso,
    );
    return e?.odometer_km ?? null;
  }

  /** Dernière « fin de journée » avant cette date : point de départ de la journée suivante. */
  lastDayEnd(before: Date): TripEvent | null {
    const iso = before.toISOString();
    return this.state.events.find((e) => e.type === 'fin_journee' && e.occurred_at <= iso) ?? null;
  }

  async sync() {
    if (this.syncing || !navigator.onLine) return this.emit();
    this.syncing = true;
    this.emit();
    try {
      await this.push();
      await this.pull();
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Erreur de synchronisation';
    } finally {
      this.syncing = false;
      this.persist();
    }
  }

  private async push() {
    if (!this.outbox.size) return;
    const sent = [...this.outbox].map((id) => this.events.get(id)!);
    const rows = sent.map(({ updated_at: _ignored, ...row }) => row);
    const { error } = await supabase.from('events').upsert(rows);
    if (error) throw new Error(error.message);
    // Ne retire de la file que ce qui n'a pas été modifié pendant l'envoi.
    for (const e of sent) {
      if (this.events.get(e.id)?.updated_at === e.updated_at) this.outbox.delete(e.id);
    }
  }

  private async pull() {
    for (;;) {
      let query = supabase.from('events').select('*').order('updated_at').limit(PAGE);
      if (this.cursor) query = query.gt('updated_at', this.cursor);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      for (const row of data as (TripEvent & { user_id: string; created_at: string })[]) {
        const { user_id: _u, created_at: _c, ...event } = row;
        if (!this.outbox.has(event.id)) this.events.set(event.id, normalize(event));
        this.cursor = row.updated_at;
      }
      if (data.length < PAGE) return;
    }
  }

  private handleOnline = () => void this.sync();

  private snapshot(): SyncState {
    return {
      events: [...this.events.values()]
        .filter((e) => !e.deleted_at)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
      pending: this.outbox.size,
      syncing: this.syncing,
      online: navigator.onLine,
      error: this.error,
    };
  }

  private emit = () => {
    this.state = this.snapshot();
    this.listeners.forEach((l) => l());
  };

  private persist() {
    this.write('data', { events: [...this.events.values()], outbox: [...this.outbox], cursor: this.cursor });
    this.emit();
  }

  private key(name: string) {
    return `cdb.${this.userId}.${name}`;
  }

  private read<T>(name: string): T | null {
    try {
      const raw = localStorage.getItem(this.key(name));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private write(name: string, value: unknown) {
    try {
      localStorage.setItem(this.key(name), JSON.stringify(value));
    } catch {
      this.error = 'Stockage local plein ou indisponible';
    }
  }
}

/** Supabase renvoie les colonnes « numeric » sous forme de texte. */
function normalize(e: TripEvent): TripEvent {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return { ...e, diesel_l: num(e.diesel_l), adblue_l: num(e.adblue_l) };
}
