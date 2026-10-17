import { useEffect, useRef } from 'react';

// Fenêtres ouvertes, de la plus ancienne à la plus récente (une fiche LV peut s'ouvrir par-dessus une étape).
const stack: { id: symbol; close: () => void }[] = [];

// Bouton « retour » du téléphone : tant qu'une fenêtre est ouverte, une entrée est ajoutée à l'historique.
// Le retour la consomme et ferme la fenêtre du dessus, au lieu de quitter l'écran (page grise).
let guarded = false;
// Vrai pendant que l'appli retire elle-même son entrée (fenêtre fermée par un bouton) : ce retour-là est ignoré.
let ignoreNextPop = false;

function addGuard() {
  if (guarded) return;
  history.pushState({ modal: true }, '');
  guarded = true;
}

window.addEventListener('popstate', () => {
  if (ignoreNextPop) {
    ignoreNextPop = false;
    return;
  }
  guarded = false;
  const top = stack.pop();
  if (!top) return;
  // Une fenêtre reste ouverte en dessous : nouvelle entrée pour le prochain retour.
  if (stack.length) addGuard();
  top.close();
});

/** Bloque le défilement de la page, ferme la fenêtre du dessus avec Échap ou le bouton retour du téléphone. */
export function useModal(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const id = Symbol();
    stack.push({ id, close: () => close.current() });
    addGuard();
    document.body.classList.add('no-scroll');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1]?.id === id) close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      const index = stack.findIndex((m) => m.id === id);
      if (index >= 0) stack.splice(index, 1);
      window.removeEventListener('keydown', onKey);
      if (stack.length) return;
      document.body.classList.remove('no-scroll');
      // Dernière fenêtre fermée par un bouton : on retire l'entrée ajoutée à l'ouverture.
      // (Attendre un instant évite de la retirer quand une fenêtre se rouvre aussitôt, en développement.)
      queueMicrotask(() => {
        if (stack.length || !guarded) return;
        guarded = false;
        ignoreNextPop = true;
        history.back();
      });
    };
  }, []);
}
