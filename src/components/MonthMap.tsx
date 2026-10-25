import { LoaderCircle, Play, Route, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { monthWeeks, summarizeWeek, timeLabel, weekLabel } from '../lib/dates';
import { updateSettings, useSettings } from '../lib/settings';
import { useEvents } from '../lib/useEvents';
import { shareFile } from '../lib/share';
import { useSheet } from '../lib/useSheet';
import { generateWeekMap } from '../lib/weekMapGen';
import { WEEK_COLORS, buildStops, dayKey, dayLegs, shortDay, stopsHash } from '../lib/weekStops';
import { eventTypeInfo, type Place, type TripEvent } from '../types';
import MapSvg, {
  ImageButton,
  MapCredits,
  mapUnit,
  project,
  renderImage,
  viewBox,
  type MapPin,
  type Point,
} from './MapSvg';

const WeekReplay = lazy(() => import('./WeekReplay'));

interface Props {
  /** Mois tel qu'affiché dans la liste des semaines : « Janvier 2026 ». */
  month: string;
  onPickWeek: (start: Date) => void;
  onEdit: (event: TripEvent) => void;
  onClose: () => void;
}

type Status = { state: 'idle' } | { state: 'busy'; message: string } | { state: 'error'; message: string };

/** « Sem. 4 · 19 – 25 janv. » */
const shortWeek = (start: Date) => weekLabel(start).replace('Semaine', 'Sem.');

/** Points regroupés quand ils se touchent à l'écran : la couleur est celle du premier passage. */
function dots(stops: { at: Point; color: string; approximate: boolean }[], minGap: number): MapPin[] {
  const result: MapPin[] = [];
  for (const s of stops) {
    const near = result.find((p) => Math.hypot(p.at[0] - s.at[0], p.at[1] - s.at[1]) < minGap);
    if (near) near.approximate ||= s.approximate;
    else result.push({ ...s });
  }
  return result;
}

/** Carte d'un mois : les semaines réutilisent leurs itinéraires enregistrés, une couleur par semaine. */
export default function MonthMap({ month, onPickWeek, onEdit, onClose }: Props) {
  const { store, events } = useEvents();
  const { mapRoutes, mapCities, mapDepartments, mapFrame } = useSettings();
  const [found, setFound] = useState<Map<string, Place>>(() => new Map());
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const svgRef = useRef<SVGSVGElement>(null);
  const [replaying, setReplaying] = useState(false);

  const sheet = useSheet(onClose);

  const base = useMemo(
    () =>
      monthWeeks(events, month).map((w, i) => {
        const { stops, missing } = buildStops(w.events, found);
        return {
          ...w,
          color: WEEK_COLORS[i % WEEK_COLORS.length],
          stops,
          missing,
          hash: stopsHash(stops),
          km: summarizeWeek(w.events).km,
        };
      }),
    [events, month, found],
  );
  // Carte enregistrée et à jour : ses itinéraires sont réutilisés tels quels.
  const weeks = base.map((w) => {
    const saved = store.weekMap(w.start);
    return { ...w, saved: saved && saved.stops_hash === w.hash ? saved : null };
  });

  const toGenerate = weeks.filter((w) => !w.saved && w.stops.length + w.missing.length > 0);
  const anySaved = weeks.some((w) => w.saved);
  const showRoutes = mapRoutes && anySaved;
  const lines = weeks.flatMap((w) =>
    showRoutes && w.saved
      ? w.saved.legs.map((l) => ({ color: w.color, coords: l.coords }))
      : dayLegs(w.stops).map((l) => ({ color: w.color, coords: l.points })),
  );

  const allStops = weeks.flatMap((w) => w.stops.map((s) => ({ ...s, color: w.color })));
  const missing = weeks.flatMap((w) => w.missing);
  const box = viewBox(
    [...allStops.map((s): Point => [s.lat, s.lon]), ...lines.flatMap((l) => l.coords)],
    mapFrame === 'france',
  );
  const pins = dots(
    allStops.map((s) => ({ at: project([s.lat, s.lon]), color: s.color, approximate: s.approximate })),
    mapUnit(box) * 6,
  );

  // Mois rejoué : tous les lieux du mois à la suite, avec les itinéraires des semaines à jour.
  const replayStops = useMemo(
    () =>
      buildStops(
        base.flatMap((w) => w.events),
        found,
      ).stops,
    [base, found],
  );
  const replayLegs = weeks.flatMap((w) => w.saved?.legs ?? []);

  const kms = weeks.map((w) => w.km).filter((km): km is number => km != null);
  const monthKm = kms.length ? kms.reduce((a, b) => a + b, 0) : null;

  // Fenêtre fermée pendant le calcul : les demandes d'itinéraires s'arrêtent.
  const closed = useRef<AbortController>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    closed.current = ctrl;
    return () => ctrl.abort();
  }, []);

  async function generate() {
    if (!navigator.onLine) return setStatus({ state: 'error', message: 'Pas de réseau : réessaie plus tard.' });
    const resolved = new Map(found);
    try {
      for (const [i, w] of toGenerate.entries()) {
        await generateWeekMap(
          store,
          w.start,
          w.events,
          resolved,
          (message) => setStatus({ state: 'busy', message: `Semaine ${i + 1}/${toGenerate.length} · ${message}` }),
          closed.current?.signal,
        );
      }
      setStatus({ state: 'idle' });
    } catch {
      // Les semaines déjà calculées restent enregistrées.
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
        month,
        [
          `${monthKm != null ? `${monthKm.toLocaleString('fr-FR')} km · ` : ''}${weeks.length} semaine${weeks.length > 1 ? 's' : ''}`,
          ...weeks.map(
            (w) => `Sem. ${weekLabel(w.start).match(/\d+/)?.[0]} : ${w.km?.toLocaleString('fr-FR') ?? '–'} km`,
          ),
        ],
        weeks.map((w) => w.color),
      );
      await shareFile(blob, `carte-${month.toLowerCase().replace(' ', '-')}.png`, month);
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
            <h2>Carte · {month}</h2>
          </header>

          <div className="modal-body">
            {weeks.length === 0 ? (
              <p className="empty muted">Aucune étape ce mois-ci.</p>
            ) : (
              <>
                <div className="map-controls">
                  <div className="map-mode" role="radiogroup" aria-label="Tracé des trajets">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={showRoutes}
                      className={showRoutes ? 'selected' : ''}
                      disabled={!anySaved}
                      title={anySaved ? undefined : 'Génère d’abord la carte'}
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
                    lines={lines}
                    pins={pins}
                    arrows={false}
                    cities={mapCities}
                    departments={mapDepartments}
                    label={`Carte des trajets de ${month.toLowerCase()}`}
                  />
                  <ImageButton onExport={exportImage} disabled={busy || allStops.length === 0} />
                  {/* Mois rejoué : bouton rond en bas à gauche de la carte. */}
                  <button
                    type="button"
                    className="map-image-btn map-replay-btn"
                    aria-label="Rejouer le mois"
                    title="Rejouer le mois"
                    disabled={busy || replayStops.length < 2}
                    onClick={() => setReplaying(true)}
                  >
                    <Play size={18} />
                  </button>
                </div>

                {status.state !== 'idle' && (
                  <p className={`reading ${status.state === 'error' ? 'reading-error' : ''}`}>
                    {busy && <LoaderCircle size={16} className="spin" />}
                    {status.message}
                  </p>
                )}

                {toGenerate.length > 0 && (
                  <button
                    type="button"
                    className="btn-primary btn-icon lv-add map-generate"
                    onClick={generate}
                    disabled={busy}
                  >
                    <Route size={18} />
                    {toGenerate.length === weeks.length
                      ? 'Générer la carte'
                      : `Générer ${toGenerate.length} semaine${toGenerate.length > 1 ? 's' : ''}`}
                  </button>
                )}

                <div className="month-weeks">
                  {weeks.map((w) => (
                    <button
                      type="button"
                      key={w.start.getTime()}
                      className="week-row"
                      onClick={() => onPickWeek(w.start)}
                    >
                      <span className="month-week-title">
                        <i style={{ background: w.color }} />
                        {shortWeek(w.start)}
                      </span>
                      <span className="week-row-meta">
                        {w.km != null ? `${w.km.toLocaleString('fr-FR')} km` : '– km'}
                        {!w.saved && ' · lignes droites'}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="hint">
                  {monthKm != null && `${monthKm.toLocaleString('fr-FR')} km · `}
                  {allStops.length} lieu{allStops.length > 1 ? 'x' : ''} · {weeks.length} semaine
                  {weeks.length > 1 ? 's' : ''} · touche une semaine pour l’ouvrir
                </p>

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

      {replaying && (
        <Suspense fallback={null}>
          <WeekReplay
            heading="Mois rejoué"
            title={month}
            fileName={`mois-${month.toLowerCase().replace(' ', '-')}`}
            when="ce mois-ci"
            stops={replayStops}
            legs={replayLegs}
            onClose={() => setReplaying(false)}
          />
        </Suspense>
      )}
    </>
  );
}
