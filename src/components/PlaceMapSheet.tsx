import { Check, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { communeAt, placeFromCommune, resolveCity, sameCity, type Commune } from '../lib/geo';
import { useSheet } from '../lib/useSheet';
import type { Place } from '../types';
import type { Point } from './MapSvg';
import RouteMap, { type RouteMarker } from './RouteMap';

interface Props {
  place: Place;
  /** Lieu validé : même ville avec le nouveau point, ou la commune du point si l'utilisateur l'a choisie. */
  onChoose: (place: Place) => void;
  onClose: () => void;
}

/** Replacer à la main le point GPS d'une étape sur la carte (glisser le point, ou toucher la carte). */
export default function PlaceMapSheet({ place, onChoose, onClose }: Props) {
  const sheet = useSheet(onClose);
  const [at, setAt] = useState<Point | null>(place.lat != null && place.lon != null ? [place.lat, place.lon] : null);
  const [moved, setMoved] = useState(false);
  const [fitKey, setFitKey] = useState('start');
  // Commune du point déplacé (null : pas encore connue, hors de France ou introuvable).
  const [commune, setCommune] = useState<Commune | null>(null);
  const [looking, setLooking] = useState(false);
  const request = useRef(0);

  // Étape sans GPS (ville tapée à la main) : on part du centre de sa ville.
  useEffect(() => {
    if (at || !place.city.trim()) return;
    void resolveCity(place.city, place.department).then((found) => {
      if (found?.lat == null || found.lon == null) return;
      setAt((current) => current ?? [found.lat!, found.lon!]);
      setFitKey('city');
    });
    // Uniquement à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function put(p: Point) {
    setAt(p);
    setMoved(true);
    setCommune(null);
    setLooking(true);
    const id = ++request.current;
    void communeAt(p[0], p[1]).then((c) => {
      // Point redéplacé entre-temps : seule la dernière réponse compte.
      if (id !== request.current) return;
      setCommune(c);
      setLooking(false);
    });
  }

  const markers = useMemo<RouteMarker[]>(() => (at ? [{ at, movable: 'lieu' }] : []), [at]);
  const otherCity = commune && !sameCity(commune.nom, place.city) ? commune.nom : null;

  function choose(rename: boolean) {
    if (!at) return;
    const base = rename && commune ? placeFromCommune(commune) : place;
    onChoose({ ...base, lat: at[0], lon: at[1] });
    sheet.close();
  }

  return (
    <div className="modal-backdrop" ref={sheet.ref} onClick={sheet.close}>
      <div className="modal map-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header" {...sheet.handle}>
          <button type="button" className="icon-btn" onClick={sheet.close} aria-label="Fermer">
            <X size={22} />
          </button>
          <h2>Placer sur la carte</h2>
        </header>

        <div className="modal-body">
          <RouteMap
            lines={[]}
            selected={0}
            markers={markers}
            onSelect={() => {}}
            placing
            onPlace={put}
            onMove={(_, p) => put(p)}
            fitKey={fitKey}
            label="Carte du lieu de l’étape"
          />
          <p className="hint route-map-hint">
            {at ? 'Fais glisser le point, ou touche la carte pour le poser.' : 'Touche la carte pour poser le point.'}
          </p>

          {otherCity ? (
            <>
              <p className="place-map-question">
                Ce point est à <strong>{otherCity}</strong>. Mettre {otherCity} à la place de{' '}
                {place.city.trim() || 'ce lieu'} ?
              </p>
              <div className="place-map-actions">
                {place.city.trim() && (
                  <button type="button" className="btn-secondary" onClick={() => choose(false)}>
                    Garder {place.city.trim()}
                  </button>
                )}
                <button type="button" className="btn-primary" onClick={() => choose(true)}>
                  Mettre {otherCity}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="btn-primary btn-icon lv-add map-generate"
              onClick={() => choose(false)}
              disabled={!at || !moved || looking}
            >
              <Check size={18} />
              Valider ce point
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
