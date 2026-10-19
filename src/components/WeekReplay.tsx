import { format } from 'date-fns';
import { Clapperboard, LoaderCircle, Pause, Play, RotateCcw, Share2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { shareFile } from '../lib/share';
import { weekLabel } from '../lib/dates';
import { cameraAt, cameraTrack, OUTRO_SECONDS } from '../lib/replayCamera';
import { drawReplayFrame, replayBox, replayLayout, type ReplayFormat } from '../lib/replayDraw';
import { updateSettings, useSettings } from '../lib/settings';
import { useSheet } from '../lib/useSheet';
import type { ReplayVideo } from '../lib/replayVideo';
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

type VideoState =
  | { state: 'idle' }
  | { state: 'busy'; done: number }
  | { state: 'ready'; video: ReplayVideo }
  | { state: 'error'; message: string };

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
  const [video, setVideo] = useState<VideoState>({ state: 'idle' });
  const making = useRef<AbortController | null>(null);

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

  /** Dessine l'image de la seconde `seconds` (aperçu comme vidéo : exactement la même image). */
  function drawAt(ctx: CanvasRenderingContext2D, seconds: number) {
    const frame = replayFrame(replay, Math.min(seconds / replay.total, 1));
    if (!frame) return;
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
      Math.min(seconds / length, 1),
    );
  }

  // Image affichée : redessinée à chaque changement d'avancement, de format ou de réglage du fond.
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx) drawAt(ctx, progress * length);
    // drawAt dépend des mêmes valeurs que ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay, camera, progress, length, fmt, title, mapCities, mapDepartments]);

  // Vidéo déjà faite : périmée si un réglage change.
  useEffect(() => {
    setVideo((v) => (v.state === 'ready' || v.state === 'error' ? { state: 'idle' } : v));
  }, [replay, camera, fmt, mapCities, mapDepartments]);

  // Fenêtre fermée pendant la création : on arrête.
  useEffect(() => () => making.current?.abort(), []);

  async function makeVideo() {
    // WebCodecs : Chrome, Edge, Safari récents (pas Firefox sur Android).
    if (typeof VideoEncoder === 'undefined') {
      return setVideo({
        state: 'error',
        message: 'Ce navigateur ne sait pas créer de vidéo : ouvre l’appli avec Chrome.',
      });
    }
    setPlaying(false);
    const controller = new AbortController();
    making.current = controller;
    setVideo({ state: 'busy', done: 0 });
    try {
      // Fabrication de la vidéo (bibliothèque Mediabunny) chargée seulement à la demande.
      const { makeReplayVideo } = await import('../lib/replayVideo');
      const made = await makeReplayVideo(
        drawAt,
        layout.width,
        layout.height,
        length,
        (done) => setVideo({ state: 'busy', done }),
        controller.signal,
      );
      setVideo({ state: 'ready', video: made });
    } catch (err) {
      setVideo(
        err instanceof DOMException && err.name === 'AbortError'
          ? { state: 'idle' }
          : { state: 'error', message: 'Vidéo impossible à créer sur cet appareil.' },
      );
    } finally {
      making.current = null;
    }
  }

  /** Partage sur téléphone, téléchargement sur PC (geste séparé : la création prend trop longtemps pour partager). */
  async function shareVideo(made: ReplayVideo) {
    const week = title.match(/\d+/)?.[0] ?? '';
    const name = `semaine-${format(start, 'yyyy')}-${week}-${fmt === 'vertical' ? 'verticale' : 'carree'}${made.extension}`;
    try {
      await shareFile(made.blob, name, title);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setVideo({ state: 'error', message: 'Partage impossible : réessaie.' });
      }
    }
  }

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
                  disabled={video.state === 'busy'}
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
                  disabled={video.state === 'busy'}
                  onChange={(e) => {
                    setPlaying(false);
                    setProgress(Number(e.target.value) / 1000);
                  }}
                />
              </div>

              {/* Création de la vidéo : bouton, avancement, puis partage. */}
              {video.state === 'busy' ? (
                <div className="replay-making">
                  <p className="reading">
                    <LoaderCircle size={16} className="spin" />
                    Création de la vidéo… {Math.round(video.done * 100)} %
                  </p>
                  <progress max={1} value={video.done} />
                  <button type="button" className="btn-link" onClick={() => making.current?.abort()}>
                    Annuler
                  </button>
                </div>
              ) : video.state === 'ready' ? (
                <button
                  type="button"
                  className="btn-primary btn-icon lv-add map-generate"
                  onClick={() => shareVideo(video.video)}
                >
                  <Share2 size={18} />
                  Partager la vidéo (
                  {(video.video.blob.size / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo)
                </button>
              ) : (
                <button type="button" className="btn-primary btn-icon lv-add map-generate" onClick={makeVideo}>
                  <Clapperboard size={18} />
                  Créer la vidéo ({Math.round(length)} s)
                </button>
              )}
              {video.state === 'error' && <p className="reading reading-error">{video.message}</p>}

              <fieldset className="replay-settings" disabled={video.state === 'busy'}>
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
              </fieldset>
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
