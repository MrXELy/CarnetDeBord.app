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
- **Lettres de voiture (LV)** : plusieurs par chargement, à compléter plus tard, choix des LV « dans le camion » à la livraison, page LV. Un nouveau chargement reçoit d'office une LV vide (Scanner/Saisir la remplissent). La « Ville de chargement » d'une LV est le lieu de son étape de chargement : la modifier depuis la fiche change l'étape (`EventStore.setEventPlace`), donc aussi ses autres LV.
- **Photos des LV et lecture automatique** par la fonction Edge `read-waybill`.
- **Kilométrage en photo** : bouton appareil photo à côté du km ; la même fonction `read-waybill` (`kind: 'odometer'`, Haiku) lit l'écran du chrono (VDO DTCO à l'arrêt : « 123456.7km ») ou le compteur. Photo envoyée directement, non stockée, comptée dans les mêmes limites. Alerte si le km est inférieur au dernier relevé ou s'il y a plus de 2000 km d'écart.
- **Cartes** de la semaine et du mois (accès au mois par « Carte du mois » dans la liste des semaines).
- **Options** : mode Europe pour la recherche de villes, exports CSV (étapes et LV), compteur des lectures automatiques du mois.

## Choix déjà faits (ne pas reproposer sans raison nouvelle)

- **Chronologie Google abandonnée** (vrais trajets GPS) : pas d'API, export manuel seulement, recalage OSRM peu fiable. L'utilisateur a choisi de faire sans.
- **Itinéraires** : OSRM public, profil voiture, calculés **une seule fois** sur demande puis enregistrés (`week_maps`), simplifiés à quelques Ko ; bouton « Régénérer » si les étapes changent. Les étapes sans GPS sont placées au centre de leur ville. Lignes droites au choix.
- **Carte du mois** : un mois = les semaines rangées sous ce mois dans la liste (mois de leur **lundi**), entières ; elle réutilise les cartes des semaines. Une couleur par semaine, points sans numéro, pas de flèches.
- **Lecture des LV** : Claude Haiku par défaut (peu cher), bouton « Relire en mode fiable » avec Opus. Limites côté serveur : 2 lectures par photo, 30 par jour, 300 par mois. Alias de chargeurs (ETEX → Siniat).
- **Kilométrage automatique** : le Bluetooth du chrono (DTCO 4.1, interface ITS) demanderait une appli native et rien ne garantit qu'il donne le km ; on lit une photo de l'écran du chrono à la place. Fichier `.ddd` de la carte conducteur : piste possible plus tard pour vérifier les km.
- **Mode démo** (`?demo`) uniquement en développement, sans aucun appel à Supabase.
- **Thème sombre**, icônes sobres (lucide), boutons de type petits et de même taille, débuts et fins de journée discrets.
- **Style « verre + frise »** (choisi sur maquettes) : fond très sombre avec halos de couleur qui dérivent, cartes translucides, frise verticale avec un point de couleur par étape (rond creux pour début et fin de journée), police **Manrope** (paquet npm, gardée hors ligne), gros km de la semaine en dégradé. Animations douces (fenêtres qui montent du bas, étapes en fondu, glissement de semaine), coupées si le téléphone demande de réduire les animations. **Ordre inchangé : le plus récent en premier.** Fenêtres en panneaux de verre qui montent du bas (formulaires, LV, Options, semaines, cartes) ; types d'étape en 3 colonnes à la couleur du type ; étiquette « LU » sur les champs de LV remplis par la lecture ; état coloré des LV dans leur page ; barre des lectures du mois dans les Options. Pas de bande bleue sur les plaques.

Après chaque nouvelle fonction ou décision importante, **mettre à jour ces deux sections**.
- `data/` : exclu de GitHub (données réelles pour le mode démo). Ne jamais le committer ni recopier son contenu ailleurs dans le dépôt.
