import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { weekLabel } from '../lib/dates';
import { cameraAt, cameraTrack, OUTRO_SECONDS } from '../lib/replayCamera';
import { drawReplayFrame, replayBox, replayLayout, type ReplayFormat } from '../lib/replayDraw';
import { updateSettings, useSettings } from '../lib/settings';
import { useSheet } from '../lib/useSheet';
import { buildReplay, replayFrame } from '../lib/weekReplay';
import type { Stop } from '../lib/weekStops';
import type { MapLeg } from '../types';

interface Props {
  start: Date;
  stops: Stop[];
  /** Itinéraires enregistrés de la semaine (un par tronçon ; sinon lignes droites). */
  legs: MapLeg[];
  onClose: () => void;
}

/** Durées proposées pour l'animation, en secondes. */
const DURATIONS = [15, 30, 45, 60, 90, 120];

/** La semaine rejouée : animation des trajets dans l'ordre chronologique, au format et à la durée choisis. */
export default function WeekReplay({ start, stops, legs, onClose }: Props) {
  const {
    replayFormat: fmt,
    replayDuration: duration,
    replayViewKm: viewKm,
    mapCities,
    mapDepartments,
  } = useSettings();
  const sheet = useSheet(onClose);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);

  const replay = useMemo(() => buildReplay(stops, legs, duration), [stops, legs, duration]);
  const layout = replayLayout(fmt);
  const camera = useMemo(
    () => cameraTrack(replay, replayBox(replay, fmt), layout.width / layout.mapHeight, viewKm),
    [replay, fmt, layout.width, layout.mapHeight, viewKm],
  );
  const title = weekLabel(start);
  // Durée totale : la semaine, puis le dézoom final et la pause sur la carte complète.
  const length = replay.total + OUTRO_SECONDS;

  // Lecture : l'avancement suit l'horloge ; arrêt à la fin.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setProgress((p) => {
        const next = Math.min(p + dt / length, 1);
        if (next >= 1) setPlaying(false);
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, length]);

  // Image affichée : redessinée à chaque changement d'avancement, de format ou de réglage du fond.
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    const seconds = progress * length;
    const frame = replayFrame(replay, Math.min(seconds / replay.total, 1));
    if (!ctx || !frame) return;
    // Fin : vue d'ensemble, avec le bilan de la semaine.
    const days = new Set(replay.stops.map((s) => s.day)).size;
    const shown =
      seconds > replay.total
        ? { ...frame, caption: `${days} jour${days > 1 ? 's' : ''} · ${replay.stops.length} lieux` }
        : frame;
    drawReplayFrame(
      ctx,
      fmt,
      title,
      cameraAt(camera, seconds),
      { cities: mapCities, departments: mapDepartments },
      replay,
      shown,
      progress,
    );
  }, [replay, camera, progress, length, fmt, title, mapCities, mapDepartments]);

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
              {/* Largeur de la vue pendant la semaine (la caméra recule quand même sur les longs trajets). */}
              <label className="replay-view">
                <span>
                  Largeur de la vue : <strong>{viewKm} km</strong>
                </span>
                <input
                  type="range"
                  min={100}
                  max={1000}
                  step={20}
                  value={viewKm}
                  onChange={(e) => updateSettings({ replayViewKm: Number(e.target.value) })}
                />
              </label>
              {duration < replay.readableDuration && (
                <p className="hint">
                  Arrêts et nuits raccourcis à cette durée : pour les lire tranquillement, choisis au moins{' '}
                  {replay.readableDuration} s.
                </p>
              )}
              <p className="hint">
                La caméra suit le camion, puis recule sur toute la semaine à la fin (4,5 s de plus). Le camion roule
                toujours à la même vitesse ; arrêts et nuits durent le temps de lire (moins si l’animation est courte).
                Itinéraires de la carte de la semaine (lignes droites si elle n’est pas générée).
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
