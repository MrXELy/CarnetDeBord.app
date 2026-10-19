import { Check, LoaderCircle, MapPinPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatPlace } from '../lib/geo';
import { routeOptions, routeVia, type RouteOption } from '../lib/route';
import { useSettings } from '../lib/settings';
import { useSheet } from '../lib/useSheet';
import { closestRoute, type Stop, type StopSegment } from '../lib/weekStops';
import type { MapLeg, Place } from '../types';
import MapSvg, { mapUnit, project, stopPins, viewBox, type MapPin, type Point } from './MapSvg';
import PlaceField, { EMPTY_PLACE } from './PlaceField';

interface Props {
  segment: StopSegment;
  /** Itinéraire enregistré pour ce tronçon. */
  current: MapLeg;
  onChoose: (option: RouteOption) => void;
  onClose: () => void;
}

/** Couleur de chaque itinéraire de la liste, dans l'ordre. */
const ROUTE_COLORS = ['#60a5fa', '#fbbf24', '#f472b6', '#34d399', '#a78bfa', '#fb923c'];

/** Ville de passage : position connue (choisie dans les suggestions). */
type Via = Place & { lat: number; lon: number };

const placeOf = (s: Stop) => formatPlace(s.events[0]) || s.events[0].city;

/** « 3 h 05 », « 50 min » */
function duration(minutes: number): string {
  const m = Math.round(minutes);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

const km = (value: number) => `${Math.round(value).toLocaleString('fr-FR')} km`;

/** Même itinéraire : même longueur, à 500 m près. */
const sameKm = (a: number, b: number) => Math.abs(a - b) < 0.5;

/**
 * Choix de l'itinéraire d'un tronçon parmi ceux proposés, comparés aux km relevés au compteur.
 * « Passer par une ville… » ajoute deux itinéraires imposés : par le centre de la ville, et par la grande
 * route la plus proche (contournement, voie rapide) ; d'autres villes de passage peuvent s'ajouter, dans l'ordre.
 */
export default function RouteChoiceSheet({ segment, current, onChoose, onClose }: Props) {
  const { mapCities, mapDepartments } = useSettings();
  const [options, setOptions] = useState<RouteOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [vias, setVias] = useState<Via[]>([]);
  // Ville en cours de saisie (null : pas de champ ouvert).
  const [draft, setDraft] = useState<Place | null>(null);
  const [viaOptions, setViaOptions] = useState<RouteOption[]>([]);
  const [viaState, setViaState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [selected, setSelected] = useState<RouteOption | null>(null);
  const sheet = useSheet(onClose);

  const odometer = segment.odometerKm;

  // Une demande par tronçon (pas de nouvelle demande quand la carte est enregistrée, à la fermeture).
  const [fromLat, fromLon, toLat, toLon] = [segment.from.lat, segment.from.lon, segment.to.lat, segment.to.lon];
  useEffect(() => {
    const controller = new AbortController();
    routeOptions([fromLat, fromLon], [toLat, toLon], controller.signal)
      .then((found) => (found ? setOptions(found) : setFailed(true)))
      .catch(() => {}); // fenêtre fermée pendant la demande
    return () => controller.abort();
  }, [fromLat, fromLon, toLat, toLon]);

  // Itinéraires par les villes de passage : par le centre, puis par la grande route (une demande chacun).
  const viaKey = vias.map((v) => `${v.lat},${v.lon}`).join(';');
  useEffect(() => {
    if (!vias.length) {
      setViaOptions([]);
      setViaState('idle');
      return;
    }
    const controller = new AbortController();
    const names = vias.map((v) => v.city).join(', ');
    const points = vias.map((v): Point => [v.lat, v.lon]);
    setViaOptions([]);
    setViaState('busy');
    (async () => {
      const centre = await routeVia([fromLat, fromLon], [toLat, toLon], points, 'centre', controller.signal);
      const road = await routeVia([fromLat, fromLon], [toLat, toLon], points, 'road', controller.signal);
      const found: RouteOption[] = (
        [
          centre && { ...centre, label: `par le centre de ${names}` },
          // Grande route qui donne le même trajet que par le centre : inutile de la montrer deux fois.
          road && !(centre && sameKm(road.km, centre.km)) && { ...road, label: `par la grande route près de ${names}` },
        ] as (RouteOption | null | false)[]
      ).filter((o): o is RouteOption => !!o);
      setViaOptions(found);
      setViaState(found.length ? 'idle' : 'failed');
      // Le nouvel itinéraire le plus proche du compteur est sélectionné d'office.
      if (found.length) setSelected(closestRoute(found, odometer));
    })().catch(() => {}); // fenêtre fermée ou ville retirée pendant la demande
    return () => controller.abort();
    // viaKey résume `vias` (positions) : nouvelle demande seulement si les villes changent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viaKey, fromLat, fromLon, toLat, toLon, odometer]);

  // Itinéraire enregistré absent des propositions (ville de passage choisie avant) : gardé en tête de liste.
  const savedOption: RouteOption | null =
    options && current.km != null && !options.some((o) => sameKm(o.km, current.km!))
      ? { coords: current.coords, km: current.km, minutes: NaN, label: current.via }
      : null;
  const all = options ? [...(savedOption ? [savedOption] : []), ...options, ...viaOptions] : [];
  const currentIndex = all.findIndex((o) => current.km != null && sameKm(o.km, current.km));
  const suggested = all.length && odometer != null ? all.indexOf(closestRoute(all, odometer)) : -1;
  const selectedIndex = selected ? all.indexOf(selected) : -1;
  const shown = selectedIndex >= 0 ? selectedIndex : currentIndex >= 0 ? currentIndex : Math.max(suggested, 0);

  // Itinéraire choisi dessiné en dernier (par-dessus), les autres en transparence.
  const order = all.map((_, i) => i).sort((a, b) => Number(a === shown) - Number(b === shown));
  const lines = all.length
    ? order.map((i) => ({
        color: ROUTE_COLORS[i % ROUTE_COLORS.length] + (i === shown ? '' : '66'),
        coords: all[i].coords,
      }))
    : [{ color: ROUTE_COLORS[0], coords: current.coords }];
  const stops = [segment.from, segment.to];
  const box = viewBox([
    ...stops.map((s): Point => [s.lat, s.lon]),
    ...vias.map((v): Point => [v.lat, v.lon]),
    ...lines.flatMap((l) => l.coords),
  ]);
  const viaPins: MapPin[] = vias.map((v) => ({ at: project([v.lat, v.lon]), color: '#e8eaed', approximate: false }));
  const pins = [...viaPins, ...stopPins(stops, mapUnit(box) * 16, true)];

  function pickVia(place: Place) {
    if (place.lat == null || place.lon == null) return setDraft(place); // saisie en cours
    setVias((list) => [...list, place as Via]);
    setDraft(null);
  }

  function removeVia(index: number) {
    setVias((list) => list.filter((_, i) => i !== index));
    if (selected && viaOptions.includes(selected)) setSelected(null);
  }

  function choose() {
    if (!all[shown]) return;
    onChoose(all[shown]);
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

          {all.length > 0 && (
            <div className="route-options" role="radiogroup" aria-label="Itinéraires proposés">
              {all.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={i === shown}
                  className={`route-option ${i === shown ? 'selected' : ''}`}
                  onClick={() => setSelected(o)}
                >
                  <i style={{ background: ROUTE_COLORS[i % ROUTE_COLORS.length] }} />
                  <span className="route-option-body">
                    <strong>{km(o.km)}</strong>
                    {o.label && <span className="route-option-via">{o.label}</span>}
                    <span className="hint">
                      {[
                        Number.isFinite(o.minutes) && duration(o.minutes),
                        odometer != null && `écart ${Math.round(Math.abs(o.km - odometer))} km`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {i === suggested && <span className="badge">conseillé</span>}
                  {i === currentIndex && <span className="read-tag">ACTUEL</span>}
                </button>
              ))}
            </div>
          )}

          {/* Villes de passage imposées, dans l'ordre. */}
          {vias.length > 0 && (
            <div className="route-vias">
              <span className="hint">Passage par :</span>
              {vias.map((v, i) => (
                <span key={i} className="route-via">
                  {formatPlace(v)}
                  <button type="button" aria-label={`Retirer ${v.city}`} onClick={() => removeVia(i)}>
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {viaState === 'busy' && (
            <p className="reading">
              <LoaderCircle size={16} className="spin" />
              Calcul de l’itinéraire par {vias.map((v) => v.city).join(', ')}…
            </p>
          )}
          {viaState === 'failed' && (
            <p className="reading reading-error">Aucun itinéraire trouvé par cette ville : réessaie plus tard.</p>
          )}

          {draft ? (
            <div className="route-via-field">
              <PlaceField value={draft} onChange={pickVia} locate={false} />
              <button type="button" className="btn-link" onClick={() => setDraft(null)}>
                Annuler
              </button>
            </div>
          ) : (
            (options || failed) && (
              <button
                type="button"
                className="btn-secondary btn-icon lv-add map-generate"
                onClick={() => setDraft(EMPTY_PLACE)}
                disabled={viaState === 'busy'}
              >
                <MapPinPlus size={18} />
                {vias.length ? 'Ajouter une autre ville' : 'Passer par une ville…'}
              </button>
            )
          )}

          {options && options.length === 1 && !vias.length && !savedOption && (
            <p className="hint">Un seul itinéraire trouvé pour ce trajet.</p>
          )}
          {all.length > 1 && (
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
        </div>
      </div>
    </div>
  );
}
