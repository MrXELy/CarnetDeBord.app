import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { LoaderCircle, Route, X } from 'lucide-react';
import { Fragment, lazy, Suspense, useMemo, useRef, useState } from 'react';
import { summarizeDay, summarizeWeek, timeLabel, weekLabel } from '../lib/dates';
import { formatPlace } from '../lib/geo';
import { updateSettings, useSettings } from '../lib/settings';
import { useEvents } from '../lib/useEvents';
import { shareFile } from '../lib/share';
import { useSheet } from '../lib/useSheet';
import { generateWeekMap, withChosenRoute } from '../lib/weekMapGen';
import {
  buildStops,
  dayColor,
  dayKey,
  dayLegs,
  joinDayLegs,
  segmentKey,
  shortDay,
  stopSegments,
  stopsHash,
  type Stop,
  type StopSegment,
} from '../lib/weekStops';
import { eventTypeInfo, type MapLeg, type Place, type TripEvent } from '../types';
import MapSvg, { ImageButton, MapCredits, mapUnit, renderImage, stopPins, viewBox, type Point } from './MapSvg';

const RouteChoiceSheet = lazy(() => import('./RouteChoiceSheet'));

/** Tronçon qui arrive à un lieu, avec son itinéraire enregistré. */
interface RouteLeg {
  segment: StopSegment;
  leg: MapLeg;
}

interface Props {
  start: Date;
  events: TripEvent[];
  onEdit: (event: TripEvent) => void;
  onClose: () => void;
}

type Status = { state: 'idle' } | { state: 'busy'; message: string } | { state: 'error'; message: string };

export default function WeekMap({ start, events, onEdit, onClose }: Props) {
  const { store } = useEvents();
  // Réglages de la carte, mémorisés sur cet appareil.
  const { mapRoutes, mapCities, mapDepartments, mapNumbers, mapFrame, mapRouteButtons } = useSettings();
  const saved = store.weekMap(start);
  const [found, setFound] = useState<Map<string, Place>>(() => new Map());
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const svgRef = useRef<SVGSVGElement>(null);
  // Tronçon dont on choisit l'itinéraire (clé), dans sa fenêtre.
  const [choosing, setChoosing] = useState<string | null>(null);

  const sheet = useSheet(onClose);

  const { stops, missing } = useMemo(() => buildStops(events, found), [events, found]);
  const straight = useMemo(() => dayLegs(stops), [stops]);
  const hash = stopsHash(stops);
  // Itinéraire enregistré de chaque tronçon, rangé par lieu d'arrivée (anciennes cartes par jour : aucun).
  const routeLegs = useMemo(() => {
    const byKey = new Map(saved?.legs.filter((l) => l.key).map((l) => [l.key!, l]));
    const result = new Map<number, RouteLeg>();
    for (const segment of stopSegments(stops)) {
      const leg = byKey.get(segmentKey(segment));
      if (leg) result.set(segment.to.number, { segment, leg });
    }
    return result;
  }, [saved, stops]);
  const chosen = [...routeLegs.values()].find((r) => segmentKey(r.segment) === choosing);
  const outdated = !!saved && saved.stops_hash !== hash;

  // Trajets affichés : les routes enregistrées, sinon des lignes droites en attendant.
  // Itinéraires enregistrés, ou lignes droites entre les étapes (au choix, ou tant que la carte n'est pas générée).
  const showRoutes = mapRoutes && !!saved;
  const legs =
    showRoutes && saved
      ? joinDayLegs(saved.legs).map((l) => ({ day: l.day, color: dayColor(l.day), coords: l.coords }))
      : straight.map((l) => ({ day: l.day, color: l.color, coords: l.points }));

  const box = viewBox(
    [...stops.map((s): Point => [s.lat, s.lon]), ...legs.flatMap((l) => l.coords)],
    mapFrame === 'france',
  );
  const pinList = stopPins(stops, mapUnit(box) * 16, mapNumbers);

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
      const blob = await renderImage(
        svg,
        weekLabel(start),
        [
          `${weekKm != null ? `${weekKm.toLocaleString('fr-FR')} km · ` : ''}${stops.length} lieux · ${days.length} jours`,
          ...days.map((d) => `${shortDay(d)} : ${dayKm(d)?.toLocaleString('fr-FR') ?? '–'} km`),
        ],
        days.map(dayColor),
      );
      const name = `carte-${format(start, 'yyyy')}-semaine-${weekLabel(start).match(/\d+/)?.[0]}.png`;
      await shareFile(blob, name, weekLabel(start));
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
    <>
      <div className="modal-backdrop" ref={sheet.ref} onClick={sheet.close}>
        <div className="modal map-modal" onClick={(e) => e.stopPropagation()}>
          <header className="modal-header" {...sheet.handle}>
            <button type="button" className="icon-btn" onClick={sheet.close} aria-label="Fermer">
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
                  <div className="map-toggles">
                    <label className="map-toggle">
                      <input
                        type="checkbox"
                        checked={mapFrame === 'france'}
                        onChange={(e) => updateSettings({ mapFrame: e.target.checked ? 'france' : 'trips' })}
                      />
                      France entière
                    </label>
                    <label className="map-toggle">
                      <input
                        type="checkbox"
                        checked={mapNumbers}
                        onChange={(e) => updateSettings({ mapNumbers: e.target.checked })}
                      />
                      Numéros
                    </label>
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
                </div>

                <div className="map-frame">
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
                  <ImageButton onExport={exportImage} disabled={busy || stops.length === 0} />
                </div>

                {outdated && (
                  <p className="reading reading-waiting">Des étapes ont changé depuis la création de la carte.</p>
                )}
                {status.state !== 'idle' && (
                  <p className={`reading ${status.state === 'error' ? 'reading-error' : ''}`}>
                    {busy && <LoaderCircle size={16} className="spin" />}
                    {status.message}
                  </p>
                )}

                {/* Toujours proposé : une carte à jour peut être recalculée (nouvelle méthode d'itinéraires). */}
                <button
                  type="button"
                  className={`${!saved || outdated ? 'btn-primary' : 'btn-secondary'} btn-icon lv-add map-generate`}
                  onClick={generate}
                  disabled={busy}
                >
                  <Route size={18} />
                  {saved ? 'Régénérer' : 'Générer la carte'}
                </button>
                {/* Boutons d'itinéraire entre les lieux de la liste : cachés tant qu'on ne les demande pas. */}
                {routeLegs.size > 0 && (
                  <button
                    type="button"
                    className="btn-link map-route-toggle"
                    aria-expanded={mapRouteButtons}
                    onClick={() => updateSettings({ mapRouteButtons: !mapRouteButtons })}
                  >
                    {mapRouteButtons ? 'Cacher le choix d’itinéraire' : 'Choix d’itinéraire'}
                  </button>
                )}

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
                  {stops.map((s) => {
                    // Itinéraire du tronçon qui arrive à ce lieu : entre le lieu précédent et celui-ci.
                    const route = routeLegs.get(s.number);
                    return (
                      <Fragment key={s.number}>
                        {route && mapRouteButtons && (
                          <RouteItem
                            route={route}
                            onChoose={busy ? undefined : () => setChoosing(segmentKey(route.segment))}
                          />
                        )}
                        <StopItem stop={s} />
                      </Fragment>
                    );
                  })}
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

                <MapCredits />
              </>
            )}
          </div>
        </div>
      </div>

      {saved && chosen && (
        <Suspense fallback={null}>
          <RouteChoiceSheet
            segment={chosen.segment}
            current={chosen.leg}
            onChoose={(option) => store.saveWeekMap(withChosenRoute(saved, segmentKey(chosen.segment), option))}
            onClose={() => setChoosing(null)}
          />
        </Suspense>
      )}
    </>
  );
}

/** Bouton de l'itinéraire d'un tronçon, posé entre ses deux lieux : ouvre son choix. */
function RouteItem({ route, onChoose }: { route: RouteLeg; onChoose?: () => void }) {
  if (route.leg.km == null) return null;
  return (
    <li className="map-route-row">
      <button type="button" className="map-route-btn" disabled={!onChoose} onClick={onChoose}>
        <Route size={14} />
        Itinéraire : {Math.round(route.leg.km).toLocaleString('fr-FR')} km
        {route.segment.odometerKm != null && ` · compteur ${route.segment.odometerKm.toLocaleString('fr-FR')} km`}
        {route.leg.manual && (route.leg.via ? ` · ${route.leg.via}` : ' · choisi')}
      </button>
    </li>
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
