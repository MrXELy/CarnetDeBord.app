# CarnetDeBord.app

Webapp PWA pour un chauffeur routier : noter les étapes de ses trajets (début et fin de journée, chargement, livraison, carburant), ses lettres de voiture et voir le récap de sa semaine. Utilisée surtout sur téléphone, aussi sur PC. Thème sombre, sobre et moderne.

## Règles de travail

- **Réponds toujours en français.** L'utilisateur débute en développement : explique simplement.
- **Avant tout `git push`** : lance le serveur de test local, donne l'adresse pour tester (PC et téléphone), puis **demande l'accord**. Ne jamais pousser sans accord explicite.
- **Le dépôt GitHub est public** : aucune donnée personnelle dans les fichiers commités, tests compris (positions GPS réelles, lieux de base, noms de clients, immatriculations, nom de l'utilisateur). Dans les tests, utiliser des centres de villes publiques (Narbonne, Toulouse, Périgueux…) et des noms génériques.
- `data/` : exclu de GitHub (données réelles pour le mode démo). Ne jamais le committer ni recopier son contenu ailleurs dans le dépôt.
- **Fuites vérifiées avec gitleaks** : avant chaque commit `gitleaks git --pre-commit --staged -v`, avant chaque push `gitleaks git --log-opts="origin/main..HEAD" -v`. S'il trouve quelque chose : ne pas commiter ni pousser, prévenir l'utilisateur. La clé publishable Supabase est ignorée via `.gitleaksignore` (normale, publique). gitleaks ne voit que les secrets : **relire aussi le diff** avant chaque commit pour les données personnelles.
- **Aucune clé secrète dans le code.** La clé Anthropic est seulement dans les secrets Supabase (`ANTHROPIC_API_KEY`). La clé publishable de `src/config.ts` est publique par conception.
- **Services publics gratuits** (itinéraires, villes, fonds de carte…) : avant d'en utiliser un, se renseigner sur ses conditions d'utilisation, les respecter dans le code et les noter dans `.claude/rules/services-publics.md`.
- Style de code : Prettier avec `--single-quote --print-width 120`. Commentaires en français.

## Pile technique

React 19, Vite, TypeScript, vite-plugin-pwa, date-fns (locale fr), lucide-react, jsPDF, Leaflet et Mediabunny (chargés à la demande), vitest. Données dans Supabase (tables `events`, `waybills`, `ocr_usage`, `week_maps`, `user_settings` avec RLS ; stockage privé `waybill-photos` ; fonction Edge `read-waybill`, lecture des LV avec Claude). Inscriptions désactivées.

## Commandes

- `npm install` ; `npm test` (vitest) ; `npm run build` (vérification TypeScript et build).
- `npx vite --host` : serveur de test **en https** (certificat fait maison, accepter l'avertissement la première fois), accessible depuis le téléphone sur le même Wi-Fi (adresse en `/CarnetDeBord.app/`). Le https est nécessaire sur le téléphone (`crypto.randomUUID` et GPS).
- Mode démo local : `?demo` dans l'adresse (développement seulement, lit `data/demo-events.json`, ne contacte pas Supabase) ; `?demo=reset` recharge. Détails : `.claude/rules/demo.md`.
- Fonction Edge : `npx --yes supabase@2.121.0 functions deploy read-waybill --project-ref bjtqghlacclhbjjyarxj --use-api`.
- Migrations SQL (`supabase/migrations/`, 002 à 011) : lancées à la main par l'utilisateur dans l'éditeur SQL de Supabase. Détails : `.claude/rules/supabase.md`.
- `gitleaks git -v` : chercher des secrets dans tout l'historique.
- Mise en ligne : chaque push sur `main` déploie sur GitHub Pages (https://mrxely.github.io/CarnetDeBord.app/).

## Organisation

- `src/lib/sync.ts` : synchro hors ligne d'abord, `EventStore`. **Tout code qui modifie `items` d'une `Collection` doit augmenter `version`.**
- `src/lib/dates.ts` : la semaine commence le **dimanche à 22h**.
- Calculs purs et testés dans `src/lib/` : `rest.ts` (repos RSE), `reminders.ts` (échéances), `fuel.ts`, `stats.ts`, `emptyKm.ts`, `allowances.ts` (frais), `weekSheet.ts` (feuille de semaine), `weekStops.ts`, `weekReplay.ts`, `replayCamera.ts`, `search.ts`.
- Fenêtres en panneau : `src/lib/useSheet.ts` (`ref` sur `.modal-backdrop`, `handle` sur `.modal-header`, `close` à la place de `onClose`). Glissement : `src/lib/useSwipe.ts`.
- `src/components/stats/` : à n'importer que depuis `StatsPage.tsx`. Options, Recherche, page LV, cartes et Statistiques sont chargées avec `lazy`.
- `src/lib/share.ts` : partage ou téléchargement forcé d'un fichier (jamais d'ouverture dans un onglet). L'utilisateur installe l'appli avec Chrome (Firefox Android ne partage pas de fichiers).
- Règles détaillées par thème dans `.claude/rules/` (chargées d'office quand on touche les fichiers concernés) : synchro, LV, repos, échéances, gasoil, statistiques et km à vide, frais, feuille de semaine, cartes et itinéraires, animation, interface.

## Choix déjà faits (ne pas reproposer sans raison nouvelle)

Détails et règles validées avec l'utilisateur dans le fichier de `.claude/rules/` indiqué.

- **Chronologie Google abandonnée** (vrais trajets GPS) : pas d'API, export manuel seulement, recalage OSRM peu fiable.
- **Kilométrage automatique** : pas de Bluetooth du chrono (appli native) ; on lit une photo de l'écran du chrono. Fichier `.ddd` : piste possible plus tard. → `lv.md`
- **Itinéraires** : Valhalla public (FOSSGIS), profil voiture, OSRM en secours ; calculés une seule fois puis enregistrés ; tronçon par tronçon, le plus proche des km du compteur ; choix manuel, villes et points de passage. → `cartes.md`
- **Lecture des LV** : Haiku par défaut, Opus en « mode fiable » ; limites 2/photo, 30/jour, 300/mois ; remarques courtes puis informations. → `lv.md`
- **Consommation** : jamais litres ÷ km d'une même semaine ; Doumen = plein complet, AS24 et DKV = compléments. → `gasoil.md`
- **Statistiques** : semaine au dimanche 22h, mois et année en semaines entières ; km = somme des tronçons entre relevés du même tracteur. → `stats.md`
- **Km à vide** : de la dernière livraison au chargement suivant. → `stats.md`
- **Frais de déplacement** : par journée, d'après débuts et fins de journée seulement. → `frais.md`
- **Feuille de semaine** : chaque chargement et livraison au jour où il a lieu, une ligne par LV ; consommation jamais remplie. → `feuille-semaine.md`
- **Repos RSE** (CE 561/2006) : repos fractionné ignoré, pas de règle des 6 jours. → `repos.md`
- **Mode démo** uniquement en développement, sans aucun appel à Supabase.
- **Style « verre + frise »**, thème sombre, police Manrope, **le plus récent en premier**. → `interface.md`

## Après chaque nouvelle fonction ou décision importante

Mettre à jour le fichier du thème dans `.claude/rules/` (en créer un, avec son en-tête `paths`, si aucun ne convient). N'ajouter une ligne ici que pour une règle de travail ou un choix à ne pas reproposer. Garder ce fichier court.
