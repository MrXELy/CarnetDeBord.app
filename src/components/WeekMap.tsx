import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Download, LoaderCircle, Route, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { summarizeDay, summarizeWeek, timeLabel, weekLabel } from '../lib/dates';
import { formatPlace } from '../lib/geo';
import { updateSettings, useSettings } from '../lib/settings';
import { useEvents } from '../lib/useEvents';
import { useModal } from '../lib/useModal';
import { generateWeekMap } from '../lib/weekMapGen';
import { buildStops, dayColor, dayKey, dayLegs, shortDay, stopsHash, type Stop } from '../lib/weekStops';
import { eventTypeInfo, type Place, type TripEvent } from '../types';
import MapSvg, { mapUnit, project, renderImage, shareImage, viewBox, type MapPin, type Point } from './MapSvg';

interface Props {
  start: Date;
  events: TripEvent[];
  onEdit: (event: TripEvent) => void;
  onClose: () => void;
}

type Status = { state: 'idle' } | { state: 'busy'; message: string } | { state: 'error'; message: string };

/**
 * Repères de la carte : les lieux qui se toucheraient à l'écran (même endroit, ou villes voisines
 * à cette échelle) partagent un repère avec tous leurs numéros (« 2·7 ») ; la liste détaille chaque lieu.
 */
function pins(stops: Stop[], minGap: number): MapPin[] {
  const result: { at: Point; numbers: number[]; color: string; approximate: boolean }[] = [];
  for (const s of stops) {
    const at = project([s.lat, s.lon]);
    const near = result.find((p) => Math.hypot(p.at[0] - at[0], p.at[1] - at[1]) < minGap);
    if (near) {
      near.numbers.push(s.number);
      near.approximate ||= s.approximate;
    } else result.push({ at, numbers: [s.number], color: s.color, approximate: s.approximate });
  }
  return result.map((p) => ({ ...p, label: p.numbers.join('·') }));
}

export default function WeekMap({ start, events, onEdit, onClose }: Props) {
  const { store } = useEvents();
  // Réglages de la carte, mémorisés sur cet appareil.
  const { mapRoutes, mapCities, mapDepartments } = useSettings();
  const saved = store.weekMap(start);
  const [found, setFound] = useState<Map<string, Place>>(() => new Map());
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const svgRef = useRef<SVGSVGElement>(null);

  useModal(onClose);

  const { stops, missing } = useMemo(() => buildStops(events, found), [events, found]);
  const straight = useMemo(() => dayLegs(stops), [stops]);
  const hash = stopsHash(stops);
  const outdated = !!saved && saved.stops_hash !== hash;

  // Trajets affichés : les routes enregistrées, sinon des lignes droites en attendant.
  // Itinéraires enregistrés, ou lignes droites entre les étapes (au choix, ou tant que la carte n'est pas générée).
  const showRoutes = mapRoutes && !!saved;
  const legs = showRoutes && saved
    ? saved.legs.map((l) => ({ day: l.day, color: dayColor(l.day), coords: l.coords }))
    : straight.map((l) => ({ day: l.day, color: l.color, coords: l.points }));

  const box = viewBox([...stops.map((s): Point => [s.lat, s.lon]), ...legs.flatMap((l) => l.coords)]);
  const pinList = pins(stops, mapUnit(box) * 16);

  const days = [...new Set(stops.map((s) => s.day))].sort();
  const dayKm = (day: string) => summarizeDay(events.filter((e) => !e.deleted_at && dayKey(e.occurred_at) === day)).km;
  const weekKm = summarizeWeek(events).km;

  async function generate() {
    if (!navigator.onLine) return setStatus({ state: 'error', message: 'Pas de réseau : réessaie plus tard.' });
    const resolved = new Map(found);
    try {
      await generateWeekMap(store, start, events, resolved, (message) => setStatus({ state: 'busy', message }));
      setStatus({ state: 'idle' });
    } catch {
      setStatus({ state: 'error', message: 'Itinéraire indisponible : réessaie plus tard.' });
    }
    setFound(resolved);
  }

  async function exportImage() {
    const svg = svgRef.current;
    if (!svg) return;
    setStatus({ state: 'busy', message: 'Création de l’image…' });
    try {
      const blob = await renderImage(svg, weekLabel(start), [
        `${weekKm != null ? `${weekKm.toLocaleString('fr-FR')} km · ` : ''}${stops.length} lieux · ${days.length} jours`,
        ...days.map((d) => `${shortDay(d)} : ${dayKm(d)?.toLocaleString('fr-FR') ?? '–'} km`),
      ], days.map(dayColor));
      const name = `carte-${format(start, 'yyyy')}-semaine-${weekLabel(start).match(/\d+/)?.[0]}.png`;
      await shareImage(blob, name, weekLabel(start));
      setStatus({ state: 'idle' });
    } catch (err) {
      // Partage annulé par l'utilisateur : rien à signaler.
      setStatus(
        err instanceof DOMException && err.name === 'AbortError'
          ? { state: 'idle' }
          : { state: 'error', message: 'Image impossible à créer.' },
      );
    }
  }

  const busy = status.state === 'busy';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal map-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
          <h2>Carte · {weekLabel(start)}</h2>
        </header>

        <div className="modal-body">
          {stops.length === 0 && missing.length === 0 ? (
            <p className="empty muted">Aucune étape cette semaine.</p>
          ) : (
            <>
              <div className="map-controls">
                <div className="map-mode" role="radiogroup" aria-label="Tracé des trajets">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={showRoutes}
                    className={showRoutes ? 'selected' : ''}
                    disabled={!saved}
                    title={saved ? undefined : 'Génère d’abord la carte'}
                    onClick={() => updateSettings({ mapRoutes: true })}
                  >
                    Itinéraires
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!showRoutes}
                    className={!showRoutes ? 'selected' : ''}
                    onClick={() => updateSettings({ mapRoutes: false })}
                  >
                    Lignes droites
                  </button>
                </div>
                <label className="map-toggle">
                  <input
                    type="checkbox"
                    checked={mapCities}
                    onChange={(e) => updateSettings({ mapCities: e.target.checked })}
                  />
                  Villes
                </label>
                <label className="map-toggle">
                  <input
                    type="checkbox"
                    checked={mapDepartments}
                    onChange={(e) => updateSettings({ mapDepartments: e.target.checked })}
                  />
                  Départements
                </label>
              </div>

              <MapSvg
                ref={svgRef}
                box={box}
                lines={legs}
                pins={pinList}
                arrows
                cities={mapCities}
                departments={mapDepartments}
                label={`Carte des trajets de la ${weekLabel(start)}`}
              />

              {outdated && (
                <p className="reading reading-waiting">Des étapes ont changé depuis la création de la carte.</p>
              )}
              {status.state !== 'idle' && (
                <p className={`reading ${status.state === 'error' ? 'reading-error' : ''}`}>
                  {busy && <LoaderCircle size={16} className="spin" />}
                  {status.message}
                </p>
              )}

              <div className="row">
                {(!saved || outdated) && (
                  <button type="button" className="btn-primary btn-icon lv-add" onClick={generate} disabled={busy}>
                    <Route size={18} />
                    {saved ? 'Régénérer' : 'Générer la carte'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary btn-icon lv-add"
                  onClick={exportImage}
                  disabled={busy || stops.length === 0}
                >
                  <Download size={18} />
                  Enregistrer l’image
                </button>
              </div>

              <div className="map-legend">
                {days.map((d) => (
                  <span key={d}>
                    <i style={{ background: dayColor(d) }} />
                    {shortDay(d)}
                    {dayKm(d) != null && <b> {dayKm(d)!.toLocaleString('fr-FR')} km</b>}
                  </span>
                ))}
              </div>
              <p className="hint">
                {weekKm != null && `${weekKm.toLocaleString('fr-FR')} km · `}
                {stops.length} lieu{stops.length > 1 ? 'x' : ''} · {days.length} jour{days.length > 1 ? 's' : ''}
                {saved
                  ? ` · carte créée le ${format(parseISO(saved.generated_at), 'd MMM à HH:mm', { locale: fr })}`
                  : ' · itinéraires pas encore générés'}
              </p>

              <ol className="map-stops">
                {stops.map((s) => (
                  <StopItem key={s.number} stop={s} />
                ))}
              </ol>

              {missing.length > 0 && (
                <div className="map-missing">
                  <p className="hint hint-err">
                    {missing.length} étape{missing.length > 1 ? 's' : ''} sans position, absente
                    {missing.length > 1 ? 's' : ''} de la carte :
                  </p>
                  {missing.map((e) => (
                    <div key={e.id} className="map-missing-row">
                      <span>
                        {shortDay(dayKey(e.occurred_at))} {timeLabel(e.occurred_at)} · {eventTypeInfo(e.type).short} ·{' '}
                        {e.city ? `« ${e.city} »` : 'lieu non renseigné'}
                      </span>
                      <button type="button" className="btn-link" onClick={() => onEdit(e)}>
                        Corriger
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <p className="hint">
                Itinéraires calculés pour une voiture (OSRM, © OpenStreetMap) : ils peuvent différer de la route prise en
                poids lourd. Fond de carte : IGN Admin Express.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StopItem({ stop: s }: { stop: Stop }) {
  const first = s.events[0];
  return (
    <li>
      <span className="map-stop-number" style={{ background: s.color }}>
        {s.number}
      </span>
      <span className="map-stop-body">
        <strong>{formatPlace(first) || first.city}</strong>
        {s.approximate && <span className="hint"> · position approximative (centre de la ville)</span>}
        {s.events.map((e) => (
          <span key={e.id} className="map-stop-event">
            {shortDay(dayKey(e.occurred_at))} {timeLabel(e.occurred_at)} · {eventTypeInfo(e.type).short}
            {e.client && ` — ${e.client}`}
          </span>
        ))}
      </span>
    </li>
  );
}
