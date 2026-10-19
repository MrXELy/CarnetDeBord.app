import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CITIES } from '../assets/cities';
import { DEPARTEMENTS_PATH, FRANCE_PATH, project, type Box, type Point } from '../components/MapSvg';
import type { Replay, ReplayFrame } from './weekReplay';
import { dayColor } from './weekStops';

/** Format de l'animation (et de la vidéo) : carré, ou vertical pour le plein écran du téléphone. */
export type ReplayFormat = 'square' | 'vertical';

/** Taille de l'image et place de la carte : bandeau du haut (jour, heure), carte, bandeau du bas (km, étape). */
export function replayLayout(fmt: ReplayFormat) {
  return fmt === 'vertical'
    ? { width: 1080, height: 1920, top: 300, mapHeight: 1300 }
    : { width: 1080, height: 1080, top: 150, mapHeight: 760 };
}

/** Cadre de la carte : tous les trajets et lieux, élargi à la forme de la zone de la carte. */
export function replayBox(replay: Replay, fmt: ReplayFormat): Box {
  const points: Point[] = [
    ...replay.stops.map((s): Point => [s.lat, s.lon]),
    ...replay.drives.flatMap((d) => d.coords),
  ];
  const projected = points.map(project);
  const [minX, maxX] = [Math.min(...projected.map((p) => p[0])), Math.max(...projected.map((p) => p[0]))];
  const [minY, maxY] = [Math.min(...projected.map((p) => p[1])), Math.max(...projected.map((p) => p[1]))];
  // Marge de 10 %, et au moins 1° de côté autour d'un trajet très court.
  const pad = Math.max(maxX - minX, maxY - minY) * 0.1;
  const { width, mapHeight } = replayLayout(fmt);
  const ratio = width / mapHeight;
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const w = Math.max(maxX - minX + 2 * pad, (maxY - minY + 2 * pad) * ratio, 1);
  const h = w / ratio;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

const FONT = '"Manrope Variable", system-ui, sans-serif';

/** « Mardi 27 janvier » */
function dayTitle(day: string): string {
  const s = format(parseISO(day), 'EEEE d MMMM', { locale: fr });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Contours de la France et des départements, préparés une fois (dessin vectoriel : net à tous les zooms). */
let shapes: { france: Path2D; departments: Path2D } | null = null;

/** Réglages du fond, comme sur la carte de la semaine. */
export interface ReplayBackground {
  cities: boolean;
  departments: boolean;
}

/**
 * Fond de carte dessiné à chaque image dans le cadre `box` (vue de la caméra) : France, départements, villes repères
 * (les plus grandes de loin, d'autres en s'approchant ; pas sur les lieux atteints).
 */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  box: Box,
  top: number,
  width: number,
  options: ReplayBackground,
  taken: Point[],
  toXY: (at: Point) => Point,
) {
  shapes ??= { france: new Path2D(FRANCE_PATH), departments: new Path2D(DEPARTEMENTS_PATH) };
  const scale = width / box.width;
  ctx.fillStyle = '#0b0d11';
  ctx.fillRect(0, top, width, box.height * scale);
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, -box.x * scale, top - box.y * scale);
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#1a1f28';
  ctx.fill(shapes.france);
  if (options.departments) {
    ctx.strokeStyle = '#2b3240';
    ctx.lineWidth = 1.6 / scale;
    ctx.stroke(shapes.departments);
  }
  ctx.strokeStyle = '#3f4858';
  ctx.lineWidth = 2.6 / scale;
  ctx.stroke(shapes.france);
  ctx.restore();
  if (!options.cities) return;

  // Villes repères : les plus grandes toujours, les autres quand on est plus près ; sans chevauchement.
  const maxRank = box.width < 4 ? 3 : box.width < 7 ? 2 : 1;
  const blocked: [number, number, number, number][] = taken.map(([x, y]) => [x - 26, y - 22, x + 26, y + 22]);
  ctx.font = `600 26px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const c of [...CITIES].sort((a, b) => a.rank - b.rank)) {
    if (c.rank > maxRank) continue;
    const [x, y] = toXY([c.lat, c.lon]);
    const w = ctx.measureText(c.name).width + 16;
    const left = x + w > width;
    const rect: [number, number, number, number] = left
      ? [x - w, y - 16, x + 6, y + 16]
      : [x - 6, y - 16, x + w, y + 16];
    if (rect[0] < 0 || y < top || y > top + box.height * scale) continue;
    if (blocked.some((b) => rect[0] < b[2] && b[0] < rect[2] && rect[1] < b[3] && b[1] < rect[3])) continue;
    blocked.push(rect);
    ctx.fillStyle = '#7c8596';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#1a1f28';
    ctx.textAlign = left ? 'right' : 'left';
    ctx.strokeText(c.name, x + (left ? -12 : 12), y);
    ctx.fillStyle = '#9aa3b2';
    ctx.fillText(c.name, x + (left ? -12 : 12), y);
  }
}

/**
 * Dessine une image de l'animation dans le cadre `box` (vue de la caméra) : fond de carte, trajets parcourus,
 * lieux atteints, camion, jour, heure, km et étape en cours. `progress` (0 à 1) remplit la barre du bas.
 */
export function drawReplayFrame(
  ctx: CanvasRenderingContext2D,
  fmt: ReplayFormat,
  title: string,
  box: Box,
  background: ReplayBackground,
  replay: Replay,
  frame: ReplayFrame,
  progress: number,
) {
  const { width: W, height: H, top, mapHeight } = replayLayout(fmt);
  const vertical = fmt === 'vertical';
  const toXY = (at: Point): Point => {
    const [x, y] = project(at);
    return [((x - box.x) / box.width) * W, top + ((y - box.y) / box.height) * mapHeight];
  };
  const color = dayColor(frame.day);

  ctx.fillStyle = '#0f1115';
  ctx.fillRect(0, 0, W, H);

  // Carte : fond, trajets, lieux atteints, camion.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, W, mapHeight);
  ctx.clip();
  const reached = replay.stops.slice(0, frame.stopsReached);
  drawBackground(
    ctx,
    box,
    top,
    W,
    background,
    reached.map((s) => toXY([s.lat, s.lon])),
    toXY,
  );
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const line of frame.lines) {
    const pts = line.coords.map(toXY);
    for (const [stroke, lineWidth, alpha] of [
      ['#0b0d11', 13, 0.7],
      [line.color, 7, 1],
    ] as const) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  for (const stop of reached) {
    const [x, y] = toXY([stop.lat, stop.lon]);
    ctx.fillStyle = stop.color;
    ctx.strokeStyle = '#0b0d11';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
  const [tx, ty] = toXY(frame.truck);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.beginPath();
  ctx.arc(tx, ty, 30, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(tx, ty, 14, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  // Nuit : carte assombrie le temps du repos.
  if (frame.kind === 'rest') {
    ctx.fillStyle = 'rgba(5, 6, 10, 0.55)';
    ctx.fillRect(0, top, W, mapHeight);
  }
  ctx.restore();

  // Bandeau du haut : semaine, jour (à sa couleur) et heure.
  const pad = 56;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#8b93a1';
  ctx.font = `600 ${vertical ? 36 : 30}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(title, pad, vertical ? 130 : 56);
  ctx.fillStyle = color;
  ctx.font = `800 ${vertical ? 66 : 52}px ${FONT}`;
  ctx.fillText(dayTitle(frame.day), pad, vertical ? 220 : 120);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#e8eaed';
  ctx.fillText(format(frame.clock, 'HH:mm'), W - pad, vertical ? 220 : 120);

  // Bandeau du bas : km parcourus et étape en cours (ou repos).
  const bottom = top + mapHeight;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8eaed';
  ctx.font = `800 ${vertical ? 96 : 64}px ${FONT}`;
  ctx.fillText(`${Math.round(frame.km).toLocaleString('fr-FR')} km`, pad, bottom + (vertical ? 150 : 85));
  // Étape en clair, repos en bleu, destination du trajet en gris.
  ctx.fillStyle = { stop: '#e8eaed', rest: '#a5b4fc', drive: '#8b93a1' }[frame.kind];
  ctx.font = `600 ${vertical ? 44 : 34}px ${FONT}`;
  ctx.fillText(fitText(ctx, frame.caption, W - 2 * pad), pad, bottom + (vertical ? 235 : 135));

  // Barre d'avancement tout en bas.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(0, H - 10, W, 10);
  ctx.fillStyle = color;
  ctx.fillRect(0, H - 10, W * progress, 10);
}

/** Texte raccourci (« … ») pour tenir dans la largeur. */
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}
