import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useModal } from './useModal';

/**
 * Fermer un panneau tiré vers le bas : tiré de plus d'un quart de sa hauteur, ou lancé vite (plus de 0,5 px/ms)
 * sur au moins 30 px. Sinon il remonte à sa place.
 */
export function shouldDismiss(dy: number, velocity: number, height: number): boolean {
  return dy > height * 0.25 || (velocity > 0.5 && dy > 30);
}

// Durée de l'animation de fermeture (ms), et marge si la fin de l'animation n'est jamais signalée.
const CLOSE_MS = 260;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Sur PC, la fenêtre est centrée : elle s'efface au lieu de redescendre.
const centered = () => matchMedia('(min-width: 640px)').matches;

/**
 * Fenêtre en panneau (`modal-backdrop` > `modal` > `modal-header`) : fermeture animée (le panneau redescend, le fond
 * s'éclaircit) et tirage du haut du panneau vers le bas pour le fermer. Reprend `useModal` (Échap, bouton retour du
 * téléphone, blocage du défilement), qui ferme lui aussi avec l'animation.
 *
 * - `ref` sur `.modal-backdrop` ;
 * - `handle` sur `.modal-header` (la poignée) ;
 * - `close` à la place de `onClose` (croix, fond, après un enregistrement…), `closeThen(fn)` pour finir par une autre
 *   fonction que `onClose`.
 */
export function useSheet(onClose: () => void) {
  const backdrop = useRef<HTMLDivElement>(null);
  const done = useRef(onClose);
  done.current = onClose;
  // Une seule fermeture à la fois (croix touchée pendant que le panneau redescend, retour arrière…).
  const closing = useRef(false);
  const drag = useRef<{ startY: number; dy: number; lastY: number; lastT: number; velocity: number } | null>(null);

  const panel = () => backdrop.current?.querySelector<HTMLElement>(':scope > .modal') ?? null;

  function closeThen(then: () => void) {
    if (closing.current) return;
    closing.current = true;
    const back = backdrop.current;
    const sheet = panel();
    if (!back || !sheet || reducedMotion()) return then();

    // L'animation d'ouverture est arrêtée (sinon elle garderait la main sur la position), puis le panneau part
    // de là où il est : en place, ou là où le doigt l'a lâché.
    sheet.style.animation = 'none';
    void sheet.offsetHeight;
    sheet.style.transition = `transform ${CLOSE_MS}ms cubic-bezier(0.4, 0, 1, 1), opacity ${CLOSE_MS}ms ease`;
    if (centered()) {
      sheet.style.transform = 'translateY(16px) scale(0.98)';
      sheet.style.opacity = '0';
    } else {
      sheet.style.transform = 'translateY(100%)';
    }
    back.style.backgroundColor = '';
    back.style.transition = '';
    back.classList.add('closing');

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      then();
    };
    sheet.addEventListener('transitionend', (e) => e.target === sheet && finish());
    setTimeout(finish, CLOSE_MS + 120);
  }

  const close = () => closeThen(done.current);

  useModal(close);

  /** Le panneau suit le doigt (vers le bas seulement) et le fond s'éclaircit d'autant. */
  function follow(dy: number) {
    const sheet = panel();
    if (!sheet || !backdrop.current) return;
    sheet.style.transform = dy ? `translateY(${dy}px)` : '';
    const left = 1 - Math.min(1, dy / sheet.offsetHeight);
    backdrop.current.style.backgroundColor = `rgba(0, 0, 0, ${(0.55 * left).toFixed(3)})`;
  }

  const handle = {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      // Les boutons du titre (Fermer, OK…) restent de simples boutons.
      if (closing.current || e.button !== 0 || (e.target as Element).closest('button, a, input, select, textarea')) {
        return;
      }
      const sheet = panel();
      if (!sheet) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      sheet.style.animation = 'none';
      sheet.style.transition = 'none';
      if (backdrop.current) backdrop.current.style.transition = 'none';
      drag.current = { startY: e.clientY, dy: 0, lastY: e.clientY, lastT: e.timeStamp, velocity: 0 };
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      const dt = e.timeStamp - d.lastT;
      if (dt > 0) d.velocity = (e.clientY - d.lastY) / dt;
      d.lastY = e.clientY;
      d.lastT = e.timeStamp;
      d.dy = Math.max(0, e.clientY - d.startY);
      follow(d.dy);
    },
    onPointerUp() {
      release(false);
    },
    // Geste interrompu par le téléphone : le panneau reprend sa place.
    onPointerCancel() {
      release(true);
    },
  };

  function release(cancelled: boolean) {
    const d = drag.current;
    drag.current = null;
    const sheet = panel();
    if (!d || !sheet) return;
    if (!cancelled && shouldDismiss(d.dy, d.velocity, sheet.offsetHeight)) return close();
    // Pas assez tiré : le panneau remonte en douceur.
    sheet.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.9, 0.2, 1)';
    if (backdrop.current) backdrop.current.style.transition = 'background-color 0.25s ease';
    follow(0);
    if (backdrop.current) backdrop.current.style.backgroundColor = '';
  }

  return { ref: backdrop, close, closeThen, handle };
}
