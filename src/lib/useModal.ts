import { useEffect, useRef } from 'react';

// Fenêtres ouvertes, de la plus ancienne à la plus récente (une fiche LV peut s'ouvrir par-dessus une étape).
const stack: { id: symbol; close: () => void }[] = [];

// Bouton « retour » du téléphone : chaque fenêtre ajoute son entrée d'historique à l'ouverture (geste de l'utilisateur).
// Le retour consomme cette entrée et ferme la fenêtre du dessus, au lieu de quitter l'écran (page grise).
// Pas d'entrée ajoutée au retour lui-même : Chrome Android ignore une entrée créée sans geste, et le retour suivant
// quitterait l'appli.
// Retours que l'appli provoque elle-même (fenêtre fermée par un bouton) : à ignorer.
let skipPops = 0;

// L'appli gère elle-même la position de la page : un retour arrière ne la ramène pas en haut.
history.scrollRestoration = 'manual';

window.addEventListener('popstate', () => {
  if (skipPops > 0) {
    skipPops--;
    return;
  }
  stack.pop()?.close();
});

/** Bloque le défilement de la page, ferme la fenêtre du dessus avec Échap ou le bouton retour du téléphone. */
export function useModal(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const id = Symbol();
    stack.push({ id, close: () => close.current() });
    history.pushState({ modal: true }, '');
    document.body.classList.add('no-scroll');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1]?.id === id) close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const index = stack.findIndex((m) => m.id === id);
      const onTop = index === stack.length - 1;
      // Déjà retirée si le retour l'a fermée : son entrée est consommée.
      if (index >= 0) stack.splice(index, 1);
      if (!stack.length) document.body.classList.remove('no-scroll');
      // Fermée par un bouton, au-dessus des autres : on retire son entrée d'historique.
      // Attendre un instant évite de la retirer quand une fenêtre se rouvre aussitôt, en développement.
      // shortcut: fenêtre fermée sous une autre (rare), son entrée reste jusqu'à un retour de plus.
      if (index >= 0 && onTop) {
        queueMicrotask(() => {
          skipPops++;
          history.back();
        });
      }
    };
  }, []);
}
