import { project, type Box, type Point } from '../components/MapSvg';
import { truckAt, type Replay } from './weekReplay';

/**
 * Caméra de la semaine rejouée : proche du camion, qu'elle suit en douceur, puis dézoom final sur toute la semaine.
 * Calculée d'après le moment de l'animation (pas au fil de la lecture) : la même image à chaque fois,
 * en lecture comme en déplaçant le curseur ou en enregistrant la vidéo.
 */

/** Dézoom final vers toute la semaine, puis pause sur la carte complète (secondes ajoutées à la fin). */
export const ZOOM_OUT_SECONDS = 2.5;
export const FINAL_HOLD_SECONDS = 2;
export const OUTRO_SECONDS = ZOOM_OUT_SECONDS + FINAL_HOLD_SECONDS;

/** Pas de calcul de la caméra (secondes). */
const TICK = 0.1;
/** Largeur de la vue par défaut pendant la semaine, en km (réglable). */
export const DEFAULT_VIEW_KM = 280;
/** Km par unité de la carte (1 degré de latitude ; les longitudes sont resserrées d'autant). */
const KM_PER_UNIT = 111;
/** La vue couvre le trajet du camion sur ± 2,5 s autour de l'instant (elle recule sur les longs trajets). */
const LOOK_SECONDS = 2.5;
/** Marge autour de ce trajet. */
const MARGIN = 1.35;
/** Lissage : moyenne pondérée des positions sur ± 2 × 1,2 s. */
const SMOOTH_SECONDS = 1.2;

export interface CameraTrack {
  /** Centre et largeur de la vue à chaque pas de temps. */
  cx: number[];
  cy: number[];
  width: number[];
  /** Vue de toute la semaine (fin du dézoom). */
  full: Box;
  /** Largeur ÷ hauteur de la zone de la carte. */
  ratio: number;
  total: number;
}

/** Prépare la caméra de toute l'animation (une fois par animation et par format). */
export function cameraTrack(replay: Replay, full: Box, ratio: number, viewKm = DEFAULT_VIEW_KM): CameraTrack {
  const minWidth = viewKm / KM_PER_UNIT;
  const n = Math.max(1, Math.ceil(replay.total / TICK) + 1);
  const pos = Array.from({ length: n }, (_, i): Point => project(truckAt(replay, i * TICK)));
  // Largeur voulue à chaque pas : le trajet proche dans le temps, avec une marge, au moins la largeur choisie.
  const look = Math.round(LOOK_SECONDS / TICK);
  const raw = pos.map((_, i) => {
    const near = pos.slice(Math.max(0, i - look), i + look + 1);
    const ex = Math.max(...near.map((p) => p[0])) - Math.min(...near.map((p) => p[0]));
    const ey = Math.max(...near.map((p) => p[1])) - Math.min(...near.map((p) => p[1]));
    return Math.min(full.width, Math.max(minWidth, ex * MARGIN, ey * MARGIN * ratio));
  });
  // Lissage (poids en cloche) : centre et largeur évoluent sans à-coups.
  const sigma = SMOOTH_SECONDS / TICK;
  const reach = Math.ceil(2 * sigma);
  const smooth = (values: number[]) =>
    values.map((_, i) => {
      let sum = 0;
      let weights = 0;
      for (let k = -reach; k <= reach; k++) {
        const j = Math.min(Math.max(i + k, 0), n - 1);
        const w = Math.exp(-(k * k) / (2 * sigma * sigma));
        sum += values[j] * w;
        weights += w;
      }
      return sum / weights;
    });
  return {
    cx: smooth(pos.map((p) => p[0])),
    cy: smooth(pos.map((p) => p[1])),
    width: smooth(raw),
    full,
    ratio,
    total: replay.total,
  };
}

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const boxAround = (cx: number, cy: number, width: number, ratio: number): Box => ({
  x: cx - width / 2,
  y: cy - width / ratio / 2,
  width,
  height: width / ratio,
});

/** Vue de la caméra à la seconde `seconds` (de 0 à `total + OUTRO_SECONDS`). */
export function cameraAt(track: CameraTrack, seconds: number): Box {
  const { cx, cy, width, full, ratio, total } = track;
  const at = (s: number) => {
    const x = Math.min(Math.max(s / TICK, 0), cx.length - 1);
    const i = Math.floor(x);
    const j = Math.min(i + 1, cx.length - 1);
    const f = x - i;
    const lerp = (a: number[]) => a[i] + (a[j] - a[i]) * f;
    return { cx: lerp(cx), cy: lerp(cy), width: lerp(width) };
  };
  if (seconds <= total) {
    const c = at(seconds);
    return boxAround(c.cx, c.cy, c.width, ratio);
  }
  // Dézoom final : du dernier cadrage à toute la semaine (zoom régulier : largeur interpolée en logarithme).
  const u = easeInOut(Math.min((seconds - total) / ZOOM_OUT_SECONDS, 1));
  const end = at(total);
  const [fx, fy] = [full.x + full.width / 2, full.y + full.height / 2];
  const w = Math.exp(Math.log(end.width) + (Math.log(full.width) - Math.log(end.width)) * u);
  return boxAround(end.cx + (fx - end.cx) * u, end.cy + (fy - end.cy) * u, w, ratio);
}
