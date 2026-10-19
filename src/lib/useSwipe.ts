import { useEffect, useRef, type TouchEvent } from 'react';

/**
 * Sens d'un glissement du doigt : -1 vers la droite (précédent), 1 vers la gauche (suivant), 0 si le geste est trop
 * court ou pas assez horizontal (pour ne pas changer de période en faisant simplement défiler la page).
 */
export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) return dx > 0 ? -1 : 1;
  return 0;
}

/** Vrai si le geste part d'un champ ou d'une bande qui défile de côté (photos) : il leur appartient. */
function ownsHorizontalGesture(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [data-no-swipe]')) return true;
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowX;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollWidth > el.clientWidth) return true;
  }
  return false;
}

/**
 * Glisser du doigt : appelle `onSwipe(-1)` vers la droite (période précédente) et `onSwipe(1)` vers la gauche
 * (suivante). Sans option, à poser sur l'élément avec `{...swipe}`. Avec `global`, le geste est écouté sur toute la
 * page (le doigt peut partir de n'importe où), sauf quand une fenêtre est ouverte par-dessus.
 */
export function useSwipe(onSwipe: (direction: -1 | 1) => void, options: { global?: boolean } = {}) {
  const touch = useRef<{ x: number; y: number } | null>(null);
  // Toujours la dernière version de la fonction, même si elle change entre le début et la fin du geste.
  const callback = useRef(onSwipe);
  callback.current = onSwipe;
  const global = options.global ?? false;

  function start(touches: TouchList | TouchEvent['touches'], target: EventTarget | null) {
    const t = touches[0];
    touch.current = touches.length === 1 && !ownsHorizontalGesture(target) ? { x: t.clientX, y: t.clientY } : null;
  }

  function end(touches: TouchList | TouchEvent['changedTouches']) {
    const from = touch.current;
    touch.current = null;
    if (!from) return;
    const t = touches[0];
    const direction = swipeDirection(t.clientX - from.x, t.clientY - from.y);
    if (direction) callback.current(direction);
  }

  useEffect(() => {
    if (!global) return;
    const onStart = (e: globalThis.TouchEvent) => {
      // Une fenêtre ouverte (useModal bloque alors le défilement) : la page dessous ne bouge pas.
      if (document.body.classList.contains('no-scroll')) touch.current = null;
      else start(e.touches, e.target);
    };
    const onEnd = (e: globalThis.TouchEvent) => end(e.changedTouches);
    const onCancel = () => (touch.current = null);
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };
    // start et end ne lisent que des refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [global]);

  return {
    onTouchStart(e: TouchEvent) {
      start(e.touches, e.target);
    },
    onTouchEnd(e: TouchEvent) {
      end(e.changedTouches);
    },
    onTouchCancel() {
      touch.current = null;
    },
  };
}
