import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { tapRadius } from '../lib/route';
import type { Point } from './MapSvg';

/**
 * Fond Plan IGN (Géoplateforme, tuiles WMTS) : sans compte ni clé, pas de limite de demandes pour les tuiles,
 * Licence Ouverte Etalab (mention de l'IGN obligatoire). Seulement les tuiles affichées, jamais de préchargement.
 */
const PLAN_IGN =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2' +
  '&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';

const ATTRIBUTION =
  'Fond <a href="https://www.ign.fr" target="_blank" rel="noreferrer">Plan IGN</a> · Itinéraires © ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> ' +
  '(<a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">signaler une erreur</a>)';

export interface RouteLine {
  color: string;
  coords: Point[];
}

export interface RouteMarker {
  at: Point;
  /** Numéro de l'étape (pastille de couleur) ; sans numéro : point blanc (point de passage). */
  label?: string;
  color?: string;
  /** Point placé à la main : déplaçable au doigt (son identifiant est rendu par `onMove`). */
  movable?: string;
}

interface Props {
  lines: RouteLine[];
  /** Ligne mise en avant (dessinée par-dessus, plus épaisse). */
  selected: number;
  markers: RouteMarker[];
  onSelect: (index: number) => void;
  /** Mode « placer un point » : le prochain toucher sur la carte place un point de passage. */
  placing: boolean;
  /** Point touché, avec le rayon de recherche de la route (précision du doigt au zoom affiché). */
  onPlace: (at: Point, radius: number) => void;
  /** Point de passage déplacé (lâché à un nouvel endroit). */
  onMove: (id: string, at: Point, radius: number) => void;
  /** Le cadre se recale sur les tracés quand cette clé change (nouveaux itinéraires, villes de passage). */
  fitKey: string;
  label: string;
}

/** Carte navigable (zoom, déplacement) des itinéraires d'un tronçon, sur le Plan IGN. */
export default function RouteMap({
  lines,
  selected,
  markers,
  onSelect,
  placing,
  onPlace,
  onMove,
  fitKey,
  label,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  // Dernières valeurs, lues par les gestionnaires de Leaflet (posés une seule fois).
  const latest = useRef({ onSelect, onPlace, onMove, placing });
  latest.current = { onSelect, onPlace, onMove, placing };

  // Carte créée une seule fois, retirée à la fermeture de la fenêtre.
  useEffect(() => {
    const m = L.map(box.current!, { zoomSnap: 0.5, attributionControl: false });
    L.control.attribution({ prefix: false }).addTo(m);
    L.tileLayer(PLAN_IGN, { minZoom: 5, maxZoom: 18, attribution: ATTRIBUTION }).addTo(m);
    // Toucher la carte (pas un glissement) en mode « placer un point ».
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (!latest.current.placing) return;
      latest.current.onPlace([e.latlng.lat, e.latlng.lng], tapRadius(e.latlng.lat, m.getZoom()));
    });
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Tracés et repères : redessinés à chaque changement (le choisi par-dessus, les autres en transparence).
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    const order = lines.map((_, i) => i).sort((a, b) => Number(a === selected) - Number(b === selected));
    for (const i of order) {
      const chosen = i === selected;
      // Contour sombre sous le tracé : lisible sur le fond clair du Plan IGN.
      L.polyline(lines[i].coords, { color: '#0b0d11', weight: chosen ? 9 : 7, opacity: chosen ? 0.55 : 0.25 }).addTo(
        group,
      );
      L.polyline(lines[i].coords, { color: lines[i].color, weight: chosen ? 6 : 4, opacity: chosen ? 1 : 0.6 })
        // En mode « placer un point », le toucher remonte à la carte et place le point.
        .on('click', () => !latest.current.placing && latest.current.onSelect(i))
        .addTo(group);
    }
    for (const p of markers) {
      const icon = p.label
        ? L.divIcon({
            className: 'route-map-pin',
            html: `<span style="background:${p.color}">${p.label}</span>`,
            iconSize: [26, 26],
          })
        : L.divIcon({
            className: `route-map-via${p.movable ? ' movable' : ''}`,
            iconSize: p.movable ? [22, 22] : [14, 14],
          });
      const marker = L.marker(p.at, { icon, keyboard: false, interactive: !!p.movable, draggable: !!p.movable });
      if (p.movable) {
        const id = p.movable;
        marker.on('dragend', () => {
          const at = marker.getLatLng();
          latest.current.onMove(id, [at.lat, at.lng], tapRadius(at.lat, map.current?.getZoom() ?? 12));
        });
      }
      marker.addTo(group);
    }
  }, [lines, selected, markers]);

  // Cadre recalé sur tous les tracés et repères (pas à chaque choix : le zoom de l'utilisateur est gardé).
  useEffect(() => {
    const m = map.current;
    const points = [...lines.flatMap((l) => l.coords), ...markers.map((p) => p.at)];
    if (!m || !points.length) return;
    // Marge du bas plus grande : la mention des sources ne cache pas une étape.
    m.fitBounds(L.latLngBounds(points), { paddingTopLeft: [24, 24], paddingBottomRight: [24, 44] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={box} className={`route-map${placing ? ' placing' : ''}`} role="img" aria-label={label} />;
}
