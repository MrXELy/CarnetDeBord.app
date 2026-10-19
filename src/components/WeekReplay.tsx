import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { weekLabel } from '../lib/dates';
import { drawReplayFrame, replayBox, replayLayout, svgImage, type ReplayFormat } from '../lib/replayDraw';
import { updateSettings, useSettings } from '../lib/settings';
import { useSheet } from '../lib/useSheet';
import { buildReplay, replayFrame } from '../lib/weekReplay';
import type { Stop } from '../lib/weekStops';
import type { MapLeg } from '../types';
import MapSvg from './MapSvg';

interface Props {
  start: Date;
  stops: Stop[];
  /** Itinéraires enregistrés de la semaine (un par tronçon ; sinon lignes droites). */
  legs: MapLeg[];
  onClose: () => void;
}

/** Durées proposées pour l'animation, en secondes. */
const DURATIONS = [15, 30, 45, 60, 90];

/** La semaine rejouée : animation des trajets dans l'ordre chronologique, au format et à la durée choisis. */
export default function WeekReplay({ start, stops, legs, onClose }: Props) {
  const { replayFormat: fmt, replayDuration: duration, mapCities, mapDepartments } = useSettings();
  const sheet = useSheet(onClose);
  const canvas = useRef<HTMLCanvasElement>(null);
  const backgroundSvg = useRef<SVGSVGElement>(null);
  const [background, setBackground] = useState<HTMLImageElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);

  const replay = useMemo(() => buildReplay(stops, legs), [stops, legs]);
  const box = useMemo(() => replayBox(replay, fmt), [replay, fmt]);
  const layout = replayLayout(fmt);
  const title = weekLabel(start);

  // Fond de carte (France, départements, villes) dessiné une fois par cadre, puis réutilisé à chaque image.
  useEffect(() => {
    const svg = backgroundSvg.current;
    if (!svg) return;
    let alive = true;
    setBackground(null);
    svgImage(svg, layout.width, layout.mapHeight)
      .then((img) => alive && setBackground(img))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [box, layout.width, layout.mapHeight, mapCities, mapDepartments]);

  // Lecture : l'avancement suit l'horloge, à la durée choisie ; arrêt à la fin.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setProgress((p) => {
        const next = Math.min(p + dt / duration, 1);
        if (next >= 1) setPlaying(false);
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  // Image affichée : redessinée à chaque changement d'avancement, de format ou de fond.
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    const frame = replayFrame(replay, progress);
    if (!ctx || !frame) return;
    drawReplayFrame(ctx, fmt, title, box, background, replay, frame, progress);
  }, [replay, progress, fmt, title, box, background]);

  function toggle() {
    if (progress >= 1) setProgress(0);
    setPlaying((p) => !p || progress >= 1);
  }

  const empty = replay.drives.length === 0;

  return (
    <div className="modal-backdrop" ref={sheet.ref} onClick={sheet.close}>
      <div className="modal map-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header" {...sheet.handle}>
          <button type="button" className="icon-btn" onClick={sheet.close} aria-label="Fermer">
            <X size={22} />
          </button>
          <h2>Semaine rejouée</h2>
        </header>

        <div className="modal-body">
          {empty ? (
            <p className="empty muted">Pas encore de trajet à rejouer cette semaine.</p>
          ) : (
            <>
              <canvas
                ref={canvas}
                className={`replay-canvas ${fmt}`}
                width={layout.width}
                height={layout.height}
                onClick={toggle}
                aria-label={`Animation des trajets de la ${title}`}
              />

              <div className="replay-controls">
                <button
                  type="button"
                  className="map-image-btn replay-play"
                  onClick={toggle}
                  aria-label={playing ? 'Pause' : progress >= 1 ? 'Rejouer' : 'Lecture'}
                >
                  {playing ? <Pause size={20} /> : progress >= 1 ? <RotateCcw size={20} /> : <Play size={20} />}
                </button>
                <input
                  type="range"
                  className="replay-seek"
                  min={0}
                  max={1000}
                  value={Math.round(progress * 1000)}
                  aria-label="Avancement"
                  onChange={(e) => {
                    setPlaying(false);
                    setProgress(Number(e.target.value) / 1000);
                  }}
                />
              </div>

              <div className="map-mode" role="radiogroup" aria-label="Format">
                {(
                  [
                    ['vertical', 'Vertical'],
                    ['square', 'Carré'],
                  ] as [ReplayFormat, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={fmt === value}
                    className={fmt === value ? 'selected' : ''}
                    onClick={() => updateSettings({ replayFormat: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="map-mode" role="radiogroup" aria-label="Durée">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={duration === d}
                    className={duration === d ? 'selected' : ''}
                    onClick={() => updateSettings({ replayDuration: d })}
                  >
                    {d} s
                  </button>
                ))}
              </div>
              <p className="hint">
                Les nuits sont raccourcies ; les trajets durent selon leur temps réel. Itinéraires de la carte de la
                semaine (lignes droites si elle n’est pas générée).
              </p>
            </>
          )}

          {/* Fond de carte, invisible : copié en image pour l'animation. */}
          <div className="replay-background" aria-hidden>
            <MapSvg
              ref={backgroundSvg}
              box={box}
              lines={[]}
              pins={[]}
              arrows={false}
              cities={mapCities}
              departments={mapDepartments}
              label=""
            />
          </div>
        </div>
      </div>
    </div>
  );
}
