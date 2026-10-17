import { forwardRef } from 'react';
import { CITIES } from '../assets/cities';
import departements from '../assets/departements.json';
import france from '../assets/france.json';

export type Point = [number, number];

/** Projection simple : longitude resserrée selon la latitude moyenne de la France. */
const K = Math.cos((46.5 * Math.PI) / 180);
export const project = ([lat, lon]: Point): Point => [lon * K, -lat];

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

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Villes repères visibles dans le cadre : les plus grandes toujours, les autres quand on est plus près.
 * L'étiquette passe à gauche du point si elle déborderait à droite ; une ville dont l'étiquette
 * chevaucherait un repère d'étape ou une autre ville n'est pas affichée.
 */
function landmarks(box: Box, taken: Point[], unit: number, gap: number) {
  const maxRank = box.width < 4 ? 3 : box.width < 7 ? 2 : 1;
  const blocked: Rect[] = taken.map(([x, y]) => [x - unit * gap, y - unit * gap * 0.8, x + unit * gap, y + unit * gap * 0.8]);
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
export function viewBox(points: Point[]): Box {
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

/** Taille d'un « pixel » de la carte affichée sur un téléphone. */
export const mapUnit = (box: Box) => box.width / 340;

export interface MapLine {
  color: string;
  coords: Point[];
}

/** Repère d'un lieu, déjà projeté : pastille numérotée avec `label`, simple point sans. */
export interface MapPin {
  at: Point;
  label?: string;
  color: string;
  approximate: boolean;
}

interface Props {
  box: Box;
  lines: MapLine[];
  pins: MapPin[];
  /** Flèches de sens sur chaque tracé. */
  arrows: boolean;
  cities: boolean;
  departments: boolean;
  label: string;
}

/** Fond de carte (France, départements, villes repères), tracés et repères des lieux. */
const MapSvg = forwardRef<SVGSVGElement, Props>(function MapSvg(
  { box, lines, pins, arrows, cities, departments, label },
  ref,
) {
  const unit = mapUnit(box);
  // Les points sans numéro sont plus petits : les villes repères peuvent s'en approcher davantage.
  const numbered = pins.some((p) => p.label);
  return (
    <svg
      ref={ref}
      className="week-map"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      role="img"
      aria-label={label}
    >
      <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="#0b0d11" />
      <path d={FRANCE_PATH} fill="#1a1f28" />
      {departments && (
        <path d={DEPARTEMENTS_PATH} fill="none" stroke="#2b3240" strokeWidth={unit * 0.7} strokeLinejoin="round" />
      )}
      <path d={FRANCE_PATH} fill="none" stroke="#3f4858" strokeWidth={unit * 1.2} strokeLinejoin="round" />
      {(cities ? landmarks(box, pins.map((p) => p.at), unit, numbered ? 14 : 7) : []).map((c) => (
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
      {lines.map((line, i) => (
        <g key={i}>
          <polyline
            points={line.coords.map((c) => project(c).join(',')).join(' ')}
            fill="none"
            stroke={line.color}
            strokeWidth={unit * (arrows ? 3 : 2.4)}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.95}
          />
          {arrows &&
            arrowsAlong(line.coords).map((a, j) => (
              <path
                key={j}
                d={`M ${-unit * 6} ${-unit * 6} L ${unit * 6} 0 L ${-unit * 6} ${unit * 6} Z`}
                transform={`translate(${a.at[0]} ${a.at[1]}) rotate(${a.angle})`}
                fill={line.color}
                stroke="#0b0d11"
                strokeWidth={unit * 1.5}
                strokeLinejoin="round"
              />
            ))}
        </g>
      ))}
      {pins.map((pin, i) => {
        const [x, y] = pin.at;
        const stroke = pin.approximate ? '#e8eaed' : '#0b0d11';
        if (!pin.label) {
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={unit * 4.5}
              fill={pin.color}
              stroke={stroke}
              strokeWidth={unit * 1.5}
              strokeDasharray={pin.approximate ? `${unit * 2} ${unit * 1.5}` : undefined}
            />
          );
        }
        // Pastille ronde pour un numéro, allongée pour plusieurs passages.
        const w = unit * Math.max(18, 6.5 * pin.label.length + 8);
        const h = unit * 18;
        return (
          <g key={i}>
            <rect
              x={x - w / 2}
              y={y - h / 2}
              width={w}
              height={h}
              rx={h / 2}
              fill={pin.color}
              stroke={stroke}
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
              {pin.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
});

export default MapSvg;

/** Image PNG de la carte : titre, carte et légende, pour la partager ou la garder. */
export async function renderImage(svg: SVGSVGElement, title: string, lines: string[], colors: string[]): Promise<Blob> {
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

/** Partage l'image sur téléphone, la télécharge sur ordinateur (partage annulé : AbortError). */
export async function shareImage(blob: Blob, name: string, title: string): Promise<void> {
  const file = new File([blob], name, { type: 'image/png' });
  const phone = matchMedia('(pointer: coarse)').matches;
  if (phone && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
  else {
    const url = URL.createObjectURL(file);
    const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
