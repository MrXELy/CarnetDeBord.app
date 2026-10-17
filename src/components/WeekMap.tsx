import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Download, LoaderCircle, Route, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { CITIES } from '../assets/cities';
import departements from '../assets/departements.json';
import france from '../assets/france.json';
import { summarizeDay, summarizeWeek, timeLabel, weekLabel } from '../lib/dates';
import { formatPlace, resolveCity } from '../lib/geo';
import { routeLeg, simplify } from '../lib/route';
import { updateSettings, useSettings } from '../lib/settings';
import { useEvents } from '../lib/useEvents';
import { useModal } from '../lib/useModal';
import { buildStops, dayColor, dayKey, dayLegs, stopsHash, type Stop } from '../lib/weekStops';
import { eventTypeInfo, type Place, type TripEvent, type WeekMap as SavedMap } from '../types';

interface Props {
  start: Date;
  events: TripEvent[];
  onEdit: (event: TripEvent) => void;
  onClose: () => void;
}

type Status = { state: 'idle' } | { state: 'busy'; message: string } | { state: 'error'; message: string };

type Point = [number, number];

/** Projection simple : longitude resserrée selon la latitude moyenne de la France. */
const K = Math.cos((46.5 * Math.PI) / 180);
const project = ([lat, lon]: Point): Point => [lon * K, -lat];

/** Cadre de toute la France métropolitaine (latitude, longitude). */
const FRANCE_BOUNDS: Point[] = [
  [41.3, -5.2],
  [51.1, 9.6],
];

const ringsPath = (rings: [number, number][][]) =>
  rings
    .map((ring) => 'M' + ring.map(([lon, lat]) => project([lat, lon]).map((v) => v.toFixed(3)).join(' ')).join('L') + 'Z')
    .join('');

const FRANCE_PATH = ringsPath(france.rings as [number, number][][]);
const DEPARTEMENTS_PATH = ringsPath(departements.rings as [number, number][][]);

type Rect = [number, number, number, number]; // gauche, haut, droite, bas
const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Villes repères visibles dans le cadre : les plus grandes toujours, les autres quand on est plus près.
 * L'étiquette passe à gauche du point si elle déborderait à droite ; une ville dont l'étiquette
 * chevaucherait un repère d'étape ou une autre ville n'est pas affichée.
 */
function landmarks(box: { x: number; y: number; width: number; height: number }, taken: Point[], unit: number) {
  const maxRank = box.width < 4 ? 3 : box.width < 7 ? 2 : 1;
  const blocked: Rect[] = taken.map(([x, y]) => [x - unit * 14, y - unit * 11, x + unit * 14, y + unit * 11]);
  const shown: { name: string; at: Point; left: boolean }[] = [];
  for (const c of [...CITIES].sort((a, b) => a.rank - b.rank)) {
    if (c.rank > maxRank) continue;
    const at = project([c.lat, c.lon]);
    if (at[0] < box.x || at[0] > box.x + box.width || at[1] < box.y || at[1] > box.y + box.height) continue;
    const textWidth = unit * (c.name.length * 5.3 + 6);
    const left = at[0] + textWidth > box.x + box.width;
    const rect: Rect = left
      ? [at[0] - textWidth, at[1] - unit * 7, at[0] + unit * 3, at[1] + unit * 7]
      : [at[0] - unit * 3, at[1] - unit * 7, at[0] + textWidth, at[1] + unit * 7];
    if (rect[0] < box.x || blocked.some((b) => overlaps(b, rect))) continue;
    blocked.push(rect);
    shown.push({ name: c.name, at, left });
  }
  return shown;
}

const shortDay = (day: string) => {
  const s = format(parseISO(day), 'EEE d', { locale: fr }).replace('.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Identifiant fixe de la carte d'une semaine : une seule carte par semaine, même sur deux appareils. */
function weekMapId(userId: string, start: Date): string {
  const text = `${userId}|${start.toISOString()}`;
  let hex = '';
  for (let seed = 1; hex.length < 32; seed++) {
    let h = 2166136261 ^ seed;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    hex += (h >>> 0).toString(16).padStart(8, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Points le long d'un tracé (à 30 % et 70 % de sa longueur) avec l'angle du trajet, pour les flèches. */
function arrowsAlong(coords: Point[]): { at: Point; angle: number }[] {
  const pts = coords.map(project);
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = lengths.at(-1)!;
  if (!total) return [];
  return [0.3, 0.7].map((f) => {
    const target = total * f;
    const i = Math.max(1, lengths.findIndex((l) => l >= target));
    const [a, b] = [pts[i - 1], pts[i]];
    const t = (target - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
    return {
      at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
    };
  });
}

/** Cadre de la carte : tous les points, avec une marge, au format presque carré. */
function viewBox(points: Point[]) {
  const pts = (points.length ? points : FRANCE_BOUNDS).map(project);
  let [minX, minY] = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))];
  let [maxX, maxY] = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  // Marge de 12 %, et au moins 1,5° de côté pour garder un repère autour d'une seule ville.
  const pad = Math.max(maxX - minX, maxY - minY) * 0.12;
  let width = Math.max(maxX - minX + 2 * pad, 1.5);
  let height = Math.max(maxY - minY + 2 * pad, 1.5);
  // Forme adaptée au parcours, entre « paysage » (4:3) et « portrait » (3:4).
  if (width / height > 4 / 3) height = (width * 3) / 4;
  if (height / width > 4 / 3) width = (height * 3) / 4;
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * Repères de la carte : les lieux qui se toucheraient à l'écran (même endroit, ou villes voisines
 * à cette échelle) partagent un repère avec tous leurs numéros (« 2·7 ») ; la liste détaille chaque lieu.
 */
function pins(stops: Stop[], minGap: number) {
  const result: { at: Point; numbers: number[]; color: string; approximate: boolean }[] = [];
  for (const s of stops) {
    const at = project([s.lat, s.lon]);
    const near = result.find((p) => Math.hypot(p.at[0] - at[0], p.at[1] - at[1]) < minGap);
    if (near) {
      near.numbers.push(s.number);
      near.approximate ||= s.approximate;
    } else result.push({ at, numbers: [s.number], color: s.color, approximate: s.approximate });
  }
  return result;
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
  const unit = box.width / 340; // taille d'un « pixel » de la carte affichée sur un téléphone
  const pinList = pins(stops, unit * 16);

  const days = [...new Set(stops.map((s) => s.day))].sort();
  const dayKm = (day: string) => summarizeDay(events.filter((e) => !e.deleted_at && dayKey(e.occurred_at) === day)).km;
  const weekKm = summarizeWeek(events).km;

  async function generate() {
    if (!navigator.onLine) return setStatus({ state: 'error', message: 'Pas de réseau : réessaie plus tard.' });
    try {
      // 1. Étapes sans position : on cherche leur ville (centre de la commune).
      const resolved = new Map(found);
      const toFind = missing.filter((e) => e.city.trim() && !resolved.has(e.id));
      for (const [i, e] of toFind.entries()) {
        setStatus({ state: 'busy', message: `Recherche des villes sans position (${i + 1}/${toFind.length})…` });
        const place = await resolveCity(e.city, e.department);
        if (place?.lat != null && place.lon != null) {
          resolved.set(e.id, place);
          store.completePlace(e.id, place); // enregistrée : pas de nouvelle recherche la prochaine fois
        }
      }
      setFound(resolved);

      // 2. Itinéraires, jour après jour.
      const finalStops = buildStops(events, resolved).stops;
      const finalLegs = dayLegs(finalStops);
      const routed: SavedMap['legs'] = [];
      for (const [i, leg] of finalLegs.entries()) {
        setStatus({ state: 'busy', message: `Calcul des itinéraires (${i + 1}/${finalLegs.length})…` });
        const coords = await routeLeg(leg.points);
        if (!coords) {
          return setStatus({ state: 'error', message: 'Itinéraire indisponible : réessaie plus tard.' });
        }
        routed.push({ day: leg.day, coords: simplify(coords) });
      }

      // 3. Carte enregistrée : elle s'affichera ensuite sans aucun calcul, sur tous les appareils.
      store.saveWeekMap({
        id: saved?.id ?? weekMapId(store.userId, start),
        week_start: start.toISOString(),
        stops_hash: stopsHash(finalStops),
        legs: routed,
        generated_at: new Date().toISOString(),
        updated_at: '',
        deleted_at: null,
      });
      setStatus({ state: 'idle' });
    } catch {
      setStatus({ state: 'error', message: 'Itinéraire indisponible : réessaie plus tard.' });
    }
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
      const file = new File([blob], `carte-${format(start, 'yyyy')}-semaine-${weekLabel(start).match(/\d+/)?.[0]}.png`, {
        type: 'image/png',
      });
      const phone = matchMedia('(pointer: coarse)').matches;
      if (phone && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: weekLabel(start) });
      else {
        const url = URL.createObjectURL(file);
        const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
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

              <svg
                ref={svgRef}
                className="week-map"
                xmlns="http://www.w3.org/2000/svg"
                viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
                role="img"
                aria-label={`Carte des trajets de la ${weekLabel(start)}`}
              >
                <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="#0b0d11" />
                <path d={FRANCE_PATH} fill="#1a1f28" />
                {mapDepartments && (
                  <path d={DEPARTEMENTS_PATH} fill="none" stroke="#2b3240" strokeWidth={unit * 0.7} strokeLinejoin="round" />
                )}
                <path d={FRANCE_PATH} fill="none" stroke="#3f4858" strokeWidth={unit * 1.2} strokeLinejoin="round" />
                {(mapCities ? landmarks(box, pinList.map((p) => p.at), unit) : []).map((c) => (
                  <g key={c.name}>
                    <circle cx={c.at[0]} cy={c.at[1]} r={unit * 2.2} fill="#7c8596" />
                    <text
                      x={c.at[0] + (c.left ? -unit * 4.5 : unit * 4.5)}
                      y={c.at[1]}
                      dy="0.35em"
                      textAnchor={c.left ? 'end' : 'start'}
                      fontSize={unit * 9}
                      fontFamily="system-ui, sans-serif"
                      fill="#9aa3b2"
                      stroke="#1a1f28"
                      strokeWidth={unit * 2.5}
                      paintOrder="stroke"
                    >
                      {c.name}
                    </text>
                  </g>
                ))}
                {legs.map((leg, i) => (
                  <g key={i}>
                    <polyline
                      points={leg.coords.map((c) => project(c).join(',')).join(' ')}
                      fill="none"
                      stroke={leg.color}
                      strokeWidth={unit * 3}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={0.95}
                    />
                    {arrowsAlong(leg.coords).map((a, j) => (
                      <path
                        key={j}
                        d={`M ${-unit * 6} ${-unit * 6} L ${unit * 6} 0 L ${-unit * 6} ${unit * 6} Z`}
                        transform={`translate(${a.at[0]} ${a.at[1]}) rotate(${a.angle})`}
                        fill={leg.color}
                        stroke="#0b0d11"
                        strokeWidth={unit * 1.5}
                        strokeLinejoin="round"
                      />
                    ))}
                  </g>
                ))}
                {pinList.map((pin) => {
                  const [x, y] = pin.at;
                  const label = pin.numbers.join('·');
                  // Pastille ronde pour un numéro, allongée pour plusieurs passages.
                  const w = unit * Math.max(18, 6.5 * label.length + 8);
                  const h = unit * 18;
                  return (
                    <g key={label}>
                      <rect
                        x={x - w / 2}
                        y={y - h / 2}
                        width={w}
                        height={h}
                        rx={h / 2}
                        fill={pin.color}
                        stroke={pin.approximate ? '#e8eaed' : '#0b0d11'}
                        strokeWidth={unit * 2}
                        strokeDasharray={pin.approximate ? `${unit * 3} ${unit * 2}` : undefined}
                      />
                      <text
                        x={x}
                        y={y}
                        dy="0.35em"
                        textAnchor="middle"
                        fontSize={unit * 10.5}
                        fontWeight={700}
                        fontFamily="system-ui, sans-serif"
                        fill="#0b0d11"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
              </svg>

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

/** Image PNG de la carte : titre, carte et légende, pour la partager ou la garder. */
async function renderImage(svg: SVGSVGElement, title: string, lines: string[], colors: string[]): Promise<Blob> {
  const W = 1080;
  const ratio = svg.viewBox.baseVal.height / svg.viewBox.baseVal.width;
  const mapH = Math.round(W * ratio);
  const H = 120 + mapH + 70 + Math.ceil((lines.length - 1) / 3) * 56 + 40;
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0f1115';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#e8eaed';
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.fillText(title, 40, 75);

  const source = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  await img.decode();
  ctx.drawImage(img, 0, 110, W, mapH);

  let y = 110 + mapH + 60;
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.fillText(lines[0], 40, y);
  ctx.font = '30px system-ui, sans-serif';
  lines.slice(1).forEach((line, i) => {
    const x = 40 + (i % 3) * 340;
    if (i % 3 === 0) y += 56;
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.arc(x + 12, y - 10, 12, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#e8eaed';
    ctx.fillText(line, x + 34, y);
  });

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image impossible'))), 'image/png'),
  );
}
