import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { project, type Box, type Point } from '../components/MapSvg';
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

/**
 * Dessine une image de l'animation : fond (carte sans tracés, déjà dessinée), trajets parcourus, lieux atteints,
 * camion, jour, heure, km et étape en cours. `progress` (0 à 1) remplit la barre du bas.
 */
export function drawReplayFrame(
  ctx: CanvasRenderingContext2D,
  fmt: ReplayFormat,
  title: string,
  box: Box,
  background: CanvasImageSource | null,
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
  if (background) ctx.drawImage(background, 0, top, W, mapHeight);
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
  for (const stop of replay.stops.slice(0, frame.stopsReached)) {
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

/** Image du fond de carte (dessin SVG sans tracés), à la taille voulue, pour la dessiner à chaque image. */
export async function svgImage(svg: SVGSVGElement, width: number, height: number): Promise<HTMLImageElement> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('width', String(width)); // sans taille, le dessin serait flou une fois agrandi
  copy.setAttribute('height', String(height));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  await img.decode();
  return img;
}
