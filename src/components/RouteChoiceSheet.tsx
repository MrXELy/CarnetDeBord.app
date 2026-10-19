import { Check, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatPlace } from '../lib/geo';
import { routeOptions, type RouteOption } from '../lib/route';
import { useSettings } from '../lib/settings';
import { useSheet } from '../lib/useSheet';
import { closestRoute, type Stop, type StopSegment } from '../lib/weekStops';
import type { MapLeg } from '../types';
import MapSvg, { mapUnit, stopPins, viewBox, type Point } from './MapSvg';

interface Props {
  segment: StopSegment;
  /** Itinéraire enregistré pour ce tronçon. */
  current: MapLeg;
  onChoose: (option: RouteOption) => void;
  onClose: () => void;
}

/** Couleur de chaque itinéraire proposé. */
const ROUTE_COLORS = ['#60a5fa', '#fbbf24', '#f472b6'];

const placeOf = (s: Stop) => formatPlace(s.events[0]) || s.events[0].city;

/** « 3 h 05 », « 50 min » */
function duration(minutes: number): string {
  const m = Math.round(minutes);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

const km = (value: number) => `${Math.round(value).toLocaleString('fr-FR')} km`;

/** Choix de l'itinéraire d'un tronçon parmi ceux proposés, comparés aux km relevés au compteur. */
export default function RouteChoiceSheet({ segment, current, onChoose, onClose }: Props) {
  const { mapCities, mapDepartments } = useSettings();
  const [options, setOptions] = useState<RouteOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const sheet = useSheet(onClose);

  // Une demande par tronçon (pas de nouvelle demande quand la carte est enregistrée, à la fermeture).
  const [fromLat, fromLon, toLat, toLon] = [segment.from.lat, segment.from.lon, segment.to.lat, segment.to.lon];
  useEffect(() => {
    const controller = new AbortController();
    routeOptions([fromLat, fromLon], [toLat, toLon], controller.signal)
      .then((found) => (found ? setOptions(found) : setFailed(true)))
      .catch(() => {}); // fenêtre fermée pendant la demande
    return () => controller.abort();
  }, [fromLat, fromLon, toLat, toLon]);

  const odometer = segment.odometerKm;
  // Itinéraire enregistré : celui de même longueur (à 500 m près).
  const currentIndex = options?.findIndex((o) => current.km != null && Math.abs(o.km - current.km) < 0.5) ?? -1;
  const suggested = options && odometer != null ? options.indexOf(closestRoute(options, odometer)) : -1;
  const shown = selected ?? (currentIndex >= 0 ? currentIndex : Math.max(suggested, 0));

  // Itinéraire choisi dessiné en dernier (par-dessus), les autres en transparence.
  const order = options ? options.map((_, i) => i).sort((a, b) => Number(a === shown) - Number(b === shown)) : [];
  const lines = options
    ? order.map((i) => ({ color: ROUTE_COLORS[i] + (i === shown ? '' : '66'), coords: options[i].coords }))
    : [{ color: ROUTE_COLORS[0], coords: current.coords }];
  const stops = [segment.from, segment.to];
  const box = viewBox([...stops.map((s): Point => [s.lat, s.lon]), ...lines.flatMap((l) => l.coords)]);
  const pins = stopPins(stops, mapUnit(box) * 16, true);

  function choose() {
    if (!options) return;
    onChoose(options[shown]);
    sheet.close();
  }

  return (
    <div className="modal-backdrop" ref={sheet.ref} onClick={sheet.close}>
      <div className="modal map-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header" {...sheet.handle}>
          <button type="button" className="icon-btn" onClick={sheet.close} aria-label="Fermer">
            <X size={22} />
          </button>
          <h2>Choisir l’itinéraire</h2>
        </header>

        <div className="modal-body">
          <p className="route-trip">
            <strong>
              {segment.from.number}. {placeOf(segment.from)} → {segment.to.number}. {placeOf(segment.to)}
            </strong>
            <span className="hint">
              {odometer != null ? `Compteur : ${km(odometer)}` : 'Pas de km au compteur pour ce trajet'}
            </span>
          </p>

          <div className="map-frame">
            <MapSvg
              box={box}
              lines={lines}
              pins={pins}
              arrows={false}
              cities={mapCities}
              departments={mapDepartments}
              label="Itinéraires proposés pour ce trajet"
            />
          </div>

          {!options && !failed && (
            <p className="reading">
              <LoaderCircle size={16} className="spin" />
              Recherche des itinéraires…
            </p>
          )}
          {failed && <p className="reading reading-error">Itinéraires indisponibles : réessaie plus tard.</p>}

          {options && (
            <>
              <div className="route-options" role="radiogroup" aria-label="Itinéraires proposés">
                {options.map((o, i) => (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={i === shown}
                    className={`route-option ${i === shown ? 'selected' : ''}`}
                    onClick={() => setSelected(i)}
                  >
                    <i style={{ background: ROUTE_COLORS[i] }} />
                    <span className="route-option-body">
                      <strong>{km(o.km)}</strong>
                      <span className="hint">
                        {duration(o.minutes)}
                        {odometer != null && ` · écart ${Math.round(Math.abs(o.km - odometer))} km`}
                      </span>
                    </span>
                    {i === suggested && <span className="badge">conseillé</span>}
                    {i === currentIndex && <span className="read-tag">ACTUEL</span>}
                  </button>
                ))}
              </div>
              {options.length === 1 ? (
                <p className="hint">Un seul itinéraire trouvé pour ce trajet.</p>
              ) : (
                <button
                  type="button"
                  className="btn-primary btn-icon lv-add map-generate"
                  onClick={choose}
                  disabled={shown === currentIndex}
                >
                  <Check size={18} />
                  Garder cet itinéraire
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
