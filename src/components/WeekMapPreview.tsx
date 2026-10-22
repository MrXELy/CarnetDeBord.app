import { format } from 'date-fns';
import { Play } from 'lucide-react';
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { weekLabel } from '../lib/dates';
import { useSettings } from '../lib/settings';
import { useEvents } from '../lib/useEvents';
import { buildStops, dayColor, dayLegs, joinDayLegs } from '../lib/weekStops';
import type { TripEvent } from '../types';
import MapSvg, { mapUnit, stopPins, viewBox, type Point } from './MapSvg';

const WeekReplay = lazy(() => import('./WeekReplay'));

interface Props {
  start: Date;
  /** Étapes de la semaine. */
  events: TripEvent[];
  /** Ouvre la carte complète (réglages, itinéraires, liste des lieux). */
  onOpen: () => void;
  /** Boutons posés avant « Revoir en vidéo », sur la même ligne (frais, feuille). */
  children?: ReactNode;
}

/** Version PC : carte de la semaine toujours visible à droite, à toucher pour l'ouvrir en grand. */
export default function WeekMapPreview({ start, events, onOpen, children }: Props) {
  const { store } = useEvents();
  const { mapRoutes, mapCities, mapDepartments, mapNumbers } = useSettings();
  const [replaying, setReplaying] = useState(false);
  const saved = store.weekMap(start);
  // Lieux sans coordonnées : pas recherchés ici (la carte complète s'en charge).
  const { stops } = useMemo(() => buildStops(events, new Map()), [events]);
  // Même tracé que la carte complète : itinéraires enregistrés, ou lignes droites en attendant.
  const legs =
    mapRoutes && saved
      ? joinDayLegs(saved.legs).map((l) => ({ day: l.day, color: dayColor(l.day), coords: l.coords }))
      : dayLegs(stops).map((l) => ({ day: l.day, color: l.color, coords: l.points }));
  const box = viewBox([...stops.map((s): Point => [s.lat, s.lon]), ...legs.flatMap((l) => l.coords)], false);
  const title = weekLabel(start);

  return (
    <section className="pc-map">
      {stops.length === 0 ? (
        <p className="empty muted">Pas encore de lieu sur la carte cette semaine.</p>
      ) : (
        <button type="button" className="pc-map-frame" onClick={onOpen} aria-label="Ouvrir la carte de la semaine">
          <MapSvg
            box={box}
            lines={legs}
            pins={stopPins(stops, mapUnit(box) * 16, mapNumbers)}
            arrows
            cities={mapCities}
            departments={mapDepartments}
            label={`Carte des trajets : ${title}`}
          />
        </button>
      )}
      <div className="pc-map-actions">
        {children}
        <button
          type="button"
          className="btn-primary btn-icon map-action"
          disabled={stops.length < 2}
          onClick={() => setReplaying(true)}
        >
          <Play size={20} />
          Revoir en vidéo
        </button>
      </div>

      {replaying && (
        <Suspense fallback={null}>
          <WeekReplay
            heading="Semaine rejouée"
            title={title}
            fileName={`semaine-${format(start, 'yyyy')}-${title.match(/\d+/)?.[0]}`}
            when="cette semaine"
            stops={stops}
            legs={saved?.legs ?? []}
            onClose={() => setReplaying(false)}
          />
        </Suspense>
      )}
    </section>
  );
}
