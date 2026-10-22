import { format, parseISO } from 'date-fns';
import { Camera, Check, ChevronDown, Pencil, ScanSearch, ScanText, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { toLocalInput } from '../lib/dates';
import { formatPlace, placeFromLabel, resolveCity } from '../lib/geo';
import { demoReading, finalProgress, liveProgress, liveSteps, type ReadDetails } from '../lib/liveReading';
import { parseNum, numText } from '../lib/numbers';
import { applyReading, readingSummary, uncertainFields, type ReadableFields } from '../lib/ocr';
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
import { useSheet } from '../lib/useSheet';
import { useStore } from '../lib/useEvents';
import { isBlankWaybill } from '../lib/waybills';
import type { Place, Waybill } from '../types';
import PhotoViewer, { PhotoThumb } from './PhotoViewer';
import PlaceField, { EMPTY_PLACE } from './PlaceField';
import ReadingDetails from './ReadingDetails';

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
  | { state: 'idle' }
  | { state: 'busy'; message: string; step: 0 | 1 | 2 }
  | { state: 'done' | 'error' | 'waiting'; message: string };

const clean = (s: string) => s.trim() || null;

const plannedText = (p: Place) => (p.country_code ? formatPlace(p) : p.city);

/** Date ISO → valeur d'un champ « date et heure » (vide si absente). */
const localTime = (iso: string | null | undefined) => (iso ? toLocalInput(new Date(iso)) : '');

/** Date d'une étape en lecture : « 16/10/2026 06:30 ». */
const shownTime = (iso: string | null | undefined) => (iso ? format(parseISO(iso), 'dd/MM/yyyy HH:mm') : '');

/** Nouvelle date ISO si le champ a été changé et reste valide, sinon rien. */
function changedTime(value: string, iso: string | null | undefined): string | undefined {
  if (!iso || !value || value === localTime(iso)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export default function WaybillForm(props: Props) {
  const { waybill, isNew, context, initialPhoto, steps = {}, onSave, onDelete, onClose } = props;
  const store = useStore();
  // Une LV déjà remplie s'ouvre en lecture seule (rien ne peut s'effacer par erreur) ; « Modifier » ouvre la saisie.
  // Nouvelle LV ou LV encore vide : saisie directe.
  const [blankAtOpen] = useState(() => isBlankWaybill(waybill));
  const [editing, setEditing] = useState(() => isNew || blankAtOpen);
  // Mode démo : lecture simulée, sans envoi de la photo ni appel au serveur.
  const { demo } = store.getState();
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
  // Dernière lecture, pour le panneau « Détails » (gardé tant que la fiche est ouverte).
  const [details, setDetails] = useState<ReadDetails | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  // Photos déjà lues pendant cette saisie : jamais de nouvelle lecture automatique.
  const [read, setRead] = useState<Set<string>>(() => new Set());
  // Photos déjà relues en mode fiable : une seule relecture par photo.
  const [reliable, setReliable] = useState<Set<string>>(() => new Set());
  // Valeurs posées par la dernière lecture : une relecture peut les remplacer, pas ce qui a été tapé.
  const fromReading = useRef<Partial<ReadableFields>>({});
  // Champs remplis par la lecture dont l'IA n'est pas sûre (étiquette « LU » orange).
  const doubtful = useRef(new Set<keyof ReadableFields>());
  const camera = useRef<HTMLInputElement>(null);

  // Marchandise : une ligne si c'est court, la zone grandit avec le texte (saisi ou lu sur la photo).
  const goodsField = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = goodsField.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [goods, editing]);
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

  // Croix, fond, retour arrière : fermeture animée sans enregistrer.
  const sheet = useSheet(discard);

  // « Scanner une LV » : la photo arrive avec la fiche (une seule fois, même en développement).
  const started = useRef(false);
  useEffect(() => {
    if (initialPhoto && !started.current) {
      started.current = true;
      void addPhoto(initialPhoto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Ajoute une photo. Seule la première est lue automatiquement : les suivantes (bons de livraison…) sont
   * seulement gardées, « Lire la photo » reste possible à la demande.
   */
  async function addPhoto(file: Blob) {
    const first = photos.length === 0;
    // Ligne de la lecture précédente, remise après l'ajout d'une photo qui n'est pas lue.
    const before = reading;
    setReading({ state: 'busy', message: 'Préparation de la photo…', step: 0 });
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
    if (first) await readPhoto(path);
    else setReading(before);
  }

  /**
   * Une lecture économique, déclenchée une fois automatiquement à l'ajout, puis seulement à la demande ;
   * « Relire en mode fiable » relance la même photo avec le modèle le plus fiable.
   */
  async function readPhoto(path: string, mode: LetterKind = 'printed') {
    if (!navigator.onLine && !demo) {
      return setReading({ state: 'waiting', message: 'Photo enregistrée. Lecture possible au retour du réseau.' });
    }
    setRead((r) => new Set(r).add(path));
    if (mode === 'handwritten') setReliable((r) => new Set(r).add(path));
    const startedAt = Date.now();
    setDetails({ mode, progress: { remarks: [], found: [] } });
    // Ligne en direct : la dernière remarque ou information écrite par l'IA.
    const onText = (text: string) => {
      const progress = liveProgress(text);
      const steps = liveSteps(progress);
      setDetails({ mode, progress });
      if (steps.length) setReading({ state: 'busy', message: steps[steps.length - 1], step: 2 });
    };
    try {
      setReading({ state: 'busy', message: 'Envoi de la photo…', step: 1 });
      if (!demo) await uploadPending(store.userId);
      setReading({
        state: 'busy',
        message: mode === 'handwritten' ? 'Relecture en mode fiable…' : 'L’IA regarde la photo…',
        step: 2,
      });
      const result = demo ? await demoReading(onText) : await readWaybillPhoto(path, mode, onText);
      setDetails({
        mode,
        progress: finalProgress(result.reading),
        done: { ms: Date.now() - startedAt, cost_usd: result.cost_usd },
      });
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
      const doubts = uncertainFields(result.reading);
      for (const key of filled) {
        fromReading.current[key] = fields[key];
        if (doubts.includes(key)) doubtful.current.add(key);
        else doubtful.current.delete(key);
      }
      setReading({
        state: 'done',
        message: readingSummary(fields, filled),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lecture impossible.';
      setDetails((d) => d && { ...d, done: { ms: Date.now() - startedAt, error: message } });
      setReading({ state: 'error', message: `Échec : ${message}` });
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
    sheet.closeThen(onClose);
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
      sheet.close();
    }
  }

  /** Étiquette « LU » sur un champ encore tel que la lecture automatique l'a rempli (orange si l'IA doute). */
  const readTag = (key: keyof ReadableFields, value: string) =>
    value.trim() !== '' &&
    fromReading.current[key] === value &&
    (doubtful.current.has(key) ? (
      <span className="read-tag read-tag-doubt" title="L’IA n’est pas sûre de cette lecture">
        LU
      </span>
    ) : (
      <span className="read-tag">LU</span>
    ));

  // LV vide à l'ouverture et encore sans photo : bouton « Scanner » à la place de la bande des photos.
  const scanFirst = blankAtOpen && photos.length === 0;
  const last = photos[photos.length - 1];
  const canRead = last && reading.state !== 'busy' && !read.has(last);
  // Après une lecture économique (réussie ou non) : possibilité de relire avec le modèle le plus fiable.
  const canReread =
    last && (reading.state === 'done' || reading.state === 'error') && read.has(last) && !reliable.has(last);

  return (
    <>
      <div className="modal-backdrop stacked" ref={sheet.ref} onClick={sheet.close}>
        <form className="modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
          <header className="modal-header" {...sheet.handle}>
            <button type="button" className="icon-btn" onClick={sheet.close} aria-label="Fermer">
              <X size={22} />
            </button>
            <h2>{isNew ? 'Nouvelle lettre de voiture' : 'Lettre de voiture'}</h2>
            {editing ? (
              <button key="ok" className="btn-primary btn-small">
                OK
              </button>
            ) : (
              // Passe la fiche en saisie. Clé différente de « OK » : React ne réutilise pas ce bouton en le
              // changeant en bouton d'envoi pendant le toucher (le formulaire partirait et la fiche se fermerait).
              <button
                key="edit"
                type="button"
                className="btn-primary btn-small btn-icon"
                onClick={() => setEditing(true)}
              >
                <Pencil size={16} aria-hidden />
                Modifier
              </button>
            )}
          </header>

          {!editing && (
            <div className="modal-body">
              {context && <p className="context-pill">{context}</p>}
              {photos.length > 0 && (
                <div className="label">
                  Photos
                  <div className="photo-strip">
                    {photos.map((path) => (
                      <PhotoThumb key={path} path={path} onOpen={() => setViewing(path)} />
                    ))}
                  </div>
                </div>
              )}
              <Fields
                tone="chargement"
                rows={[
                  ['Client chargeur (expéditeur)', shipper],
                  ['Ville de chargement', steps.loading ? formatPlace(steps.loading.place) : ''],
                  ['Date et heure de chargement', shownTime(steps.loading?.at)],
                ]}
              />
              <Fields
                tone="livraison"
                rows={[
                  ['Client destinataire', consignee],
                  ['Ville de livraison prévue', plannedText(planned)],
                  ['Date et heure de livraison', shownTime(steps.delivery?.at)],
                ]}
              />
              <Fields
                rows={[
                  ['N° lettre de voiture', number || 'À compléter'],
                  ['Marchandise', goods],
                  ['Poids', weight && `${weight} kg`],
                  ['Remarques', notes],
                ]}
              />
            </div>
          )}

          <div className="modal-body" hidden={!editing}>
            {context && <p className="context-pill">{context}</p>}

            <div className="label">
              {scanFirst ? (
                // LV vide sans photo : un seul gros bouton pour la photographier (lue ensuite automatiquement).
                <button
                  type="button"
                  className="btn-primary btn-icon lv-add"
                  onClick={() => camera.current?.click()}
                  disabled={reading.state === 'busy'}
                >
                  <Camera size={18} />
                  Scanner la lettre de voiture
                </button>
              ) : (
                <>
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
                  </div>
                </>
              )}
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
              {reading.state === 'busy' && (
                <ol className="reading-steps" aria-live="polite">
                  {[
                    'Préparation de la photo',
                    'Envoi de la photo',
                    details?.mode === 'handwritten' ? 'Relecture en mode fiable' : 'L’IA regarde la photo',
                  ].map((label, i) => (
                    <li key={label} className={i < reading.step ? 'done' : i === reading.step ? 'current' : ''}>
                      <span className="reading-step-mark" aria-hidden>
                        {i < reading.step && <Check size={16} strokeWidth={3} />}
                      </span>
                      {label}
                    </li>
                  ))}
                  {/* Pendant la lecture : la dernière remarque ou information écrite par l'IA. */}
                  {reading.step === 2 && !reading.message.endsWith('…') && (
                    <li className="reading-live">{reading.message}</li>
                  )}
                </ol>
              )}
              {reading.state !== 'idle' && reading.state !== 'busy' && (
                <div className={`reading reading-${reading.state}`}>
                  <span className="reading-text">{reading.message}</span>
                  {details && (
                    <button
                      type="button"
                      className="reading-more"
                      aria-expanded={showDetails}
                      onClick={() => setShowDetails((v) => !v)}
                    >
                      Détails
                      <ChevronDown size={14} />
                    </button>
                  )}
                </div>
              )}
              {details && showDetails && <ReadingDetails details={details} />}
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

            {/* Fiche en blocs : côté chargeur (bleu), côté destinataire (vert), puis numéro et marchandise. */}
            <div className="form-block tone-chargement">
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

            <div className="form-block tone-livraison">
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
              <label>
                <span className="label-line">Marchandise{readTag('goods', goods)}</span>
                <textarea
                  ref={goodsField}
                  className="auto-grow"
                  rows={1}
                  value={goods}
                  onChange={(e) => setGoods(e.target.value)}
                  placeholder="Palettes de plâtre…"
                />
              </label>
              <div className="row">
                <label>
                  <span className="label-line">Poids (kg){readTag('weight_kg', weight)}</span>
                  <input type="text" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
                </label>
                <label>
                  Remarques
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
              </div>
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
          // En lecture seule, la photo se regarde sans pouvoir être supprimée.
          onDelete={editing ? () => setPhotos((p) => p.filter((x) => x !== viewing)) : undefined}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

/** Informations de la LV en lecture seule ; une ligne vide n'est pas affichée, ni un bloc tout vide. */
function Fields({ rows, tone }: { rows: [string, string][]; tone?: 'chargement' | 'livraison' }) {
  const shown = rows.filter(([, value]) => value.trim());
  if (!shown.length) return null;
  return (
    <dl className={`form-block lv-fields${tone ? ` tone-${tone}` : ''}`}>
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
