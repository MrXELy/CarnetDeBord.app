---
paths: ["src/styles.css", "src/App.tsx", "src/components/WeekView.tsx", "src/components/WeekPage.tsx", "src/components/WeekPicker.tsx", "src/components/DaySection.tsx", "src/components/EventCard.tsx", "src/components/EventIcon.tsx", "src/components/Settings.tsx", "src/lib/useSheet.ts", "src/lib/useSwipe.ts", "src/lib/useModal.ts", "src/lib/share.ts", "src/lib/csv.ts", "src/main.tsx", "src/components/ErrorBoundary.tsx", "src/lib/dates.ts", "vite.config.ts"]
---

# Interface

## Style « grandes tuiles » (choisi sur maquettes, octobre 2026)

- Maquettes validées : canevas https://claude.ai/artifact/PxQyGDPHsdWECEGbkq4zey, page « Grandes tuiles ». Remplace l'ancien style « verre + frise » (cartes translucides, halos, police Manrope).
- **Thème sombre** : fond `#1a1c22`, tuiles pleines `#262932` (variables `--glass*`, nom hérité), coins 16 à 26 px, boutons d'au moins 48 px (faciles à toucher avec des gants), accent `#b9c8ff` (tuile de la semaine, « + », boutons principaux), police **Figtree** (paquet npm, gardée hors ligne), pas de dégradés ni de flou.
- **Une couleur par type d'étape** (`.tone-*` : `--tone` texte clair, `--tone-bg` fond de tuile, `--tone-sub` texte secondaire) : chargement bleu, livraison vert, carburant ambre ; débuts et fins de journée gris, en simples lignes avec un rond creux. Étapes en tuiles avec l'icône du type dans un carré. **Ordre inchangé : le plus récent en premier.**
- Animations douces (fenêtres qui montent du bas, étapes en fondu, glissement de semaine), coupées si le téléphone demande de réduire les animations. Sur téléphone, ce qui est sous la fenêtre du dessus est masqué une fois qu'elle a fini de monter (sinon Chrome Android saturait : zones de carte non dessinées).
- Écarts voulus avec les maquettes : **sur PC, l'appli reste centrée en largeur téléphone** (pas de 3 colonnes) ; **feuille de semaine partagée directement** (pas d'écran de choix des pages) ; page des LV sans vignettes photo ni bouton « Photographier une LV ».
- Fenêtres en panneaux qui montent du bas, redescendent à la fermeture et se ferment en tirant leur haut vers le bas ; types d'étape en cases à la couleur du type (bordure quand choisi) ; carburant : « Plein complet » / « Complément » en deux cases, à part du choix de la station.

## Comportements communs

- `src/lib/useSheet.ts` : fenêtres en panneau (reprend `useModal`) : fermeture animée (croix, fond, retour du téléphone, après enregistrement) et tirage du haut du panneau vers le bas pour fermer (`shouldDismiss`). `ref` sur `.modal-backdrop`, `handle` sur `.modal-header`, `close` à la place de `onClose`.
- `src/lib/useSwipe.ts` : glissement (semaine, statistiques) ; mode `global` : geste écouté sur toute la page, ignoré si une fenêtre est ouverte (la page Semaine pose le geste sur son panneau) ; ignoré depuis un champ ou une bande qui défile de côté. `overscroll-behavior: none` (pas de retour ni de rafraîchissement de Firefox au glissement) et `touch-action: pan-y pinch-zoom` sur `.app`.
- `src/components/ErrorBoundary.tsx` (autour de toute l'appli, dans `main.tsx`) : si un écran plante, message « Oups, un problème » et bouton « Recharger l'appli » au lieu d'une page noire.
- `src/lib/share.ts` : partage ou téléchargement d'un fichier (PDF, images des cartes) ; le téléchargement est forcé (type `application/octet-stream`), jamais une ouverture dans un onglet. Firefox Android ne sait pas partager de fichiers (`navigator.share` : « Passing files is currently not supported ») : un PDF y finit en about:blank dans l'appli installée ; l'utilisateur installe donc l'appli avec Chrome.

## Accueil et semaine

- **Accueil = la journée en cours seulement** (choix de l'utilisateur : « moins chargé ») : `currentDay` dans `src/lib/dates.ts` (depuis le dernier début de journée s'il n'a pas de fin, même après minuit ; sinon les étapes du jour). En haut : date, « Bonne route » ou « Bonjour », pastille de synchro (vert à jour, orange en attente ou hors ligne avec le nombre, rouge erreur : toucher pour réessayer), Options. Puis échéances (`HomeNotices.tsx`), **tuile de la semaine** (km, flèche : ouvre la page Semaine), et la journée (heure limite dessous, `DayLimitNotice.tsx`).
- **Avant le début de journée** : une tuile verte par LV dans le camion, « Livraison prévue à Ville », marchandise, jour et lieu du chargement (pas d'heure de rendez-vous : refusé). Toucher ouvre les LV dans le camion.
- **Barre du bas** : Semaine, LV (nombre à compléter), Statistiques, Rechercher, avec le « + » à droite ; le bouton « Fin du chargement / de la livraison » s'affiche juste au-dessus de la barre tant qu'il est là (voir `lv.md`).
- **Page Semaine** (`WeekPage.tsx`, fenêtre) : flèches et « Choisir une semaine » (liste groupée par mois, saut à une date), glissement du doigt, km de la semaine (`periodKm`, même calcul par tronçons que les Statistiques), raccourcis LV dans le camion, frais, carte et feuille de semaine en cases sur une ligne, puis tous les jours. La recherche y ouvre la semaine de l'étape trouvée.
- **Nouvelle étape** : type déjà choisi d'après la dernière étape (`suggestedType` dans `src/lib/onSite.ts`, pleins ignorés) : début de journée sans étape, après une fin ou 9 h sans étape ; livraison après un chargement ou s'il reste des LV dans le camion ; sinon chargement. Mêmes préremplissages qu'au toucher. Plaques repliées sur une ligne « Camion » (toucher pour modifier), ouvertes d'office si le tracteur est inconnu.

## Options

Mode Europe pour la recherche de villes, exports CSV (étapes et LV), compteur des lectures automatiques du mois, échéances, frais, feuille de semaine, nettoyage des photos ; tout en bas, la version : commit et heure de construction (`__BUILD_COMMIT__`, `__BUILD_DATE__` posés par `define` dans `vite.config.ts`, « · test local » sur le serveur de test).
