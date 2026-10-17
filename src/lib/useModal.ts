import { useEffect, useRef } from 'react';

// Fenêtres ouvertes, de la plus ancienne à la plus récente (une fiche LV peut s'ouvrir par-dessus une étape).
const stack: symbol[] = [];

/** Bloque le défilement de la page et ferme la fenêtre du dessus avec Échap. */
export function useModal(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const id = Symbol();
    stack.push(id);
    document.body.classList.add('no-scroll');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      stack.splice(stack.indexOf(id), 1);
      if (!stack.length) document.body.classList.remove('no-scroll');
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
