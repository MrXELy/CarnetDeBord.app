import { parseISO } from 'date-fns';
import { useEffect, useState, type FormEvent } from 'react';
import { toLocalInput } from '../lib/dates';
import { useStore } from '../lib/useEvents';
import { EVENT_TYPES, STATIONS, type EventType, type Place, type Station, type TripEvent } from '../types';
import PlaceField, { EMPTY_PLACE } from './PlaceField';

interface Props {
  event: TripEvent | null;
  onClose: () => void;
}

const numText = (n: number | null) => (n == null ? '' : String(n).replace('.', ','));
const parseNum = (s: string) => {
  const n = Number(s.replace(',', '.').replace(/\s/g, ''));
  return s.trim() === '' || Number.isNaN(n) ? null : n;
};

export default function EventForm({ event, onClose }: Props) {
  const store = useStore();
  const isNew = !event;
  const [plates] = useState(() => store.lastPlates());

  const [type, setType] = useState<EventType | null>(event?.type ?? null);
  const [tractor, setTractor] = useState(event?.tractor_plate ?? plates.tractor);
  const [trailer, setTrailer] = useState(event?.trailer_plate ?? plates.trailer);
  const [km, setKm] = useState(event?.odometer_km?.toString() ?? '');
  const [place, setPlace] = useState<Place>(event ?? EMPTY_PLACE);
  const [when, setWhen] = useState(toLocalInput(event ? parseISO(event.occurred_at) : new Date()));
  const [client, setClient] = useState(event?.client ?? '');
  const [cmr, setCmr] = useState(event?.cmr_number ?? '');
  const [station, setStation] = useState<Station | null>(event?.station ?? null);
  const [diesel, setDiesel] = useState(numText(event?.diesel_l ?? null));
  const [adblue, setAdblue] = useState(numText(event?.adblue_l ?? null));
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const lastKm = store.lastOdometer(tractor.trim(), event?.id);
  const kmValue = parseNum(km);
  const isStop = type === 'chargement' || type === 'livraison';
  const isFuel = type === 'carburant';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.body.classList.add('no-scroll');
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('no-scroll');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!type) return setError('Choisis le type d’opération.');
    if (kmValue == null) return setError('Indique le kilométrage.');
    if (!place.city.trim()) return setError('Indique le lieu.');
    if (isFuel && !station) return setError('Choisis la station.');

    store.save({
      ...place,
      id: event?.id ?? crypto.randomUUID(),
      type,
      occurred_at: new Date(when).toISOString(),
      tractor_plate: tractor.trim(),
      trailer_plate: trailer.trim(),
      odometer_km: kmValue,
      city: place.city.trim(),
      notes: notes.trim() || null,
      client: isStop ? client.trim() || null : null,
      cmr_number: isStop ? cmr.trim() || null : null,
      station: isFuel ? station : null,
      diesel_l: isFuel ? parseNum(diesel) : null,
      adblue_l: isFuel ? parseNum(adblue) : null,
      updated_at: '',
      deleted_at: null,
    });
    onClose();
  }

  function remove() {
    if (event && confirm('Supprimer cette étape ?')) {
      store.remove(event);
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
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
                  onClick={() => setType(t.value)}
                >
                  <span aria-hidden>{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>

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

          <label>
            Kilométrage
            <input
              type="text"
              inputMode="numeric"
              value={km}
              onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))}
              placeholder="km au compteur"
            />
            {lastKm != null && (
              <span className="hint">
                Dernier relevé : {lastKm.toLocaleString('fr-FR')} km
                {kmValue != null && kmValue < lastKm && <strong className="hint-err"> · inférieur au précédent</strong>}
              </span>
            )}
          </label>

          <div className="label">
            Lieu
            <PlaceField value={place} onChange={setPlace} autoLocate={isNew} />
          </div>

          <label>
            Date et heure
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          </label>

          {isStop && (
            <div className="row">
              <label>
                Client
                <input value={client} onChange={(e) => setClient(e.target.value)} />
              </label>
              <label>
                N° lettre de voiture
                <input value={cmr} onChange={(e) => setCmr(e.target.value)} />
              </label>
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
                      onClick={() => setStation(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </fieldset>
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
  );
}
