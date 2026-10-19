import { Check, LoaderCircle, MapPinPlus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { communeAt, formatPlace } from '../lib/geo';
import { orderWaypoints, routeOptions, routeVia, type RouteOption, type ViaMode } from '../lib/route';
import { useSheet } from '../lib/useSheet';
import { closestRoute, type Stop, type StopSegment } from '../lib/weekStops';
import type { MapLeg, MapWaypoint, Place } from '../types';
import type { Point } from './MapSvg';
import PlaceField, { EMPTY_PLACE } from './PlaceField';
import RouteMap, { type RouteMarker } from './RouteMap';

interface Props {
  segment: StopSegment;
  /** Itinéraire enregistré pour ce tronçon. */
  current: MapLeg;
  onChoose: (option: RouteOption) => void;
  onClose: () => void;
}

/** Couleur de chaque itinéraire de la liste, dans l'ordre. */
const ROUTE_COLORS = ['#60a5fa', '#fbbf24', '#f472b6', '#34d399', '#a78bfa', '#fb923c'];

/** Point de passage : une ville choisie dans les suggestions, ou un point placé sur la carte. */
interface Via {
  id: string;
  kind: 'city' | 'point';
  at: Point;
  /** Ville : son nom ; point : la commune où il se trouve (null tant qu'inconnue, ou hors de France). */
  name: string | null;
  /** Ville : nom affiché avec le département (« Cahors (46) »). */
  display?: string;
  /** Point : rayon de recherche de la route (précision du doigt). */
  radius?: number;
}

/** Itinéraire de la liste, avec sa clé (le choix est retenu par clé : les textes peuvent changer). */
type Choice = RouteOption & { key: string };

/** Texte d'un itinéraire imposé : « par le centre de Cahors, un point près de Souillac ». */
function viaLabel(vias: Via[], mode: ViaMode): string {
  const parts = vias.map((v) =>
    v.kind === 'point'
      ? v.name
        ? `un point près de ${v.name}`
        : 'un point placé'
      : mode === 'centre'
        ? `le centre de ${v.name}`
        : `la grande route près de ${v.name}`,
  );
  return `par ${parts.join(', ')}`;
}

let nextViaId = 0;

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
 * route la plus proche (contournement, voie rapide). Bouton rond sur la carte : un point touché sur la carte,
 * pris tel quel (déplaçable au doigt). Villes et points se cumulent, rangés du départ vers l'arrivée.
 */
export default function RouteChoiceSheet({ segment, current, onChoose, onClose }: Props) {
  const [options, setOptions] = useState<RouteOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Points de passage de l'itinéraire enregistré, retrouvés pour le modifier.
  const [vias, setVias] = useState<Via[]>(() =>
    (current.waypoints ?? []).map((w) => ({
      id: `v${nextViaId++}`,
      kind: w.kind,
      at: [w.lat, w.lon],
      name: w.name,
      display: w.display,
      radius: w.radius,
    })),
  );
  // Points retrouvés et pas encore modifiés : l'itinéraire enregistré reste sélectionné après leur calcul.
  const restored = useRef(vias.length > 0);
  // Ville en cours de saisie (null : pas de champ ouvert).
  const [draft, setDraft] = useState<Place | null>(null);
  // Mode « placer un point » : le prochain toucher sur la carte place un point de passage.
  const [placing, setPlacing] = useState(false);
  const [viaOptions, setViaOptions] = useState<{ mode: ViaMode; option: RouteOption }[]>([]);
  const [viaState, setViaState] = useState<'idle' | 'busy' | 'failed'>('idle');
  // Clé de l'itinéraire choisi dans la liste (null : l'enregistré, sinon le conseillé).
  const [selected, setSelected] = useState<string | null>(null);
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

  // Points de passage du départ vers l'arrivée, quel que soit l'ordre où ils ont été ajoutés.
  const ordered = useMemo(
    () => orderWaypoints([fromLat, fromLon], [toLat, toLon], vias),
    [vias, fromLat, fromLon, toLat, toLon],
  );
  const hasCity = ordered.some((v) => v.kind === 'city');

  // Itinéraires imposés : par le centre des villes, puis par la grande route s'il y a une ville (une demande
  // chacun) ; les points placés sont pris tels quels dans les deux.
  const viaKey = ordered.map((v) => `${v.kind}:${v.at.join(',')}:${v.radius ?? ''}`).join(';');
  useEffect(() => {
    if (!ordered.length) {
      setViaOptions([]);
      setViaState('idle');
      return;
    }
    const controller = new AbortController();
    const waypoints = ordered.map((v) => ({ at: v.at, radius: v.radius }));
    setViaOptions([]);
    setViaState('busy');
    (async () => {
      const found: { mode: ViaMode; option: RouteOption }[] = [];
      const centre = await routeVia([fromLat, fromLon], [toLat, toLon], waypoints, 'centre', controller.signal);
      if (centre) found.push({ mode: 'centre', option: centre });
      if (hasCity) {
        const road = await routeVia([fromLat, fromLon], [toLat, toLon], waypoints, 'road', controller.signal);
        // Grande route qui donne le même trajet que par le centre : inutile de la montrer deux fois.
        if (road && !(centre && sameKm(road.km, centre.km))) found.push({ mode: 'road', option: road });
      }
      setViaOptions(found);
      setViaState(found.length ? 'idle' : 'failed');
      // Le nouvel itinéraire le plus proche du compteur est sélectionné d'office
      // (sauf pour les points retrouvés à l'ouverture, pas encore modifiés).
      if (found.length && !restored.current) {
        const best = closestRoute(
          found.map((f) => f.option),
          odometer,
        );
        setSelected(found.find((f) => f.option === best)!.mode);
      }
    })().catch(() => {}); // fenêtre fermée ou point retiré pendant la demande
    return () => controller.abort();
    // viaKey résume `ordered` (sortes, positions) : nouvelle demande seulement si les points changent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viaKey, fromLat, fromLon, toLat, toLon, odometer]);

  // Liste : l'itinéraire enregistré s'il n'est pas parmi les propositions (passage imposé choisi avant),
  // les propositions, puis les itinéraires imposés.
  const all = useMemo((): Choice[] => {
    if (!options) return [];
    const saved =
      current.km != null && ![...options, ...viaOptions.map((v) => v.option)].some((o) => sameKm(o.km, current.km!))
        ? [{ key: 'saved', coords: current.coords, km: current.km, minutes: NaN, label: current.via }]
        : [];
    return [
      ...saved,
      ...options.map((o, i) => ({ ...o, key: `b${i}` })),
      ...viaOptions.map(({ mode, option }) => ({
        ...option,
        key: mode,
        label: viaLabel(ordered, mode),
        waypoints: ordered.map((v): MapWaypoint => ({
          kind: v.kind,
          lat: v.at[0],
          lon: v.at[1],
          name: v.name,
          ...(v.display && { display: v.display }),
          ...(v.radius != null && { radius: v.radius }),
        })),
      })),
    ];
  }, [options, viaOptions, ordered, current]);
  const savedListed = all[0]?.key === 'saved';
  const currentIndex = all.findIndex((o) => current.km != null && sameKm(o.km, current.km));
  const suggested = all.length && odometer != null ? all.indexOf(closestRoute(all, odometer) as Choice) : -1;
  const selectedIndex = all.findIndex((o) => o.key === selected);
  const shown = selectedIndex >= 0 ? selectedIndex : currentIndex >= 0 ? currentIndex : Math.max(suggested, 0);

  // Carte : tous les itinéraires de la liste (ou l'enregistré, en attendant), étapes numérotées, points de passage.
  const lines = useMemo(
    () =>
      all.length
        ? all.map((o, i) => ({ color: ROUTE_COLORS[i % ROUTE_COLORS.length], coords: o.coords }))
        : [{ color: ROUTE_COLORS[0], coords: current.coords }],
    [all, current],
  );
  const markers = useMemo(
    (): RouteMarker[] => [
      ...ordered.map((v): RouteMarker => ({ at: v.at, movable: v.kind === 'point' ? v.id : undefined })),
      ...[segment.from, segment.to].map((s): RouteMarker => ({
        at: [s.lat, s.lon],
        label: String(s.number),
        color: s.color,
      })),
    ],
    [ordered, segment],
  );
  // Cadre recalé à l'arrivée des itinéraires et quand une ville est ajoutée ou retirée,
  // pas pour un point placé (l'utilisateur a zoomé pour viser).
  const fitKey = `${options ? 1 : 0}|${ordered.filter((v) => v.kind === 'city').map((v) => v.at.join(','))}`;

  /** Nom de la commune d'un point placé, demandé après coup (le calcul de l'itinéraire n'attend pas). */
  function nameLater(id: string, at: Point) {
    void communeAt(at[0], at[1]).then((name) =>
      setVias((list) => list.map((v) => (v.id === id && v.at === at ? { ...v, name } : v))),
    );
  }

  function pickVia(place: Place) {
    if (place.lat == null || place.lon == null) return setDraft(place); // saisie en cours
    restored.current = false;
    const at: Point = [place.lat, place.lon];
    setVias((list) => [
      ...list,
      { id: `v${nextViaId++}`, kind: 'city', at, name: place.city, display: formatPlace(place) },
    ]);
    setDraft(null);
  }

  function placePoint(at: Point, radius: number) {
    restored.current = false;
    const id = `v${nextViaId++}`;
    setVias((list) => [...list, { id, kind: 'point', at, radius, name: null }]);
    setPlacing(false);
    nameLater(id, at);
  }

  function movePoint(id: string, at: Point, radius: number) {
    restored.current = false;
    setVias((list) => list.map((v) => (v.id === id ? { ...v, at, radius, name: null } : v)));
    nameLater(id, at);
  }

  function removeVia(id: string) {
    restored.current = false;
    setVias((list) => list.filter((v) => v.id !== id));
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

          <div className="route-map-frame">
            <RouteMap
              lines={lines}
              selected={all.length ? shown : 0}
              markers={markers}
              onSelect={(i) => all[i] && setSelected(all[i].key)}
              placing={placing}
              onPlace={placePoint}
              onMove={movePoint}
              fitKey={fitKey}
              label="Itinéraires proposés pour ce trajet"
            />
            {/* Placer un point de passage : bouton rond posé sur la carte (le retoucher annule). */}
            {(options || failed) && !draft && (
              <button
                type="button"
                className={`map-image-btn route-place-btn${placing ? ' active' : ''}`}
                aria-label={placing ? 'Annuler le point' : 'Placer un point de passage'}
                aria-pressed={placing}
                title={placing ? 'Annuler le point' : 'Placer un point de passage'}
                onClick={() => setPlacing((p) => !p)}
                disabled={viaState === 'busy'}
              >
                {placing ? <X size={18} /> : <MapPinPlus size={18} />}
              </button>
            )}
          </div>
          <p className={`hint route-map-hint${placing ? ' placing' : ''}`}>
            {placing
              ? 'Touche la carte à l’endroit voulu (zoome d’abord pour viser juste) ; la croix annule.'
              : ordered.some((v) => v.kind === 'point')
                ? 'Fais glisser un point blanc pour l’ajuster ; touche un tracé pour le choisir.'
                : 'Zoome et déplace la carte ; touche un tracé pour le choisir.'}
          </p>

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
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={i === shown}
                  className={`route-option ${i === shown ? 'selected' : ''}`}
                  onClick={() => setSelected(o.key)}
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

          {/* Points de passage imposés, du départ vers l'arrivée. */}
          {ordered.length > 0 && (
            <div className="route-vias">
              <span className="hint">Passage par :</span>
              {ordered.map((v) => (
                <span key={v.id} className="route-via">
                  {v.kind === 'city' ? v.display : v.name ? `Point près de ${v.name}` : 'Point placé'}
                  <button type="button" aria-label="Retirer ce point de passage" onClick={() => removeVia(v.id)}>
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {viaState === 'busy' && (
            <p className="reading">
              <LoaderCircle size={16} className="spin" />
              Calcul de l’itinéraire par ces points de passage…
            </p>
          )}
          {viaState === 'failed' && (
            <p className="reading reading-error">
              Aucun itinéraire trouvé par ces points de passage : déplace-les ou réessaie plus tard.
            </p>
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
                onClick={() => {
                  setPlacing(false);
                  setDraft(EMPTY_PLACE);
                }}
                disabled={viaState === 'busy'}
              >
                <Search size={18} />
                {hasCity ? 'Ajouter une autre ville' : 'Passer par une ville…'}
              </button>
            )
          )}

          {options && options.length === 1 && !vias.length && !savedListed && (
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
