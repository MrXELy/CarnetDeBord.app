---
paths: ["src/styles.css", "src/App.tsx", "src/components/WeekView.tsx", "src/components/WeekPicker.tsx", "src/components/DaySection.tsx", "src/components/EventCard.tsx", "src/components/EventIcon.tsx", "src/components/Settings.tsx", "src/lib/useSheet.ts", "src/lib/useSwipe.ts", "src/lib/useModal.ts", "src/lib/share.ts", "src/lib/csv.ts", "src/main.tsx", "src/components/ErrorBoundary.tsx", "src/lib/dates.ts", "vite.config.ts"]
---

# Interface

## Style « verre + frise » (choisi sur maquettes)

- **Thème sombre**, icônes sobres (lucide), boutons de type petits et de même taille, débuts et fins de journée discrets.
- Fond très sombre avec halos de couleur qui dérivent, cartes translucides, frise verticale avec un point de couleur par étape (rond creux pour début et fin de journée), police **Manrope** (paquet npm, gardée hors ligne), gros km de la semaine en dégradé. Animations douces (fenêtres qui montent du bas, étapes en fondu, glissement de semaine), coupées si le téléphone demande de réduire les animations. **Pas de flou derrière les fenêtres sur téléphone** (seulement sur PC) et halos figés tant qu'une fenêtre est ouverte : sinon Chrome Android saturait (zones de carte non dessinées, bouton qui clignote). **Ordre inchangé : le plus récent en premier.**
- Fenêtres en panneaux de verre qui montent du bas (formulaires, LV, Options, semaines, cartes), redescendent à la fermeture et se ferment en tirant leur haut vers le bas ; types d'étape en 3 colonnes à la couleur du type ; état coloré des LV dans leur page ; barre des lectures du mois dans les Options. Pas de bande bleue sur les plaques.
- **Barre du haut** : nom, pastille de synchro (vert à jour, orange en attente ou hors ligne avec le nombre, rouge erreur : toucher pour réessayer), puis Rechercher, LV, Statistiques, Options ; « Se déconnecter » est en bas des Options.

## Comportements communs

- `src/lib/useSheet.ts` : fenêtres en panneau (reprend `useModal`) : fermeture animée (croix, fond, retour du téléphone, après enregistrement) et tirage du haut du panneau vers le bas pour fermer (`shouldDismiss`). `ref` sur `.modal-backdrop`, `handle` sur `.modal-header`, `close` à la place de `onClose`.
- `src/lib/useSwipe.ts` : glissement (semaine, statistiques) ; mode `global` pour l'accueil : geste écouté sur toute la page, ignoré si une fenêtre est ouverte, depuis un champ ou une bande qui défile de côté. `overscroll-behavior: none` (pas de retour ni de rafraîchissement de Firefox au glissement) et `touch-action: pan-y pinch-zoom` sur `.app`.
- `src/components/ErrorBoundary.tsx` (autour de toute l'appli, dans `main.tsx`) : si un écran plante, message « Oups, un problème » et bouton « Recharger l'appli » au lieu d'une page noire.
- `src/lib/share.ts` : partage ou téléchargement d'un fichier (PDF, images des cartes) ; le téléchargement est forcé (type `application/octet-stream`), jamais une ouverture dans un onglet. Firefox Android ne sait pas partager de fichiers (`navigator.share` : « Passing files is currently not supported ») : un PDF y finit en about:blank dans l'appli installée ; l'utilisateur installe donc l'appli avec Chrome.

## Accueil et semaine

- **Vue semaine** avec récap des km (km de la semaine, de chaque jour, de la liste des semaines et des cartes : `periodKm` dans `src/lib/dates.ts`, même calcul par tronçons que les Statistiques), navigation par glissement, liste « Choisir une semaine » groupée par mois et saut à une date. Sous la semaine, pastilles des frais, de la carte et de la feuille de semaine sur une ligne.
- Haut de l'accueil : échéances (`HomeNotices.tsx`) ; heure limite sous le jour en cours (`DayLimitNotice.tsx`).

## Options

Mode Europe pour la recherche de villes, exports CSV (étapes et LV), compteur des lectures automatiques du mois, échéances, frais, feuille de semaine, nettoyage des photos ; tout en bas, la version : commit et heure de construction (`__BUILD_COMMIT__`, `__BUILD_DATE__` posés par `define` dans `vite.config.ts`, « · test local » sur le serveur de test).
