import { Camera, LoaderCircle, ScanSearch, ScanText, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toLocalInput } from '../lib/dates';
import { formatPlace, placeFromLabel, resolveCity } from '../lib/geo';
import { parseNum, numText } from '../lib/numbers';
import { FIELD_LABELS, applyReading, type ReadableFields } from '../lib/ocr';
import {
  compressPhoto,
  newPhotoPath,
  queuePhoto,
  readWaybillPhoto,
  trashPhotos,
  uploadPending,
  type LetterKind,
} from '../lib/photos';
import { placeChanged, type LinkedSteps, type NewLoading, type StepChanges } from '../lib/places';
import { useModal } from '../lib/useModal';
import { useStore } from '../lib/useEvents';
import type { Place, Waybill } from '../types';
import PhotoViewer, { PhotoThumb } from './PhotoViewer';
import PlaceField, { EMPTY_PLACE } from './PlaceField';

interface Props {
  waybill: Waybill;
  isNew: boolean;
  /** Ligne d'information sous le titre (ex. « Chargé à Cognac (16) le 12/10 »). */
  context?: string;
  /** Photo prise juste avant d'ouvrir la fiche (« Scanner une LV »). */
  initialPhoto?: Blob;
  /** Étapes de chargement et de livraison, modifiables depuis la fiche (absentes si la LV n'en a pas). */
  steps?: LinkedSteps;
  /** `changes` ne contient que ce qui a été modifié sur les étapes. */
  onSave: (waybill: Waybill, changes: StepChanges) => void;
  onDelete?: (waybill: Waybill) => void;
  onClose: () => void;
}

type Reading =
  { state: 'idle' } | { state: 'busy'; message: string } | { state: 'done' | 'error' | 'waiting'; message: string };

const clean = (s: string) => s.trim() || null;

const plannedText = (p: Place) => (p.country_code ? formatPlace(p) : p.city);

/** Date ISO → valeur d'un champ « date et heure » (vide si absente). */
const localTime = (iso: string | null | undefined) => (iso ? toLocalInput(new Date(iso)) : '');

/** Nouvelle date ISO si le champ a été changé et reste valide, sinon rien. */
function changedTime(value: string, iso: string | null | undefined): string | undefined {
  if (!iso || !value || value === localTime(iso)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export default function WaybillForm(props: Props) {
  const { waybill, isNew, context, initialPhoto, steps = {}, onSave, onDelete, onClose } = props;
  const store = useStore();
  const [names] = useState(() => store.knownNames());
  const [number, setNumber] = useState(waybill.number ?? '');
  const [shipper, setShipper] = useState(waybill.shipper ?? '');
  const [consignee, setConsignee] = useState(waybill.consignee ?? '');
  const [planned, setPlanned] = useState<Place>(() => placeFromLabel(waybill.planned_city ?? ''));
  const [plannedKey, setPlannedKey] = useState(0);
  // Sans étape de chargement (LV créée à la livraison) : ville et date à remplir pour la créer.
  const noLoading = !steps.loading;
  const [loading, setLoading] = useState<Place>(steps.loading?.place ?? EMPTY_PLACE);
  const [stepError, setStepError] = useState<string | null>(null);
  const [loadingWhen, setLoadingWhen] = useState(() => localTime(steps.loading?.at));
  const [deliveryWhen, setDeliveryWhen] = useState(() => localTime(steps.delivery?.at));
  const [goods, setGoods] = useState(waybill.goods ?? '');
  const [weight, setWeight] = useState(numText(waybill.weight_kg));
  const [notes, setNotes] = useState(waybill.notes ?? '');
  const [photos, setPhotos] = useState<string[]>(waybill.photo_paths);
  const [viewing, setViewing] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading>({ state: 'idle' });
  // Photos déjà lues pendant cette saisie : jamais de nouvelle lecture automatique.
  const [read, setRead] = useState<Set<string>>(() => new Set());
  // Photos déjà relues en mode fiable : une seule relecture par photo.
  const [reliable, setReliable] = useState<Set<string>>(() => new Set());
  // Valeurs posées par la dernière lecture : une relecture peut les remplacer, pas ce qui a été tapé.
  const fromReading = useRef<Partial<ReadableFields>>({});
  const camera = useRef<HTMLInputElement>(null);
  // Photos prises pendant cette saisie (envoyées au stockage pour la lecture, même si on les retire ensuite).
  const added = useRef<string[]>([]);

  // Valeurs à jour pour la lecture, qui se termine après quelques secondes de saisie possible.
  const latest = useRef<ReadableFields>(null!);
  latest.current = {
    number,
    shipper,
    consignee,
    planned_city: plannedText(planned),
    goods,
    weight_kg: weight,
  };

  /** Fermeture sans enregistrer : les photos prises pendant cette saisie ne servent à rien, elles sont effacées. */
  function discard() {
    trashPhotos(added.current);
    onClose();
  }

  useModal(discard);

  // « Scanner une LV » : la photo arrive avec la fiche (une seule fois, même en développement).
  const started = useRef(false);
  useEffect(() => {
    if (initialPhoto && !started.current) {
      started.current = true;
      void addPhoto(initialPhoto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addPhoto(file: Blob) {
    setReading({ state: 'busy', message: 'Préparation de la photo…' });
    let path: string;
    try {
      const blob = await compressPhoto(file);
      path = newPhotoPath(store.userId, waybill.id);
      await queuePhoto(path, blob);
      added.current.push(path);
      setPhotos((p) => [...p, path]);
    } catch {
      return setReading({ state: 'error', message: 'Photo illisible, réessaie.' });
    }
    await readPhoto(path);
  }

  /**
   * Une lecture économique, déclenchée une fois automatiquement à l'ajout, puis seulement à la demande ;
   * « Relire en mode fiable » relance la même photo avec le modèle le plus fiable.
   */
  async function readPhoto(path: string, mode: LetterKind = 'printed') {
    if (!navigator.onLine) {
      return setReading({ state: 'waiting', message: 'Photo enregistrée. Lecture possible au retour du réseau.' });
    }
    setRead((r) => new Set(r).add(path));
    if (mode === 'handwritten') setReliable((r) => new Set(r).add(path));
    try {
      setReading({ state: 'busy', message: 'Envoi de la photo…' });
      await uploadPending();
      setReading({
        state: 'busy',
        message: mode === 'handwritten' ? 'Relecture en mode fiable…' : 'Lecture de la lettre…',
      });
      const result = await readWaybillPhoto(path, mode);
      const { fields, filled } = applyReading(latest.current, result.reading, fromReading.current);
      if (filled.includes('planned_city')) {
        // Comme une ville choisie dans les suggestions : nom officiel, code postal, département.
        const { consignee_city, consignee_department } = result.reading;
        const place = consignee_city ? await resolveCity(consignee_city, consignee_department) : null;
        const resolved = place ?? placeFromLabel(fields.planned_city);
        setPlanned(resolved);
        setPlannedKey((k) => k + 1);
        fields.planned_city = plannedText(resolved);
      }
      setNumber(fields.number);
      setShipper(fields.shipper);
      setConsignee(fields.consignee);
      setGoods(fields.goods);
      setWeight(fields.weight_kg);
      for (const key of filled) fromReading.current[key] = fields[key];
      setReading({
        state: 'done',
        message: filled.length
          ? `Rempli d'après la photo : ${filled.map((k) => FIELD_LABELS[k]).join(', ')}. Vérifie avant de valider.`
          : 'Rien de nouveau lu sur la photo : les champs étaient déjà remplis ou illisibles.',
      });
    } catch (err) {
      setReading({ state: 'error', message: err instanceof Error ? err.message : 'Lecture impossible.' });
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation(); // ne pas valider le formulaire d'étape situé derrière
    const newLoading = noLoading ? loadingToCreate() : undefined;
    if (newLoading === null) return;
    // Photos déjà enregistrées puis retirées : effacées à l'enregistrement de la LV (voir EventStore) ;
    // photos prises puis retirées pendant cette saisie : effacées tout de suite.
    trashPhotos(added.current.filter((p) => !photos.includes(p)));
    onSave(
      {
        ...waybill,
        ...(newLoading && { loading_event_id: newLoading.id }),
        number: clean(number),
        shipper: clean(shipper),
        consignee: clean(consignee),
        // Ville choisie dans les suggestions : « Toulouse (31) » ; saisie libre : tel quel.
        planned_city: clean(plannedText(planned)),
        goods: clean(goods),
        weight_kg: parseNum(weight),
        notes: clean(notes),
        photo_paths: photos,
      },
      {
        loadingPlace: steps.loading && placeChanged(loading, steps.loading.place) ? loading : undefined,
        loadingAt: changedTime(loadingWhen, steps.loading?.at),
        deliveryAt: changedTime(deliveryWhen, steps.delivery?.at),
        newLoading,
      },
    );
    onClose();
  }

  /**
   * Chargement à créer d'après la ville et la date saisies : rien si les deux sont vides,
   * null (avec un message) s'il en manque une ou si la date tombe après la livraison.
   */
  function loadingToCreate(): NewLoading | undefined | null {
    setStepError(null);
    const city = loading.city.trim();
    if (!city && !loadingWhen) return undefined;
    if (!city || !loadingWhen) {
      setStepError(city ? 'Indique aussi la date de chargement.' : 'Indique aussi la ville de chargement.');
      return null;
    }
    const at = new Date(loadingWhen);
    if (Number.isNaN(at.getTime())) {
      setStepError('Date de chargement invalide.');
      return null;
    }
    if (deliveryWhen && at >= new Date(deliveryWhen)) {
      setStepError('Le chargement doit être avant la livraison.');
      return null;
    }
    return { id: crypto.randomUUID(), place: { ...loading, city }, at: at.toISOString() };
  }

  function remove() {
    if (onDelete && confirm('Supprimer cette lettre de voiture ?')) {
      onDelete(waybill);
      discard();
    }
  }

  /** Étiquette « LU » sur un champ encore tel que la lecture automatique l'a rempli. */
  const readTag = (key: keyof ReadableFields, value: string) =>
    value.trim() !== '' && fromReading.current[key] === value && <span className="read-tag">LU</span>;

  const last = photos[photos.length - 1];
  const canRead = last && reading.state !== 'busy' && !read.has(last);
  // Après une lecture économique (réussie ou non) : possibilité de relire avec le modèle le plus fiable.
  const canReread =
    last && (reading.state === 'done' || reading.state === 'error') && read.has(last) && !reliable.has(last);

  return (
    <>
      <div className="modal-backdrop stacked" onClick={discard}>
        <form className="modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
          <header className="modal-header">
            <button type="button" className="icon-btn" onClick={discard} aria-label="Fermer">
              <X size={22} />
            </button>
            <h2>{isNew ? 'Nouvelle lettre de voiture' : 'Lettre de voiture'}</h2>
            <button className="btn-primary btn-small">OK</button>
          </header>

          <div className="modal-body">
            {context && <p className="context-pill">{context}</p>}

            <div className="label">
              Photos
              <div className="photo-strip">
                {photos.map((path) => (
                  <PhotoThumb key={path} path={path} onOpen={() => setViewing(path)} />
                ))}
                <button
                  type="button"
                  className="photo-add"
                  onClick={() => camera.current?.click()}
                  disabled={reading.state === 'busy'}
                >
                  <Camera size={22} />
                  <span>{photos.length ? 'Ajouter' : 'Photo de la LV'}</span>
                </button>
                <input
                  ref={camera}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void addPhoto(file);
                  }}
                />
              </div>
              {reading.state !== 'idle' && (
                <p className={`reading reading-${reading.state}`}>
                  {reading.state === 'busy' && <LoaderCircle size={16} className="spin" />}
                  {reading.message}
                </p>
              )}
              {canRead && (
                <button type="button" className="btn-secondary btn-icon lv-add" onClick={() => void readPhoto(last)}>
                  <ScanText size={18} />
                  Lire la photo
                </button>
              )}
              {canReread && (
                <button
                  type="button"
                  className="btn-secondary btn-icon lv-add"
                  onClick={() => void readPhoto(last, 'handwritten')}
                >
                  <ScanSearch size={18} />
                  Relire en mode fiable (≈ 2 centimes)
                </button>
              )}
            </div>

            <datalist id="known-names">
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>

            {/* Fiche en blocs : côté chargeur, côté destinataire, puis numéro et marchandise. */}
            <div className="form-block">
              <label>
                <span className="label-line">Client chargeur (expéditeur){readTag('shipper', shipper)}</span>
                <input list="known-names" value={shipper} onChange={(e) => setShipper(e.target.value)} />
              </label>
              <div className="label">
                Ville de chargement
                <PlaceField value={loading} onChange={setLoading} />
              </div>
              {(steps.loading?.at || noLoading) && (
                <label>
                  Date et heure de chargement
                  <input type="datetime-local" value={loadingWhen} onChange={(e) => setLoadingWhen(e.target.value)} />
                </label>
              )}
              {noLoading && (
                <p className="hint">Ville et date remplies : l’étape de chargement est ajoutée à ce jour-là.</p>
              )}
              {stepError && <p className="form-message">{stepError}</p>}
            </div>

            <div className="form-block">
              <label>
                <span className="label-line">Client destinataire{readTag('consignee', consignee)}</span>
                <input list="known-names" value={consignee} onChange={(e) => setConsignee(e.target.value)} />
              </label>
              <div className="label">
                <span className="label-line">
                  Ville de livraison prévue{readTag('planned_city', plannedText(planned))}
                </span>
                <PlaceField key={plannedKey} value={planned} onChange={setPlanned} />
              </div>
              {steps.delivery?.at && (
                <label>
                  Date et heure de livraison
                  <input type="datetime-local" value={deliveryWhen} onChange={(e) => setDeliveryWhen(e.target.value)} />
                </label>
              )}
            </div>

            <div className="form-block">
              <label>
                <span className="label-line">N° lettre de voiture{readTag('number', number)}</span>
                <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="À compléter plus tard" />
              </label>
              <div className="row">
                <label>
                  <span className="label-line">Marchandise{readTag('goods', goods)}</span>
                  <input value={goods} onChange={(e) => setGoods(e.target.value)} placeholder="Palettes de plâtre…" />
                </label>
                <label>
                  <span className="label-line">Poids (kg){readTag('weight_kg', weight)}</span>
                  <input type="text" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
                </label>
              </div>
              <label>
                Remarque
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>

            <button className="btn-primary btn-block">OK</button>
            {onDelete && (
              <button type="button" className="btn-danger btn-block" onClick={remove}>
                Supprimer la lettre
              </button>
            )}
          </div>
        </form>
      </div>

      {viewing && (
        <PhotoViewer
          path={viewing}
          onDelete={() => setPhotos((p) => p.filter((x) => x !== viewing))}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}
