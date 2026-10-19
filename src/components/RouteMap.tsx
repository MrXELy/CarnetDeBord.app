import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
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
  /** Numéro de l'étape (pastille de couleur) ; sans numéro : petit point blanc (ville de passage). */
  label?: string;
  color?: string;
}

interface Props {
  lines: RouteLine[];
  /** Ligne mise en avant (dessinée par-dessus, plus épaisse). */
  selected: number;
  markers: RouteMarker[];
  onSelect: (index: number) => void;
  /** Le cadre se recale sur les tracés quand cette clé change (nouveaux itinéraires, villes de passage). */
  fitKey: string;
  label: string;
}

/** Carte navigable (zoom, déplacement) des itinéraires d'un tronçon, sur le Plan IGN. */
export default function RouteMap({ lines, selected, markers, onSelect, fitKey, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  // Carte créée une seule fois, retirée à la fermeture de la fenêtre.
  useEffect(() => {
    const m = L.map(box.current!, { zoomSnap: 0.5, attributionControl: false });
    L.control.attribution({ prefix: false }).addTo(m);
    L.tileLayer(PLAN_IGN, { minZoom: 5, maxZoom: 18, attribution: ATTRIBUTION }).addTo(m);
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
        .on('click', () => select.current(i))
        .addTo(group);
    }
    for (const m of markers) {
      const icon = m.label
        ? L.divIcon({
            className: 'route-map-pin',
            html: `<span style="background:${m.color}">${m.label}</span>`,
            iconSize: [26, 26],
          })
        : L.divIcon({ className: 'route-map-via', iconSize: [14, 14] });
      L.marker(m.at, { icon, keyboard: false, interactive: false }).addTo(group);
    }
  }, [lines, selected, markers]);

  // Cadre recalé sur tous les tracés et repères (pas à chaque choix : le zoom de l'utilisateur est gardé).
  useEffect(() => {
    const m = map.current;
    const points = [...lines.flatMap((l) => l.coords), ...markers.map((p) => p.at)];
    if (!m || !points.length) return;
    m.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={box} className="route-map" role="img" aria-label={label} />;
}
