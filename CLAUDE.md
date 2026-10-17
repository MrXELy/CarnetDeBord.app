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
- `src/components/WeekMap.tsx` : carte de la semaine (SVG, itinéraires OSRM générés une fois et enregistrés dans `week_maps`).
- `data/` : exclu de GitHub (données réelles pour le mode démo). Ne jamais le committer ni recopier son contenu ailleurs dans le dépôt.
