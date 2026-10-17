# CarnetDeBord.app

Webapp PWA pour un chauffeur routier : noter les étapes de ses trajets (début et fin de journée, chargement, livraison, carburant), ses lettres de voiture et voir le récap de sa semaine. Utilisée surtout sur téléphone, aussi sur PC. Thème sombre, sobre et moderne.

## Règles de travail

- **Réponds toujours en français.** L'utilisateur débute en développement : explique simplement.
- **Avant tout `git push`** : lance le serveur de test local, donne l'adresse pour tester (PC et téléphone), puis **demande l'accord**. Ne jamais pousser sans accord explicite.
- **Le dépôt GitHub est public** : aucune donnée personnelle dans les fichiers commités, tests compris (positions GPS réelles, lieux de base, noms de clients, immatriculations, nom de l'utilisateur). Dans les tests, utiliser des centres de villes publiques (Narbonne, Toulouse, Périgueux…) et des noms génériques. Vérifier le diff avant chaque commit.
- **Aucune clé secrète dans le code.** La clé Anthropic est seulement dans les secrets Supabase (`ANTHROPIC_API_KEY`). La clé publishable Supabase de `src/config.ts` est publique par conception.
- Style de code : Prettier avec `--single-quote --print-width 120`. Commentaires en français.

## Pile technique

React 19, Vite, TypeScript, vite-plugin-pwa, date-fns (locale fr), lucide-react, vitest. Données dans Supabase (tables `events`, `waybills`, `ocr_usage`, `week_maps` avec RLS ; stockage privé `waybill-photos` ; fonction Edge `read-waybill` pour la lecture automatique des LV avec Claude). Inscriptions désactivées.

## Commandes

- `npm install` : installer les dépendances.
- `npx vite --host` : serveur de test, accessible depuis le téléphone sur le même Wi-Fi (adresse en `/CarnetDeBord.app/`).
- `npm test` : tests (vitest). `npm run build` : vérification TypeScript et build.
- Mode démo local : ajouter `?demo` à l'adresse (seulement en développement). Il lit `data/demo-events.json` et ne contacte pas Supabase ; `?demo=reset` recharge les données.
- Déployer la fonction Edge : `npx --yes supabase@2.121.0 functions deploy read-waybill --project-ref bjtqghlacclhbjjyarxj --use-api`.
- Les migrations SQL (`supabase/migrations/`) sont lancées à la main par l'utilisateur dans l'éditeur SQL de Supabase.
- Mise en ligne : chaque push sur `main` déploie sur GitHub Pages (https://mrxely.github.io/CarnetDeBord.app/) via GitHub Actions.

## Organisation

- `src/lib/sync.ts` : synchro hors ligne d'abord (cache localStorage, file d'envoi), `EventStore`.
- `src/lib/dates.ts` : la semaine commence le **dimanche à 22h**.
- `src/components/MapSvg.tsx` : dessin commun des cartes (fond IGN, villes repères, tracés, export PNG).
- `src/components/WeekMap.tsx` et `MonthMap.tsx` : cartes de la semaine et du mois ; `src/lib/weekMapGen.ts` calcule et enregistre les itinéraires d'une semaine.

## Fonctions livrées

- **Étapes** : début et fin de journée, chargement, livraison, carburant (Doumen, AS24, DKV ; gasoil, AdBlue). Immatriculations reprises automatiquement ; le début de journée reprend le km de la fin de journée précédente. Lieu par GPS ou autocomplétion (Photon, geo.api.gouv.fr).
- **Vue semaine** avec récap des km, navigation par glissement, liste « Choisir une semaine » groupée par mois et saut à une date.
- **Lettres de voiture (LV)** : plusieurs par chargement, à compléter plus tard, choix des LV « dans le camion » à la livraison, page LV.
- **Photos des LV et lecture automatique** par la fonction Edge `read-waybill`.
- **Cartes** de la semaine et du mois (accès au mois par « Carte du mois » dans la liste des semaines).
- **Options** : mode Europe pour la recherche de villes, exports CSV (étapes et LV), compteur des lectures automatiques du mois.

## Choix déjà faits (ne pas reproposer sans raison nouvelle)

- **Chronologie Google abandonnée** (vrais trajets GPS) : pas d'API, export manuel seulement, recalage OSRM peu fiable. L'utilisateur a choisi de faire sans.
- **Itinéraires** : OSRM public, profil voiture, calculés **une seule fois** sur demande puis enregistrés (`week_maps`), simplifiés à quelques Ko ; bouton « Régénérer » si les étapes changent. Les étapes sans GPS sont placées au centre de leur ville. Lignes droites au choix.
- **Carte du mois** : un mois = les semaines rangées sous ce mois dans la liste (mois de leur **lundi**), entières ; elle réutilise les cartes des semaines. Une couleur par semaine, points sans numéro, pas de flèches.
- **Lecture des LV** : Claude Haiku par défaut (peu cher), bouton « Relire en mode fiable » avec Opus. Limites côté serveur : 2 lectures par photo, 30 par jour, 300 par mois. Alias de chargeurs (ETEX → Siniat).
- **Mode démo** (`?demo`) uniquement en développement, sans aucun appel à Supabase.
- **Thème sombre**, icônes sobres (lucide), boutons de type petits et de même taille, débuts et fins de journée discrets.

Après chaque nouvelle fonction ou décision importante, **mettre à jour ces deux sections**.
- `data/` : exclu de GitHub (données réelles pour le mode démo). Ne jamais le committer ni recopier son contenu ailleurs dans le dépôt.
