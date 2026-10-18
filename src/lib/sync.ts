import { isInTruck, type Place, type TripEvent, type Waybill, type WeekMap } from '../types';
import { DEFAULT_ALLOWANCE_SETTINGS, computeAllowances, type Allowance, type AllowanceSettings } from './allowances';
import { fuelIntervals, type FuelInterval } from './fuel';
import { uploadPending } from './photos';
import { supabase } from './supabase';

export interface SyncState {
  events: TripEvent[];
  waybills: Waybill[];
  pending: number;
  syncing: boolean;
  online: boolean;
  error: string | null;
  /** Mode démo local : données dans le navigateur uniquement, jamais envoyées à Supabase. */
  demo: boolean;
  /** Bases et tarifs des frais de déplacement. */
  allowanceSettings: AllowanceSettings;
}

/** Réglages partagés entre les appareils : une seule ligne, identifiée par l'utilisateur. */
interface UserSettingsRow extends Row {
  allowances: AllowanceSettings | null;
}

const PAGE = 1000;

interface Row {
  id: string;
  updated_at: string;
  deleted_at: string | null;
}

interface Saved<T> {
  items: T[];
  outbox: string[];
  cursor: string | null;
}

/**
 * Une table Supabase recopiée dans le téléphone : cache local + file d'envoi.
 * Tout est d'abord enregistré localement, puis envoyé dès que le réseau le permet.
 */
export class Collection<T extends Row> {
  readonly items = new Map<string, T>();
  readonly outbox = new Set<string>();
  cursor: string | null = null;

  constructor(
    private table: string,
    private normalize: (row: T) => T = (row) => row,
  ) {}

  load(saved: Saved<T> | null) {
    saved?.items.forEach((item) => this.items.set(item.id, this.normalize(item)));
    saved?.outbox.forEach((id) => this.outbox.add(id));
    this.cursor = saved?.cursor ?? null;
  }

  dump(): Saved<T> {
    return { items: [...this.items.values()], outbox: [...this.outbox], cursor: this.cursor };
  }

  save(item: T) {
    this.items.set(item.id, { ...item, updated_at: new Date().toISOString() });
    this.outbox.add(item.id);
  }

  alive(): T[] {
    return [...this.items.values()].filter((item) => !item.deleted_at);
  }

  async push() {
    if (!this.outbox.size) return;
    const sent = [...this.outbox].map((id) => this.items.get(id)!);
    // updated_at est fixé par le serveur.
    const rows: Record<string, unknown>[] = sent.map(({ updated_at: _ignored, ...row }) => row);
    const { error } = await supabase.from(this.table).upsert(rows);
    if (error) throw new Error(error.message);
    // Ne retire de la file que ce qui n'a pas été modifié pendant l'envoi.
    for (const item of sent) {
      if (this.items.get(item.id)?.updated_at === item.updated_at) this.outbox.delete(item.id);
    }
  }

  async pull() {
    for (;;) {
      let query = supabase.from(this.table).select('*').order('updated_at').limit(PAGE);
      if (this.cursor) query = query.gt('updated_at', this.cursor);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      for (const row of data as (T & { user_id: string; created_at: string })[]) {
        const { user_id: _u, created_at: _c, ...item } = row;
        if (!this.outbox.has(item.id)) this.items.set(item.id, this.normalize(item as unknown as T));
        this.cursor = row.updated_at;
      }
      if (data.length < PAGE) return;
    }
  }
}

/** Étapes et lettres de voiture de l'utilisateur, avec leur synchronisation. */
export class EventStore {
  private events = new Collection<TripEvent>('events', normalizeEvent);
  private waybills = new Collection<Waybill>('waybills', normalizeWaybill);
  private weekMaps = new Collection<WeekMap>('week_maps');
  private userSettings = new Collection<UserSettingsRow>('user_settings');
  private listeners = new Set<() => void>();
  private state: SyncState;
  private syncing = false;
  private error: string | null = null;
  private fuelCache: { events: TripEvent[]; intervals: FuelInterval[] } | null = null;
  private settingsCache: { row: UserSettingsRow | undefined; settings: AllowanceSettings } | null = null;
  private allowanceCache: { events: TripEvent[]; settings: AllowanceSettings; list: Allowance[] } | null = null;

  constructor(
    readonly userId: string,
    private options: { offline?: boolean } = {},
  ) {
    // « data » garde son ancien format ({ events, outbox, cursor }) pour relire le cache existant.
    const saved = this.read<{ events: TripEvent[]; outbox: string[]; cursor: string | null }>('data');
    this.events.load(saved && { items: saved.events, outbox: saved.outbox, cursor: saved.cursor });
    this.waybills.load(this.read<Saved<Waybill>>('waybills'));
    this.weekMaps.load(this.read<Saved<WeekMap>>('week_maps'));
    this.userSettings.load(this.read<Saved<UserSettingsRow>>('user_settings'));
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

  /** Enregistre une étape et, éventuellement, les lettres de voiture modifiées avec elle. */
  save(event: TripEvent, waybills: Waybill[] = []) {
    this.events.save(event);
    waybills.forEach((w) => this.waybills.save(w));
    if (!event.deleted_at) {
      this.write('plates', { tractor: event.tractor_plate, trailer: event.trailer_plate });
    }
    this.commit();
  }

  /**
   * Supprime une étape. Les LV d'un chargement sont supprimées avec lui ;
   * celles d'une livraison retournent « dans le camion ».
   */
  remove(event: TripEvent) {
    const now = new Date().toISOString();
    this.events.save({ ...event, deleted_at: now });
    for (const w of this.waybills.alive()) {
      if (w.loading_event_id === event.id) this.waybills.save({ ...w, deleted_at: now });
      else if (w.delivery_event_id === event.id) this.waybills.save({ ...w, delivery_event_id: null });
    }
    this.commit();
  }

  /** Carte enregistrée d'une semaine (identifiée par son début, le dimanche 22h). */
  weekMap(weekStart: Date): WeekMap | null {
    const iso = weekStart.toISOString();
    return this.weekMaps.alive().find((m) => new Date(m.week_start).toISOString() === iso) ?? null;
  }

  saveWeekMap(map: WeekMap) {
    this.weekMaps.save(map);
    this.commit();
  }

  /** Enregistre les bases et les tarifs des frais de déplacement. */
  saveAllowanceSettings(settings: AllowanceSettings) {
    const row = this.userSettings.items.get(this.userId);
    this.userSettings.save({ id: this.userId, updated_at: '', deleted_at: null, ...row, allowances: settings });
    this.commit();
  }

  /** Frais de déplacement de tout l'historique, recalculés seulement si les étapes ou les réglages changent. */
  allowances(): Allowance[] {
    const { events, allowanceSettings: settings } = this.state;
    const cache = this.allowanceCache;
    if (cache?.events === events && cache.settings === settings) return cache.list;
    const list = computeAllowances(events, settings);
    this.allowanceCache = { events, settings, list };
    return list;
  }

  /** Complète le lieu d'une étape (coordonnées retrouvées d'après le nom de la ville). */
  completePlace(eventId: string, place: Place) {
    const event = this.event(eventId);
    if (!event) return;
    this.events.save({ ...event, ...place, city: event.city || place.city });
    this.commit();
  }

  /** Change le lieu d'une étape, par exemple depuis la fiche d'une de ses lettres de voiture. */
  setEventPlace(eventId: string, place: Place) {
    const event = this.event(eventId);
    if (!event) return;
    this.events.save({ ...event, ...place, city: place.city.trim() });
    this.commit();
  }

  /** Change la date et l'heure d'une étape (ISO), par exemple depuis la fiche d'une de ses LV. */
  setEventTime(eventId: string, occurredAt: string) {
    const event = this.event(eventId);
    if (!event) return;
    this.events.save({ ...event, occurred_at: occurredAt });
    this.commit();
  }

  saveWaybill(waybill: Waybill) {
    this.waybills.save(waybill);
    this.commit();
  }

  removeWaybill(waybill: Waybill) {
    this.saveWaybill({ ...waybill, deleted_at: new Date().toISOString() });
  }

  isPending(id: string) {
    return this.events.outbox.has(id) || this.waybills.outbox.has(id);
  }

  event(id: string | null): TripEvent | null {
    const e = id ? this.events.items.get(id) : undefined;
    return e && !e.deleted_at ? e : null;
  }

  /** Version enregistrée d'une LV (y compris supprimée), pour comparer avec un brouillon. */
  waybill(id: string): Waybill | undefined {
    return this.waybills.items.get(id);
  }

  /** LV chargées à cette étape. */
  loadedAt(eventId: string): Waybill[] {
    return this.state.waybills.filter((w) => w.loading_event_id === eventId);
  }

  /** LV livrées à cette étape. */
  deliveredAt(eventId: string): Waybill[] {
    return this.state.waybills.filter((w) => w.delivery_event_id === eventId);
  }

  /** LV dans le camion à cette date : pas encore livrées, et chargées avant (ou chargement inconnu). */
  inTruck(at: Date): Waybill[] {
    const iso = at.toISOString();
    return this.state.waybills.filter((w) => {
      if (!isInTruck(w)) return false;
      const loading = this.event(w.loading_event_id);
      return !loading || loading.occurred_at <= iso;
    });
  }

  /** Clients et expéditeurs déjà saisis, du plus fréquent au moins fréquent. */
  knownNames(): string[] {
    const counts = new Map<string, number>();
    for (const w of this.state.waybills) {
      for (const name of [w.consignee, w.shipper]) {
        const n = name?.trim();
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }

  /** Immatriculations de la dernière saisie, ou à défaut de l'événement le plus récent. */
  lastPlates(): { tractor: string; trailer: string } {
    const saved = this.read<{ tractor: string; trailer: string }>('plates');
    if (saved) return saved;
    const latest = this.state.events[0];
    return { tractor: latest?.tractor_plate ?? '', trailer: latest?.trailer_plate ?? '' };
  }

  /** Intervalles entre pleins complets, recalculés seulement quand les étapes changent. */
  fuelIntervals(): FuelInterval[] {
    if (this.fuelCache?.events !== this.state.events) {
      this.fuelCache = { events: this.state.events, intervals: fuelIntervals(this.state.events) };
    }
    return this.fuelCache.intervals;
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
    if (this.options.offline || this.syncing || !navigator.onLine) return this.emit();
    this.syncing = true;
    this.emit();
    try {
      // Les étapes d'abord : une LV fait référence à ses étapes de chargement et de livraison.
      await this.events.push();
      await this.events.pull();
      try {
        await this.waybills.push();
        await this.waybills.pull();
      } catch (err) {
        throw new Error(
          /waybills/.test(String(err)) ? 'Table des lettres de voiture absente dans Supabase' : String(err),
        );
      }
      // Photos prises sans réseau : envoyées dès que possible.
      await uploadPending();
      this.error = null;
      // Cartes des semaines : un échec ne bloque pas le reste.
      try {
        await this.weekMaps.push();
        await this.weekMaps.pull();
      } catch (err) {
        this.error = /week_maps/.test(String(err)) ? 'Table des cartes absente dans Supabase' : String(err);
      }
      // Réglages partagés : un échec ne bloque pas le reste non plus.
      try {
        await this.userSettings.push();
        await this.userSettings.pull();
      } catch (err) {
        this.error = /user_settings/.test(String(err)) ? 'Table des réglages absente dans Supabase' : String(err);
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Erreur de synchronisation';
    } finally {
      this.syncing = false;
      this.persist();
    }
  }

  private commit() {
    this.persist();
    void this.sync();
  }

  private handleOnline = () => void this.sync();

  private snapshot(): SyncState {
    return {
      events: this.events.alive().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
      waybills: this.waybills.alive(),
      pending:
        this.events.outbox.size + this.waybills.outbox.size + this.weekMaps.outbox.size + this.userSettings.outbox.size,
      syncing: this.syncing,
      online: navigator.onLine,
      error: this.error,
      demo: !!this.options.offline,
      allowanceSettings: this.allowanceSettings(),
    };
  }

  /** Réglages des frais, avec les valeurs par défaut ; même objet tant que la ligne ne change pas. */
  private allowanceSettings(): AllowanceSettings {
    const row = this.userSettings.items.get(this.userId);
    if (this.settingsCache && this.settingsCache.row === row) return this.settingsCache.settings;
    const saved = row?.allowances;
    const settings: AllowanceSettings = {
      bases: saved?.bases ?? DEFAULT_ALLOWANCE_SETTINGS.bases,
      rates: saved?.rates?.length ? saved.rates : DEFAULT_ALLOWANCE_SETTINGS.rates,
    };
    this.settingsCache = { row, settings };
    return settings;
  }

  private emit = () => {
    this.state = this.snapshot();
    this.listeners.forEach((l) => l());
  };

  private persist() {
    const events = this.events.dump();
    this.write('data', { events: events.items, outbox: events.outbox, cursor: events.cursor });
    this.write('waybills', this.waybills.dump());
    this.write('week_maps', this.weekMaps.dump());
    this.write('user_settings', this.userSettings.dump());
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
const num = (v: unknown) => (v == null ? null : Number(v));

function normalizeEvent(e: TripEvent): TripEvent {
  return { ...e, diesel_l: num(e.diesel_l), adblue_l: num(e.adblue_l), full_tank: e.full_tank ?? null };
}

function normalizeWaybill(w: Waybill): Waybill {
  return { ...w, weight_kg: num(w.weight_kg), photo_paths: w.photo_paths ?? [] };
}
