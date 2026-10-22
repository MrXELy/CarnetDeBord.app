import { parseISO } from 'date-fns';
import { AlarmClock, Camera, Eye, LoaderCircle, Pencil, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { durationLabel, toLocalInput } from '../lib/dates';
import { isDoumenCity, isFullTank } from '../lib/fuel';
import { formatPlace } from '../lib/geo';
import { numText, parseNum } from '../lib/numbers';
import { hasEnd, suggestedType } from '../lib/onSite';
import { odometerMessage, readOdometerPhoto } from '../lib/odometer';
import { restartAdvice, restChecks } from '../lib/rest';
import {
  addLoadingStep,
  applyStepChanges,
  locateLater,
  placeOf,
  type LinkedSteps,
  type NewLoading,
  type StepChanges,
} from '../lib/places';
import { useSheet } from '../lib/useSheet';
import { useEvents } from '../lib/useEvents';
import { isBlankWaybill, stopOf, waybillContext } from '../lib/waybills';
import {
  EVENT_TYPES,
  STATIONS,
  newWaybill,
  type EventType,
  type Place,
  type Station,
  type TripEvent,
  type Waybill,
} from '../types';
import EventIcon from './EventIcon';
import PlaceField, { EMPTY_PLACE } from './PlaceField';
import RestNotice from './RestNotice';
import WaybillForm from './WaybillForm';
import WaybillLine from './WaybillLine';

interface Props {
  event: TripEvent | null;
  onClose: () => void;
}

type KmReading = { state: 'busy' | 'done' | 'error'; message: string } | null;

type Editing = { waybill: Waybill; isNew: boolean; side: 'load' | 'delivery'; photo?: Blob } | null;

/** Champs d'une LV qui comptent pour savoir si elle a changé (on ignore les dates de suivi). */
const sameWaybill = (a: Waybill, b: Waybill | undefined) =>
  !!b && JSON.stringify({ ...a, updated_at: '' }) === JSON.stringify({ ...b, updated_at: '' });

export default function EventForm({ event, onClose }: Props) {
  const { store, demo, events } = useEvents();
  const isNew = !event;
  const [eventId] = useState(() => event?.id ?? crypto.randomUUID());
  const [plates] = useState(() => store.lastPlates());

  const [type, setType] = useState<EventType | null>(event?.type ?? null);
  const [tractor, setTractor] = useState(event?.tractor_plate ?? plates.tractor);
  const [trailer, setTrailer] = useState(event?.trailer_plate ?? plates.trailer);
  // Plaques repliées sur une ligne (elles changent rarement), ouvertes d'office si le tracteur est inconnu.
  const [editPlates, setEditPlates] = useState(() => !(event?.tractor_plate ?? plates.tractor));
  const [km, setKm] = useState(event?.odometer_km?.toString() ?? '');
  const [place, setPlace] = useState<Place>(event ?? EMPTY_PLACE);
  const [when, setWhen] = useState(toLocalInput(event ? parseISO(event.occurred_at) : new Date()));
  const [finished, setFinished] = useState(event?.finished_at ? toLocalInput(parseISO(event.finished_at)) : '');
  const [station, setStation] = useState<Station | null>(event?.station ?? null);
  const [diesel, setDiesel] = useState(numText(event?.diesel_l ?? null));
  const [adblue, setAdblue] = useState(numText(event?.adblue_l ?? null));
  const [fullTank, setFullTank] = useState(event ? isFullTank(event) : false);
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  // Change quand le lieu est prérempli, pour réafficher le champ avec la nouvelle valeur.
  const [placeKey, setPlaceKey] = useState(0);
  const [placeFromDayEnd, setPlaceFromDayEnd] = useState(false);

  // Lettres de voiture : tout reste en brouillon jusqu'à « Enregistrer ».
  const [originalLoads] = useState(() => (event ? store.loadedAt(event.id) : []));
  const [originalDelivered] = useState(() => (event ? store.deliveredAt(event.id) : []));
  const [loads, setLoads] = useState<Waybill[]>(originalLoads);
  const [checked, setChecked] = useState(() => new Set(originalDelivered.map((w) => w.id)));
  const [deliveryEdits, setDeliveryEdits] = useState<Map<string, Waybill>>(() => new Map());
  // Chargements à créer pour des LV qui n'en avaient pas, par LV (enregistrés avec la livraison).
  const [newLoadings, setNewLoadings] = useState<Map<string, NewLoading>>(() => new Map());
  const [editing, setEditing] = useState<Editing>(null);
  const scanInput = useRef<HTMLInputElement>(null);
  const kmCamera = useRef<HTMLInputElement>(null);
  const [kmReading, setKmReading] = useState<KmReading>(null);

  const sheet = useSheet(onClose);

  // Date vide ou incomplète (champ effacé) : null, pour ne pas planter les calculs qui suivent.
  const at = new Date(when);
  const whenIso = Number.isNaN(at.getTime()) ? null : at.toISOString();
  const lastKm = whenIso ? store.lastOdometer(tractor.trim(), at, event?.id) : null;
  const kmValue = parseNum(km);
  const isFuel = type === 'carburant';
  // Fin d'un chargement ou d'une livraison : facultative. Pas encore saisie : le champ montre l'heure d'arrivée,
  // mais rien n'est enregistré (le bouton « Fin » de l'accueil reste proposé).
  const withEnd = type != null && hasEnd(type);
  const end = new Date(finished);
  const finishedIso = withEnd && finished && !Number.isNaN(end.getTime()) ? end.toISOString() : null;
  const onSite = finishedIso && whenIso ? Math.round((end.getTime() - at.getTime()) / 60000) : null;

  // LV livrables ici : celles du camion à cette heure, celles déjà livrées ici, et celles créées ici.
  const pool = new Map<string, Waybill>();
  for (const w of [...store.inTruck(Number.isNaN(at.getTime()) ? new Date() : at), ...originalDelivered]) {
    pool.set(w.id, w);
  }
  deliveryEdits.forEach((w, id) => pool.set(id, w));
  const deliveryPool = [...pool.values()];

  // Repos (RSE), recalculé quand l'heure ou le lieu change : au début de journée, celui depuis la fin de journée
  // d'avant ; à la fin de journée, l'heure de reprise possible.
  const restCheck = useMemo(() => {
    if (!whenIso || (type !== 'debut_journee' && type !== 'fin_journee')) return null;
    const draft = { id: eventId, type, occurred_at: whenIso, country_code: place.country_code };
    if (type === 'fin_journee') return restartAdvice(events, draft);
    return restChecks([...events.filter((e) => e.id !== eventId), draft]).get(eventId) ?? null;
  }, [events, type, whenIso, eventId, place.country_code]);
  const candidates = deliveryPool.filter((w) => !w.deleted_at);

  function waybillChanges(now: string): Waybill[] {
    const changes: Waybill[] = [];
    if (type === 'chargement') {
      for (const w of originalLoads) {
        if (!loads.some((l) => l.id === w.id)) changes.push({ ...w, deleted_at: now });
      }
      for (const w of loads) changes.push({ ...w, loading_event_id: eventId });
    } else {
      // L'étape n'est plus un chargement : ses LV gardent leur trace mais sans lieu de chargement.
      for (const w of originalLoads) changes.push({ ...w, loading_event_id: null });
    }

    if (type === 'livraison') {
      for (const w of deliveryPool) {
        if (w.deleted_at) changes.push(w);
        else if (checked.has(w.id)) changes.push({ ...w, delivery_event_id: eventId });
        else if (w.delivery_event_id === eventId) changes.push({ ...w, delivery_event_id: null });
        else if (deliveryEdits.has(w.id)) changes.push(w);
      }
    } else {
      for (const w of originalDelivered) changes.push({ ...w, delivery_event_id: null });
    }

    // N'envoie que ce qui a réellement changé.
    return changes.filter((w) => !sameWaybill(w, store.waybill(w.id)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!type) return setError('Choisis le type d’opération.');
    if (!whenIso) return setError('Indique la date et l’heure.');
    if (kmValue == null) return setError('Indique le kilométrage.');
    if (!place.city.trim()) return setError('Indique le lieu.');
    if (isFuel && !station) return setError('Choisis la station.');
    if (onSite != null && onSite < 0) return setError('La fin est avant l’arrivée.');

    const now = new Date().toISOString();
    const changes = waybillChanges(now);
    // Chargements créés depuis les fiches LV : avant les LV qui y font référence.
    for (const [id, step] of newLoadings) {
      if (changes.some((w) => w.id === id && !w.deleted_at && w.loading_event_id === step.id)) {
        addLoadingStep(store, step, { tractor: tractor.trim(), trailer: trailer.trim() });
      }
    }

    store.save(
      {
        ...place,
        id: eventId,
        type,
        occurred_at: whenIso,
        tractor_plate: tractor.trim(),
        trailer_plate: trailer.trim(),
        odometer_km: kmValue,
        city: place.city.trim(),
        notes: notes.trim() || null,
        station: isFuel ? station : null,
        diesel_l: isFuel ? parseNum(diesel) : null,
        adblue_l: isFuel ? parseNum(adblue) : null,
        full_tank: isFuel ? fullTank : null,
        finished_at: finishedIso,
        updated_at: '',
        deleted_at: null,
      },
      changes,
    );
    locateLater(store, eventId, place);
    sheet.close();
  }

  /** Lit le kilométrage sur une photo du chrono ou du compteur, puis remplit le champ (à vérifier). */
  async function readKm(file: File) {
    if (demo) return setKmReading({ state: 'error', message: 'Lecture indisponible en mode démo.' });
    if (!navigator.onLine) {
      return setKmReading({ state: 'error', message: 'Pas de réseau : saisis le kilométrage à la main.' });
    }
    setKmReading({ state: 'busy', message: 'Lecture du kilométrage…' });
    try {
      const read = await readOdometerPhoto(file);
      if (read == null) {
        return setKmReading({
          state: 'error',
          message: 'Kilométrage illisible : reprends la photo de plus près, ou saisis-le.',
        });
      }
      setKm(String(read));
      const { text, suspect } = odometerMessage(read, lastKm);
      setKmReading({ state: suspect ? 'error' : 'done', message: text });
    } catch (err) {
      setKmReading({ state: 'error', message: err instanceof Error ? err.message : 'Lecture impossible' });
    }
  }

  /** Toujours le plein chez Doumen ; ailleurs (AS24, DKV), des compléments. Modifiable ensuite. */
  function chooseStation(value: Station) {
    setStation(value);
    setFullTank(value === 'Doumen');
  }

  // Plein dans une ville de station Doumen : Doumen choisi d'office, si aucune station ne l'est encore.
  useEffect(() => {
    if (isFuel && !station && isDoumenCity(place.city)) chooseStation('Doumen');
  }, [isFuel, station, place.city]);

  // Nouvelle étape : type le plus probable déjà choisi (modifiable), avec les mêmes préremplissages qu'au toucher.
  useEffect(() => {
    if (!isNew) return;
    const now = new Date();
    chooseType(suggestedType(events, now, store.inTruck(now).length > 0)); // une seule fois, à l’ouverture
  }, []);

  /**
   * Un chargement saisi reçoit d'office une LV vide, à compléter plus tard.
   * Un début de journée repart de la dernière fin de journée : le camion n'a normalement pas bougé.
   */
  function chooseType(value: EventType) {
    setType(value);
    if (isNew && value === 'chargement' && loads.length === 0) setLoads([newWaybill()]);
    if (!isNew || value !== 'debut_journee') return;
    const end = whenIso ? store.lastDayEnd(at) : null;
    if (!end) return;
    setTractor(end.tractor_plate);
    setTrailer(end.trailer_plate);
    if (end.odometer_km != null) setKm(String(end.odometer_km));
    if (end.city) {
      setPlace({
        city: end.city,
        postcode: end.postcode,
        department: end.department,
        country_code: end.country_code,
        lat: end.lat,
        lon: end.lon,
      });
      setPlaceKey((k) => k + 1);
      setPlaceFromDayEnd(true);
    }
  }

  /** LV à ouvrir pour « Scanner » ou « Saisir » : la LV vide du chargement s'il y en a une, sinon une nouvelle. */
  function editLoad(photo?: Blob) {
    const blank = loads.find(isBlankWaybill);
    const shipper = loads.find((l) => l.shipper)?.shipper ?? null;
    setEditing(
      blank
        ? { waybill: { ...blank, shipper }, isNew: false, side: 'load', photo }
        : { waybill: newWaybill({ shipper }), isNew: true, side: 'load', photo },
    );
  }

  /**
   * Étapes de la LV ouverte, modifiables depuis sa fiche. L'étape en cours de saisie (ce chargement,
   * ou cette livraison si la LV y est cochée) change dans le formulaire ; les autres sont enregistrées tout de suite.
   */
  function editingSteps(): { steps: LinkedSteps; apply: (changes: StepChanges) => void } | undefined {
    if (!editing) return;
    const w = editing.waybill;
    const setFormTime = (iso: string) => setWhen(toLocalInput(new Date(iso)));
    if (editing.side === 'load') {
      const delivery = store.event(w.delivery_event_id);
      return {
        steps: { loading: { place, at: whenIso }, delivery: delivery ? { at: delivery.occurred_at } : undefined },
        apply: (changes) => {
          if (changes.loadingPlace) {
            setPlace(changes.loadingPlace);
            setPlaceKey((k) => k + 1);
            setPlaceFromDayEnd(false);
          }
          if (changes.loadingAt) setFormTime(changes.loadingAt);
          applyStepChanges(store, null, delivery?.id, changes);
        },
      };
    }
    const loading = store.event(w.loading_event_id);
    // Chargement pas encore enregistré, demandé depuis cette fiche lors d'une ouverture précédente.
    const pending = newLoadings.get(w.id);
    return {
      steps: {
        loading: loading
          ? { place: placeOf(loading), at: loading.occurred_at }
          : pending
            ? { place: pending.place, at: pending.at }
            : undefined,
        // Une nouvelle LV saisie ici est livrée ici.
        delivery: checked.has(w.id) || editing.isNew ? { at: whenIso } : undefined,
      },
      apply: (changes) => {
        if (pending) {
          setNewLoadings(
            new Map(newLoadings).set(w.id, {
              ...pending,
              place: changes.loadingPlace ?? pending.place,
              at: changes.loadingAt ?? pending.at,
            }),
          );
        } else if (changes.newLoading) {
          setNewLoadings(new Map(newLoadings).set(w.id, changes.newLoading));
        } else {
          applyStepChanges(store, loading?.id, null, changes);
        }
        if (changes.deliveryAt) setFormTime(changes.deliveryAt);
      },
    };
  }

  function remove() {
    if (!event) return;
    const n = originalLoads.length;
    const message =
      event.type === 'chargement' && n > 0
        ? `Supprimer ce chargement et ${n > 1 ? `ses ${n} lettres de voiture` : 'sa lettre de voiture'} ?`
        : 'Supprimer cette étape ?';
    if (confirm(message)) {
      store.remove(event);
      sheet.close();
    }
  }

  function toggle(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  }

  function saveEditing(w: Waybill) {
    if (!editing) return;
    if (editing.side === 'load') {
      setLoads(editing.isNew ? [...loads, w] : loads.map((l) => (l.id === w.id ? w : l)));
    } else {
      setDeliveryEdits(new Map(deliveryEdits).set(w.id, w));
      if (editing.isNew) setChecked(new Set(checked).add(w.id));
    }
  }

  function deleteEditing(w: Waybill) {
    if (!editing) return;
    if (editing.side === 'load') setLoads(loads.filter((l) => l.id !== w.id));
    else setDeliveryEdits(new Map(deliveryEdits).set(w.id, { ...w, deleted_at: new Date().toISOString() }));
  }

  // Bouton d'une LV dans la liste : une LV encore vide s'ouvre en saisie (crayon), une LV remplie en lecture (œil).
  const openLabel = (w: Waybill) => {
    const label = isBlankWaybill(w) ? 'Remplir la lettre' : 'Voir la lettre';
    return { 'aria-label': label, title: label };
  };

  // Pastille de la fiche LV : chargement et livraison, celui de cette fiche pris tel qu'il est saisi.
  function editingContext(): string | undefined {
    if (!editing) return;
    const w = editing.waybill;
    const here = { place, at: whenIso };
    if (editing.side === 'load') return waybillContext(here, stopOf(store.event(w.delivery_event_id)));
    const pending = newLoadings.get(w.id);
    const loading = pending ? { place: pending.place, at: pending.at } : stopOf(store.event(w.loading_event_id));
    // Cochée (ou saisie ici) : livrée à cette étape ; décochée : pas livrée ici, peut-être ailleurs.
    const delivery =
      checked.has(w.id) || editing.isNew
        ? here
        : w.delivery_event_id !== event?.id
          ? stopOf(store.event(w.delivery_event_id))
          : null;
    return waybillContext(loading, delivery);
  }

  return (
    <>
      <div className="modal-backdrop" ref={sheet.ref} onClick={sheet.close}>
        <form className="modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
          <header className="modal-header" {...sheet.handle}>
            <button type="button" className="icon-btn" onClick={sheet.close} aria-label="Fermer">
              <X size={22} />
            </button>
            <h2>{isNew ? 'Nouvelle étape' : 'Modifier l’étape'}</h2>
            <button className="btn-primary btn-small">Enregistrer</button>
          </header>

          <div className="modal-body">
            <fieldset>
              <legend>Type d’opération</legend>
              <div className="type-grid">
                {EVENT_TYPES.map((t) => (
                  <button
                    type="button"
                    key={t.value}
                    className={`type-btn tone-${t.value}${type === t.value ? ' selected' : ''}`}
                    onClick={() => chooseType(t.value)}
                    title={t.label}
                  >
                    <EventIcon type={t.value} className="event-icon" />
                    {t.short}
                  </button>
                ))}
              </div>
            </fieldset>

            {!editPlates ? (
              <div className="label">
                Camion
                <button type="button" className="plates-summary" onClick={() => setEditPlates(true)}>
                  <span className="plate">{tractor}</span>
                  {trailer && <span className="plate">{trailer}</span>}
                  <Pencil size={16} aria-hidden />
                  <span className="sr-only">Modifier les immatriculations</span>
                </button>
              </div>
            ) : (
              <div className="row">
                <label>
                  Tracteur
                  <input
                    className="plate"
                    value={tractor}
                    onChange={(e) => setTractor(e.target.value.toUpperCase())}
                    placeholder="AB-123-CD"
                  />
                </label>
                <label>
                  Remorque
                  <input
                    className="plate"
                    value={trailer}
                    onChange={(e) => setTrailer(e.target.value.toUpperCase())}
                    placeholder="EF-456-GH"
                  />
                </label>
              </div>
            )}

            <label>
              Kilométrage
              <div className="input-with-btn">
                <input
                  type="text"
                  inputMode="numeric"
                  value={km}
                  onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))}
                  placeholder="km au compteur"
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => kmCamera.current?.click()}
                  disabled={kmReading?.state === 'busy'}
                  title="Lire le km sur une photo"
                >
                  {kmReading?.state === 'busy' ? <LoaderCircle size={20} className="spin" /> : <Camera size={20} />}
                  <span className="sr-only">Lire le km sur une photo</span>
                </button>
                <input
                  ref={kmCamera}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void readKm(file);
                  }}
                />
              </div>
              {kmReading && (
                <span className={`reading reading-${kmReading.state}`}>
                  {kmReading.state === 'busy' && <LoaderCircle size={16} className="spin" />}
                  {kmReading.message}
                </span>
              )}
              {lastKm != null && (
                <span className="hint">
                  Dernier relevé : {lastKm.toLocaleString('fr-FR')} km
                  {kmValue != null && kmValue < lastKm && (
                    <strong className="hint-err"> · inférieur au précédent</strong>
                  )}
                </span>
              )}
            </label>

            <div className="label">
              Lieu
              <PlaceField key={placeKey} value={place} onChange={setPlace} autoLocate={isNew && placeKey === 0} />
              {placeFromDayEnd && <span className="hint">Repris de la dernière fin de journée</span>}
            </div>

            <label>
              {withEnd ? 'Arrivée' : 'Date et heure'}
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
            </label>
            {withEnd && (
              <label>
                {type === 'chargement' ? 'Fin du chargement' : 'Fin de la livraison'}
                <input type="datetime-local" value={finished || when} onChange={(e) => setFinished(e.target.value)} />
                <span className="hint">
                  {!onSite
                    ? 'Facultatif : le bouton « Fin » de l’accueil la remplit.'
                    : onSite < 0
                      ? 'Avant l’arrivée'
                      : `${durationLabel(onSite)} sur place`}
                </span>
              </label>
            )}
            {restCheck && <RestNotice check={restCheck} icon={type === 'fin_journee' ? AlarmClock : undefined} />}

            {type === 'chargement' && (
              <div className="label">
                Lettres de voiture
                {loads.length > 0 && (
                  <div className="lv-list">
                    {loads.map((w) => (
                      <WaybillLine
                        key={w.id}
                        waybill={w}
                        loading={{ place: formatPlace(place), at: whenIso }}
                        onClick={() => setEditing({ waybill: w, isNew: false, side: 'load' })}
                        trailing={
                          <button
                            type="button"
                            className="icon-btn"
                            {...openLabel(w)}
                            onClick={() => setEditing({ waybill: w, isNew: false, side: 'load' })}
                          >
                            {isBlankWaybill(w) ? <Pencil size={16} /> : <Eye size={16} />}
                          </button>
                        }
                      />
                    ))}
                  </div>
                )}
                <div className="lv-actions">
                  <button
                    type="button"
                    className="btn-primary btn-icon lv-add"
                    onClick={() => scanInput.current?.click()}
                  >
                    <Camera size={18} />
                    Scanner une LV
                  </button>
                  <button type="button" className="btn-secondary btn-icon lv-add" onClick={() => editLoad()}>
                    <Plus size={18} />
                    Saisir
                  </button>
                </div>
                <input
                  ref={scanInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) editLoad(file);
                  }}
                />
                <span className="hint">Le numéro peut être complété plus tard.</span>
              </div>
            )}

            {type === 'livraison' && (
              <div className="label">
                Lettres de voiture livrées
                {candidates.length === 0 ? (
                  <span className="hint">Aucune lettre de voiture dans le camion.</span>
                ) : (
                  <div className="lv-list">
                    {candidates.map((w) => (
                      <WaybillLine
                        key={w.id}
                        waybill={w}
                        selected={checked.has(w.id)}
                        onClick={() => toggle(w.id)}
                        leading={
                          <input
                            type="checkbox"
                            className="lv-check"
                            checked={checked.has(w.id)}
                            onChange={() => toggle(w.id)}
                            aria-label={`Livrée : ${w.consignee ?? w.number ?? 'lettre'}`}
                          />
                        }
                        trailing={
                          <button
                            type="button"
                            className="icon-btn"
                            {...openLabel(w)}
                            onClick={() => setEditing({ waybill: w, isNew: false, side: 'delivery' })}
                          >
                            {isBlankWaybill(w) ? <Pencil size={16} /> : <Eye size={16} />}
                          </button>
                        }
                      />
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="btn-secondary btn-icon lv-add"
                  onClick={() => setEditing({ waybill: newWaybill(), isNew: true, side: 'delivery' })}
                >
                  <Plus size={18} />
                  Nouvelle lettre de voiture
                </button>
              </div>
            )}

            {isFuel && (
              <>
                <fieldset>
                  <legend>Station</legend>
                  <div className="segmented">
                    {STATIONS.map((s) => (
                      <button
                        type="button"
                        key={s}
                        className={station === s ? 'selected' : ''}
                        onClick={() => chooseStation(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="setting-row">
                  <span className="setting-text">
                    <span className="setting-title">Plein complet</span>
                    <span className="hint">
                      {fullTank ? 'Réservoir rempli : sert au calcul de la consommation.' : 'Simple complément.'}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="switch"
                    checked={fullTank}
                    onChange={(e) => setFullTank(e.target.checked)}
                  />
                </label>
                <div className="row">
                  <label>
                    Gasoil (L)
                    <input type="text" inputMode="decimal" value={diesel} onChange={(e) => setDiesel(e.target.value)} />
                  </label>
                  <label>
                    AdBlue (L)
                    <input type="text" inputMode="decimal" value={adblue} onChange={(e) => setAdblue(e.target.value)} />
                  </label>
                </div>
              </>
            )}

            <label>
              Remarques
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>

            {error && <p className="form-message">{error}</p>}

            <button className="btn-primary btn-block">Enregistrer</button>
            {!isNew && (
              <button type="button" className="btn-danger btn-block" onClick={remove}>
                Supprimer
              </button>
            )}
          </div>
        </form>
      </div>

      {editing && (
        <WaybillForm
          waybill={editing.waybill}
          isNew={editing.isNew}
          initialPhoto={editing.photo}
          context={editingContext()}
          steps={editingSteps()?.steps}
          onSave={(w, changes) => {
            saveEditing(w);
            editingSteps()?.apply(changes);
          }}
          onDelete={editing.isNew ? undefined : deleteEditing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
