import { isInTruck, plateKey, type Place, type TripEvent, type Waybill, type WeekMap } from '../types';
import { DEFAULT_ALLOWANCE_SETTINGS, computeAllowances, type Allowance, type AllowanceSettings } from './allowances';
import { kmTimeline, type KmTimeline } from './emptyKm';
import { fuelIntervals, type FuelInterval } from './fuel';
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from './reminders';
import { restChecks, type RestCheck } from './rest';
import { loadCache, readCache, writeCache } from './localCache';
import { cleanOrphanPhotos, flushTrash, trashPhotos, uploadPending } from './photos';
import { supabase } from './supabase';
import { DEFAULT_SHEET_SETTINGS, type SheetSettings } from './weekSheet';

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
  /** Nom, agence et dépôts de la feuille de semaine. */
  sheetSettings: SheetSettings;
  /** Échéances (carte, FCO, visite médicale, contrôles techniques, chrono). */
  reminderSettings: ReminderSettings;
}

/** Réglages partagés entre les appareils : une seule ligne, identifiée par l'utilisateur. */
interface UserSettingsRow extends Row {
  allowances: AllowanceSettings | null;
  /** Colonne ajoutée par la migration 009 : absente des anciennes lignes. */
  week_sheet?: SheetSettings | null;
  /** Colonne ajoutée par la migration 010 : absente des anciennes lignes. */
  reminders?: ReminderSettings | null;
}

const PAGE = 1000;
const DAY_MS = 24 * 3600 * 1000;
/**
 * Lignes supprimées : gardées sur le serveur avec leur date de suppression (`deleted_at`) le temps que les autres
 * appareils l'apprennent, puis vraiment effacées au bout de 30 jours (`purge`). Chaque appareil relit tout
 * une fois par semaine (`pull(true)`) et oublie ce que le serveur n'a plus : bien avant les 30 jours,
 * donc aucune suppression n'est manquée, même avec une horloge un peu fausse.
 */
const PURGE_AFTER_MS = 30 * DAY_MS;
const FULL_SYNC_MS = 7 * DAY_MS;

/** Clés locales d'un utilisateur : « cdb.<id>.<nom> ». */
const storageKey = (userId: string, name: string) => `cdb.${userId}.${name}`;
/** Données gardées dans le cache IndexedDB (`localCache.ts`) ; les autres clés, petites, restent dans localStorage. */
const CACHED = ['data', 'waybills', 'week_maps', 'user_settings'];

/** Charge le cache local de cet utilisateur : à attendre avant de créer son `EventStore`. */
export const loadStoreCache = (userId: string) => loadCache(CACHED.map((name) => storageKey(userId, name)));

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
 * Le serveur a refusé une ou plusieurs lignes précises (les autres sont parties). Distincte des erreurs qui
 * concernent tout l'envoi (réseau, session, table absente) : celles-là arrêtent la synchro, celle-ci non.
 */
export class RowRefusedError extends Error {
  constructor(
    readonly table: string,
    /** Première ligne refusée : « id : raison du serveur ». */
    readonly first: string,
    /** Nombre de lignes refusées dans cette table. */
    readonly count: number,
  ) {
    super(`Ligne refusée par le serveur (${table}) ${first}`);
  }
}

/**
 * Vrai si le serveur a refusé cette ligne précisément (contrainte, clé étrangère, valeur invalide…),
 * donc que renvoyer les autres lignes seules a un sens (classes 22 et 23 : valeur invalide, contraintes).
 * Faux pour ce qui concerne tout l'envoi et non une ligne : panne réseau (pas de code d'erreur), session expirée
 * (401, 403, PGRST3xx), schéma ou colonne absente (PGRST2xx, 42P01, 42703, par exemple une migration pas encore
 * lancée), droits refusés (42501), connexion coupée ou base surchargée (classes 08, 53 et 57, dont le délai dépassé
 * 57014). Les autres codes restent des refus de ligne.
 */
function isRowRefusal(error: { code?: string; message: string }, status?: number): boolean {
  const code = error.code;
  if (!code || status === 401 || status === 403) return false;
  if (code.startsWith('PGRST2') || code.startsWith('PGRST3')) return false;
  if (['PGRST301', '42P01', '42703', '42501'].includes(code)) return false;
  return !['08', '53', '57'].includes(code.slice(0, 2));
}

/**
 * Une table Supabase recopiée dans le téléphone : cache local + file d'envoi.
 * Tout est d'abord enregistré localement, puis envoyé dès que le réseau le permet.
 */
export class Collection<T extends Row> {
  readonly items = new Map<string, T>();
  readonly outbox = new Set<string>();
  cursor: string | null = null;
  /**
   * Numéro de version de `items` : augmente à chaque vrai changement (enregistrement local,
   * lignes reçues du serveur, chargement du cache). Sert à garder les mêmes listes tant que rien n'a changé.
   * Tout nouvel endroit qui modifie `items` doit l'augmenter.
   */
  version = 0;

  constructor(
    private table: string,
    private normalize: (row: T) => T = (row) => row,
  ) {}

  load(saved: Saved<T> | null) {
    saved?.items.forEach((item) => this.items.set(item.id, this.normalize(item)));
    this.version++;
    saved?.outbox.forEach((id) => this.outbox.add(id));
    this.cursor = saved?.cursor ?? null;
  }

  dump(): Saved<T> {
    return { items: [...this.items.values()], outbox: [...this.outbox], cursor: this.cursor };
  }

  save(item: T) {
    this.items.set(item.id, { ...item, updated_at: new Date().toISOString() });
    this.outbox.add(item.id);
    this.version++;
  }

  alive(): T[] {
    return [...this.items.values()].filter((item) => !item.deleted_at);
  }

  /** Retire de la file ce qui vient d'être envoyé, mais pas ce qui a été modifié pendant l'envoi. */
  private release(sent: T[]) {
    for (const item of sent) {
      if (this.items.get(item.id)?.updated_at === item.updated_at) this.outbox.delete(item.id);
    }
  }

  /**
   * Envoie la file d'envoi en un seul lot. Si le serveur refuse le lot, renvoie les lignes une par une :
   * celles qui passent sortent de la file, celles qui sont refusées y restent et l'erreur les nomme.
   * Une erreur réseau (ou d'accès, ou de table absente) n'est pas retentée ligne par ligne : ce serait inutile.
   */
  async push() {
    if (!this.outbox.size) return;
    const sent = [...this.outbox].map((id) => this.items.get(id)!);
    // updated_at est fixé par le serveur.
    const toRow = ({ updated_at: _ignored, ...row }: T): Record<string, unknown> => row;
    const { error, status } = await supabase.from(this.table).upsert(sent.map(toRow));
    if (!error) return this.release(sent);
    if (!isRowRefusal(error, status)) throw new Error(error.message);
    if (sent.length === 1) throw new RowRefusedError(this.table, `${sent[0].id} : ${error.message}`, 1);

    const refused: string[] = [];
    for (const item of sent) {
      const { error: rowError, status: rowStatus } = await supabase.from(this.table).upsert([toRow(item)]);
      if (!rowError) this.release([item]);
      else if (!isRowRefusal(rowError, rowStatus)) throw new Error(rowError.message);
      else refused.push(`${item.id} : ${rowError.message}`);
    }
    if (refused.length) throw new RowRefusedError(this.table, refused[0], refused.length);
  }

  /**
   * Récupère les lignes modifiées depuis le curseur, par pages. Le curseur est le couple (date de modification, id) :
   * des lignes qui ont exactement la même date (un même envoi groupé) ne sont jamais sautées à la frontière d'une page.
   * Format enregistré : « date|id ». Un ancien curseur (la date seule) reprend à cette date, lignes comprises :
   * celles déjà connues sont simplement réécrites.
   * `full` : relit tout depuis le début, puis oublie les lignes que le serveur n'a plus (effacées par `purge`),
   * sauf celles qui attendent d'être envoyées.
   */
  async pull(full = false) {
    if (full) this.cursor = null;
    const seen = new Set<string>();
    for (;;) {
      let query = supabase.from(this.table).select('*').order('updated_at').order('id').limit(PAGE);
      if (this.cursor) {
        const [date, id] = this.cursor.split('|');
        query = id
          ? query.or(`updated_at.gt."${date}",and(updated_at.eq."${date}",id.gt."${id}")`)
          : query.gte('updated_at', date);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      for (const row of data as (T & { user_id: string; created_at: string })[]) {
        const { user_id: _u, created_at: _c, ...item } = row;
        seen.add(item.id);
        if (!this.outbox.has(item.id)) {
          this.items.set(item.id, this.normalize(item as unknown as T));
          this.version++;
        }
        this.cursor = `${row.updated_at}|${row.id}`;
      }
      if (data.length < PAGE) break;
    }
    if (!full) return;
    const gone = [...this.items.keys()].filter((id) => !seen.has(id) && !this.outbox.has(id));
    gone.forEach((id) => this.items.delete(id));
    if (gone.length) this.version++;
  }

  /** Efface vraiment du serveur les lignes supprimées avant cette date (ISO). */
  async purge(before: string) {
    const { error } = await supabase.from(this.table).delete().lt('deleted_at', before);
    if (error) throw new Error(error.message);
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
  /** Synchro en cours (pour attendre sa fin) et arrêt du store (déconnexion) : plus rien n'est écrit ni lancé. */
  private running: Promise<void> | null = null;
  private disposed = false;
  private error: string | null = null;
  // Listes affichées, gardées tant que la version de leur collection ne change pas (même tableau = rien de changé).
  private eventList: { version: number; list: TripEvent[] } | null = null;
  private waybillList: { version: number; list: Waybill[] } | null = null;
  /** Une demande de synchro est arrivée pendant une synchro en cours : une seule relance à la fin. */
  private resyncRequested = false;
  private indexCache: {
    waybills: Waybill[];
    loaded: Map<string, Waybill[]>;
    delivered: Map<string, Waybill[]>;
  } | null = null;
  private fuelCache: { events: TripEvent[]; intervals: FuelInterval[] } | null = null;
  private restCache: { events: TripEvent[]; checks: Map<string, RestCheck> } | null = null;
  private timelineCache: { events: TripEvent[]; waybills: Waybill[]; timeline: KmTimeline } | null = null;
  private settingsCache: { row: UserSettingsRow | undefined; settings: AllowanceSettings } | null = null;
  private sheetCache: { row: UserSettingsRow | undefined; settings: SheetSettings } | null = null;
  private reminderCache: { row: UserSettingsRow | undefined; settings: ReminderSettings } | null = null;
  private allowanceCache: { events: TripEvent[]; settings: AllowanceSettings; list: Allowance[] } | null = null;

  constructor(
    readonly userId: string,
    private options: { offline?: boolean } = {},
  ) {
    // Cache chargé avant (`loadStoreCache`). « data » garde son ancien format ({ events, outbox, cursor }).
    const saved = readCache<{ events: TripEvent[]; outbox: string[]; cursor: string | null }>(this.key('data'));
    this.events.load(saved && { items: saved.events, outbox: saved.outbox, cursor: saved.cursor });
    this.waybills.load(readCache<Saved<Waybill>>(this.key('waybills')));
    this.weekMaps.load(readCache<Saved<WeekMap>>(this.key('week_maps')));
    this.userSettings.load(readCache<Saved<UserSettingsRow>>(this.key('user_settings')));
    this.state = this.snapshot();
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.emit);
    void this.sync();
  }

  dispose() {
    this.disposed = true;
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
    waybills.forEach((w) => this.putWaybill(w));
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
      if (w.loading_event_id === event.id) this.putWaybill({ ...w, deleted_at: now });
      else if (w.delivery_event_id === event.id) this.putWaybill({ ...w, delivery_event_id: null });
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

  /** Enregistre le nom, l'agence et les dépôts de la feuille de semaine. */
  saveSheetSettings(settings: SheetSettings) {
    const row = this.userSettings.items.get(this.userId);
    this.userSettings.save({
      id: this.userId,
      updated_at: '',
      deleted_at: null,
      allowances: null,
      ...row,
      week_sheet: settings,
    });
    this.commit();
  }

  /** Enregistre les échéances et l'ensemble routier principal. */
  saveReminderSettings(settings: ReminderSettings) {
    const row = this.userSettings.items.get(this.userId);
    this.userSettings.save({
      id: this.userId,
      updated_at: '',
      deleted_at: null,
      allowances: null,
      ...row,
      reminders: settings,
    });
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

  /** Valide la fin d'un chargement ou d'une livraison (ISO). */
  finishStep(eventId: string, finishedAt: string) {
    const event = this.event(eventId);
    if (!event) return;
    this.events.save({ ...event, finished_at: finishedAt });
    this.commit();
  }

  saveWaybill(waybill: Waybill) {
    this.putWaybill(waybill);
    this.commit();
  }

  removeWaybill(waybill: Waybill) {
    this.saveWaybill({ ...waybill, deleted_at: new Date().toISOString() });
  }

  /** Enregistre une LV ; les photos qu'elle n'utilise plus (retirées, ou LV supprimée) partent à l'effacement. */
  private putWaybill(waybill: Waybill) {
    const before = this.waybills.items.get(waybill.id);
    const kept = waybill.deleted_at ? [] : waybill.photo_paths;
    if (before && !before.deleted_at) trashPhotos(before.photo_paths.filter((p) => !kept.includes(p)));
    this.waybills.save(waybill);
  }

  /**
   * Ménage des photos qui ne sont dans aucune LV : plus de 24 h pour le ménage automatique,
   * plus d'1 h à la demande. Les photos des LV de ce téléphone, même pas encore envoyées, sont gardées.
   */
  cleanPhotos(onDemand = false) {
    const keep = new Set(this.waybills.alive().flatMap((w) => w.photo_paths));
    return cleanOrphanPhotos(keep, onDemand ? '1 hour' : '24 hours');
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

  /** LV chargées à cette étape (dans l'ordre de la liste des LV). */
  loadedAt(eventId: string): Waybill[] {
    return this.waybillIndex().loaded.get(eventId) ?? [];
  }

  /** LV livrées à cette étape (dans l'ordre de la liste des LV). */
  deliveredAt(eventId: string): Waybill[] {
    return this.waybillIndex().delivered.get(eventId) ?? [];
  }

  /** Table étape → LV chargées / livrées, construite une fois par version de la liste des LV. */
  private waybillIndex() {
    const waybills = this.state.waybills;
    if (this.indexCache?.waybills === waybills) return this.indexCache;
    const loaded = new Map<string, Waybill[]>();
    const delivered = new Map<string, Waybill[]>();
    const add = (map: Map<string, Waybill[]>, id: string | null, w: Waybill) => {
      if (!id) return;
      const list = map.get(id);
      if (list) list.push(w);
      else map.set(id, [w]);
    };
    for (const w of waybills) {
      add(loaded, w.loading_event_id, w);
      add(delivered, w.delivery_event_id, w);
    }
    this.indexCache = { waybills, loaded, delivered };
    return this.indexCache;
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

  /** Contrôle des repos de chaque début de journée, recalculé seulement quand les étapes changent. */
  restChecks(): Map<string, RestCheck> {
    if (this.restCache?.events !== this.state.events) {
      this.restCache = { events: this.state.events, checks: restChecks(this.state.events) };
    }
    return this.restCache.checks;
  }

  /** Tronçons de km (à vide ou en charge) de tout l'historique, recalculés seulement si les étapes ou les LV changent. */
  kmTimeline(): KmTimeline {
    const { events, waybills } = this.state;
    const cache = this.timelineCache;
    if (cache?.events === events && cache.waybills === waybills) return cache.timeline;
    const timeline = kmTimeline(events, waybills);
    this.timelineCache = { events, waybills, timeline };
    return timeline;
  }

  /** Dernier kilométrage relevé pour ce tracteur avant cette date (plaque comparée sans tirets ni espaces). */
  lastOdometer(tractor: string, before: Date, excludeId?: string): number | null {
    const iso = before.toISOString();
    const key = plateKey(tractor);
    const e = this.state.events.find(
      (e) => e.id !== excludeId && plateKey(e.tractor_plate) === key && e.odometer_km != null && e.occurred_at <= iso,
    );
    return e?.odometer_km ?? null;
  }

  /** Dernière « fin de journée » avant cette date : point de départ de la journée suivante. */
  lastDayEnd(before: Date): TripEvent | null {
    const iso = before.toISOString();
    return this.state.events.find((e) => e.type === 'fin_journee' && e.occurred_at <= iso) ?? null;
  }

  async sync() {
    if (this.disposed || this.options.offline || !navigator.onLine) return this.emit();
    if (this.syncing) {
      // Par exemple une modification enregistrée pendant l'envoi : elle partira juste après.
      this.resyncRequested = true;
      return this.emit();
    }
    this.running = this.run();
    return this.running;
  }

  /** Attend la fin de la synchro en cours (et de sa relance éventuelle). */
  async whenIdle() {
    while (this.syncing && this.running) await this.running;
  }

  private async run() {
    this.syncing = true;
    this.emit();
    // Lignes refusées par le serveur : n'arrêtent pas la synchro, mais l'erreur affichée les nomme à la fin.
    const refusals: RowRefusedError[] = [];
    const tolerant = async (send: () => Promise<void>) => {
      try {
        await send();
      } catch (err) {
        if (!(err instanceof RowRefusedError)) throw err;
        refusals.push(err);
      }
    };
    // Relecture complète une fois par semaine : oublie les lignes effacées du serveur.
    const full = this.isDue('full_synced', FULL_SYNC_MS);
    try {
      // Les étapes d'abord : une LV fait référence à ses étapes de chargement et de livraison.
      await tolerant(() => this.events.push());
      await this.events.pull(full);
      try {
        await tolerant(() => this.waybills.push());
        await this.waybills.pull(full);
      } catch (err) {
        throw new Error(
          /waybills/.test(String(err)) ? 'Table des lettres de voiture absente dans Supabase' : String(err),
        );
      }
      // Photos prises sans réseau : envoyées dès que possible.
      await uploadPending(this.userId);
      this.error = null;
      // Photos à effacer, puis ménage une fois par jour : un échec est simplement retenté plus tard.
      try {
        await flushTrash(this.userId);
        if (this.isDue('photos_cleaned', DAY_MS)) {
          this.write('photos_cleaned', new Date().toISOString()); // une tentative par jour, même en cas d'échec
          await this.cleanPhotos();
        }
      } catch {
        // Fonction de ménage absente ou réseau coupé : rien de bloquant.
      }
      // Cartes des semaines : un échec ne bloque pas le reste.
      try {
        await tolerant(() => this.weekMaps.push());
        await this.weekMaps.pull(full);
        if (full) this.write('full_synced', new Date().toISOString());
      } catch (err) {
        this.error = /week_maps/.test(String(err)) ? 'Table des cartes absente dans Supabase' : String(err);
      }
      // Réglages partagés : un échec ne bloque pas le reste non plus.
      try {
        await tolerant(() => this.userSettings.push());
        await this.userSettings.pull();
      } catch (err) {
        this.error = /week_sheet/.test(String(err))
          ? 'Réglages de la feuille de semaine : migration 009 à lancer dans Supabase'
          : /reminders/.test(String(err))
            ? 'Échéances : migration 010 à lancer dans Supabase'
            : /user_settings/.test(String(err))
              ? 'Table des réglages absente dans Supabase'
              : String(err);
      }
      // Lignes supprimées depuis plus de 30 jours : effacées du serveur, une fois par jour.
      // Les LV d'abord : elles font référence aux étapes.
      if (this.isDue('purged', DAY_MS)) {
        this.write('purged', new Date().toISOString()); // une tentative par jour, même en cas d'échec
        try {
          const before = new Date(Date.now() - PURGE_AFTER_MS).toISOString();
          await this.waybills.purge(before);
          await this.weekMaps.purge(before);
          await this.events.purge(before);
        } catch {
          // Réseau coupé : retenté le lendemain, rien de bloquant.
        }
      }
      // Une ligne refusée reste signalée (pastille rouge) même si tout le reste a réussi.
      if (refusals.length && !this.error) {
        const total = refusals.reduce((n, r) => n + r.count, 0);
        this.error =
          `Ligne refusée par le serveur (${refusals[0].table}) ${refusals[0].first}` +
          (total > 1 ? ` (et ${total - 1} autre${total > 2 ? 's' : ''})` : '');
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Erreur de synchronisation';
    } finally {
      this.syncing = false;
      this.persist();
      // Une seule relance, même si plusieurs demandes sont arrivées ; les demandes de la relance ont leur propre drapeau.
      if (this.resyncRequested) {
        this.resyncRequested = false;
        void this.sync();
      }
    }
  }

  private commit() {
    this.persist();
    void this.sync();
  }

  private handleOnline = () => void this.sync();

  private snapshot(): SyncState {
    // Mêmes tableaux tant que les données n'ont pas changé : les caches et les écrans s'appuient dessus.
    if (this.eventList?.version !== this.events.version) {
      this.eventList = {
        version: this.events.version,
        list: this.events.alive().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
      };
    }
    if (this.waybillList?.version !== this.waybills.version) {
      this.waybillList = { version: this.waybills.version, list: this.waybills.alive() };
    }
    return {
      events: this.eventList.list,
      waybills: this.waybillList.list,
      pending:
        this.events.outbox.size + this.waybills.outbox.size + this.weekMaps.outbox.size + this.userSettings.outbox.size,
      syncing: this.syncing,
      online: navigator.onLine,
      error: this.error,
      demo: !!this.options.offline,
      allowanceSettings: this.allowanceSettings(),
      sheetSettings: this.sheetSettings(),
      reminderSettings: this.reminderSettings(),
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

  /** Réglages de la feuille de semaine ; même objet tant que la ligne ne change pas. */
  private sheetSettings(): SheetSettings {
    const row = this.userSettings.items.get(this.userId);
    if (this.sheetCache && this.sheetCache.row === row) return this.sheetCache.settings;
    const settings = { ...DEFAULT_SHEET_SETTINGS, ...row?.week_sheet };
    this.sheetCache = { row, settings };
    return settings;
  }

  /** Échéances ; même objet tant que la ligne ne change pas. */
  private reminderSettings(): ReminderSettings {
    const row = this.userSettings.items.get(this.userId);
    if (this.reminderCache && this.reminderCache.row === row) return this.reminderCache.settings;
    const settings = { ...DEFAULT_REMINDER_SETTINGS, ...row?.reminders };
    this.reminderCache = { row, settings };
    return settings;
  }

  private emit = () => {
    this.state = this.snapshot();
    this.listeners.forEach((l) => l());
  };

  private persist() {
    if (this.disposed) return; // store arrêté : le cache local ne doit plus être réécrit
    const events = this.events.dump();
    writeCache({
      [this.key('data')]: { events: events.items, outbox: events.outbox, cursor: events.cursor },
      [this.key('waybills')]: this.waybills.dump(),
      [this.key('week_maps')]: this.weekMaps.dump(),
      [this.key('user_settings')]: this.userSettings.dump(),
    }).catch(() => {
      this.error = 'Stockage local plein ou indisponible';
      this.emit();
    });
    this.emit();
  }

  /** Vrai si l'action notée sous ce nom (date ISO) n'a jamais eu lieu ou date de plus de `ms`. */
  private isDue(name: string, ms: number) {
    const last = this.read<string>(name);
    return !last || Date.now() - new Date(last).getTime() > ms;
  }

  private key(name: string) {
    return storageKey(this.userId, name);
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
    if (this.disposed) return;
    try {
      localStorage.setItem(this.key(name), JSON.stringify(value));
    } catch {
      this.error = 'Stockage local plein ou indisponible';
    }
  }
}

/** Supabase renvoie les colonnes « numeric » sous forme de texte. */
const num = (v: unknown) => (v == null ? null : Number(v));

/** Étape lue du cache ou du serveur, sans les anciennes colonnes `client` et `cmr_number` (remplacées par les LV). */
function normalizeEvent({
  client: _client,
  cmr_number: _cmr,
  ...e
}: TripEvent & { client?: unknown; cmr_number?: unknown }): TripEvent {
  return {
    ...e,
    diesel_l: num(e.diesel_l),
    adblue_l: num(e.adblue_l),
    full_tank: e.full_tank ?? null,
    finished_at: e.finished_at ?? null,
  };
}

function normalizeWaybill(w: Waybill): Waybill {
  return { ...w, weight_kg: num(w.weight_kg), photo_paths: w.photo_paths ?? [] };
}
