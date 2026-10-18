import { useRef, type TouchEvent } from 'react';

/**
 * Sens d'un glissement du doigt : -1 vers la droite (précédent), 1 vers la gauche (suivant), 0 si le geste est trop
 * court ou pas assez horizontal (pour ne pas changer de période en faisant simplement défiler la page).
 */
export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) return dx > 0 ? -1 : 1;
  return 0;
}

/**
 * Glisser du doigt sur une zone : appelle `onSwipe(-1)` vers la droite (période précédente)
 * et `onSwipe(1)` vers la gauche (suivante). À poser sur l'élément avec `{...swipe}`.
 */
export function useSwipe(onSwipe: (direction: -1 | 1) => void) {
  const touch = useRef<{ x: number; y: number } | null>(null);
  // Toujours la dernière version de la fonction, même si elle change entre le début et la fin du geste.
  const callback = useRef(onSwipe);
  callback.current = onSwipe;

  return {
    onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      touch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd(e: TouchEvent) {
      const from = touch.current;
      touch.current = null;
      if (!from) return;
      const t = e.changedTouches[0];
      const direction = swipeDirection(t.clientX - from.x, t.clientY - from.y);
      if (direction) callback.current(direction);
    },
  };
}
