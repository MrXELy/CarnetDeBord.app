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

/** Rectangle à l'écran : gauche, haut, droite, bas (pixels). */
export type Rect = [number, number, number, number];

const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Nom comparé sans accents ni majuscules : « Béziers » et « BEZIERS » sont la même ville. */
const nameKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/** Nom d'une ville atteinte, posé à côté de son point. */
export interface StopLabel {
  name: string;
  /** Point du lieu, à l'écran. */
  at: Point;
  /** Texte à droite du point, ou à gauche (bord de l'image, ou place prise). */
  left: boolean;
  rect: Rect;
}

/**
 * Noms des villes atteintes : chaque ville une seule fois (au passage le plus récent), sans chevauchement,
 * les plus récentes d'abord (le lieu où vient d'arriver le camion a toujours son nom, s'il tient dans l'image).
 * `stops` dans l'ordre où ils sont atteints ; `measure` donne la largeur d'un texte en pixels.
 */
export function placeLabels(
  stops: { name: string; at: Point }[],
  measure: (text: string) => number,
  area: { width: number; top: number; bottom: number },
  height = 32,
): StopLabel[] {
  const dots: Rect[] = stops.map(({ at: [x, y] }) => [x - 12, y - 12, x + 12, y + 12]);
  const placed: StopLabel[] = [];
  const seen = new Set<string>();
  for (let i = stops.length - 1; i >= 0; i--) {
    const { name, at } = stops[i];
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const [x, y] = at;
    if (y < area.top || y > area.bottom) continue;
    const w = measure(name);
    const gap = 18;
    const others = dots.filter((_, j) => j !== i);
    const fits = (rect: Rect) =>
      rect[0] >= 0 &&
      rect[2] <= area.width &&
      !placed.some((p) => overlaps(rect, p.rect)) &&
      !others.some((d) => overlaps(rect, d));
    const right: Rect = [x + gap - 4, y - height / 2, x + gap + w + 4, y + height / 2];
    const left: Rect = [x - gap - w - 4, y - height / 2, x - gap + 4, y + height / 2];
    if (fits(right)) placed.push({ name, at, left: false, rect: right });
    else if (fits(left)) placed.push({ name, at, left: true, rect: left });
  }
  return placed;
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
  taken: Rect[],
  named: Set<string>,
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
  const blocked = [...taken];
  ctx.font = `600 26px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const c of [...CITIES].sort((a, b) => a.rank - b.rank)) {
    // Ville déjà écrite à côté d'un lieu atteint : pas deux fois.
    if (c.rank > maxRank || named.has(nameKey(c.name))) continue;
    const [x, y] = toXY([c.lat, c.lon]);
    const w = ctx.measureText(c.name).width + 16;
    const left = x + w > width;
    const rect: Rect = left ? [x - w, y - 16, x + 6, y + 16] : [x - 6, y - 16, x + w, y + 16];
    if (rect[0] < 0 || y < top || y > top + box.height * scale) continue;
    if (blocked.some((b) => overlaps(rect, b))) continue;
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
  /** Opacité des noms des villes atteintes (ils s'effacent pendant le dézoom final). */
  labelAlpha = 1,
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
  const labelFont = `700 ${vertical ? 32 : 28}px ${FONT}`;
  ctx.font = labelFont;
  const labels =
    labelAlpha > 0
      ? placeLabels(
          reached.map((s) => ({ name: s.events[0].city.trim(), at: toXY([s.lat, s.lon]) })),
          (text) => ctx.measureText(text).width,
          { width: W, top, bottom: top + mapHeight },
        )
      : [];
  // Villes repères : à l'écart des lieux atteints et de leurs noms.
  drawBackground(
    ctx,
    box,
    top,
    W,
    background,
    [
      ...reached.map((s): Rect => {
        const [x, y] = toXY([s.lat, s.lon]);
        return [x - 26, y - 22, x + 26, y + 22];
      }),
      ...labels.map((l) => l.rect),
    ],
    new Set(labels.map((l) => nameKey(l.name))),
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
  // Noms des villes atteintes, à côté de leur point.
  if (labels.length) {
    ctx.globalAlpha = labelAlpha;
    ctx.font = labelFont;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#0b0d11';
    ctx.fillStyle = '#e8eaed';
    for (const l of labels) {
      const [x, y] = l.at;
      ctx.textAlign = l.left ? 'right' : 'left';
      const tx = x + (l.left ? -18 : 18);
      ctx.strokeText(l.name, tx, y);
      ctx.fillText(l.name, tx, y);
    }
    ctx.globalAlpha = 1;
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
