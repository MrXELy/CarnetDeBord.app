import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
} from 'mediabunny';

/** Images par seconde de la vidéo. */
export const VIDEO_FPS = 30;

/** Vidéo prête : le fichier et son extension (« .mp4 »). */
export interface ReplayVideo {
  blob: Blob;
  extension: string;
}

/**
 * Fabrique la vidéo MP4 de l'animation, image par image (plus vite que la lecture, et sans saccade) : `draw` dessine
 * l'image de la seconde demandée. Codec : le premier que le navigateur sait encoder (H.264 en général).
 * `onProgress` reçoit l'avancement (0 à 1). Lève une AbortError si `signal` est annulé.
 */
export async function makeReplayVideo(
  draw: (ctx: CanvasRenderingContext2D, seconds: number) => void,
  width: number,
  height: number,
  length: number,
  onProgress: (done: number) => void,
  signal: AbortSignal,
): Promise<ReplayVideo> {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d')!;
  const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
  const codec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width, height });
  if (!codec) throw new Error('Aucun codec vidéo disponible');
  const output = new Output({ format, target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec, quality: QUALITY_MEDIUM });
  output.addVideoTrack(source, { frameRate: VIDEO_FPS });
  await output.start();

  const frames = Math.ceil(length * VIDEO_FPS);
  try {
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException('Vidéo annulée', 'AbortError');
      draw(ctx, i / VIDEO_FPS);
      await source.add(i / VIDEO_FPS, 1 / VIDEO_FPS);
      if (i % 15 === 0) {
        onProgress(i / frames);
        await new Promise((resolve) => setTimeout(resolve)); // laisse l'écran se mettre à jour
      }
    }
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => {});
    throw err;
  }
  onProgress(1);
  return { blob: new Blob([output.target.buffer!], { type: format.mimeType }), extension: format.fileExtension };
}
