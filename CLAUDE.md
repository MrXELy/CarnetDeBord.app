# CarnetDeBord.app

Webapp PWA pour un chauffeur routier : noter les étapes de ses trajets (début et fin de journée, chargement, livraison, carburant), ses lettres de voiture et voir le récap de sa semaine. Utilisée surtout sur téléphone, aussi sur PC. Thème sombre, sobre et moderne.

## Règles de travail

- **Réponds toujours en français.** L'utilisateur débute en développement : explique simplement.
- **Avant tout `git push`** : lance le serveur de test local, donne l'adresse pour tester (PC et téléphone), puis **demande l'accord**. Ne jamais pousser sans accord explicite.
- **Le dépôt GitHub est public** : aucune donnée personnelle dans les fichiers commités, tests compris (positions GPS réelles, lieux de base, noms de clients, immatriculations, nom de l'utilisateur). Dans les tests, utiliser des centres de villes publiques (Narbonne, Toulouse, Périgueux…) et des noms génériques.
- **Fuites vérifiées avec gitleaks** pour les secrets : avant chaque commit `gitleaks git --pre-commit --staged -v`, avant chaque push `gitleaks git --log-opts="origin/main..HEAD" -v`. Si gitleaks trouve quelque chose : ne pas commiter ni pousser, prévenir l'utilisateur. La clé publishable Supabase est ignorée via `.gitleaksignore` (normale, publique). gitleaks ne voit que les secrets : **relire aussi le diff** avant chaque commit pour les données personnelles (GPS, lieux, clients, immatriculations, nom).
- **Aucune clé secrète dans le code.** La clé Anthropic est seulement dans les secrets Supabase (`ANTHROPIC_API_KEY`). La clé publishable Supabase de `src/config.ts` est publique par conception.
- Style de code : Prettier avec `--single-quote --print-width 120`. Commentaires en français.

## Pile technique

React 19, Vite, TypeScript, vite-plugin-pwa, date-fns (locale fr), lucide-react, vitest. Données dans Supabase (tables `events`, `waybills`, `ocr_usage`, `week_maps`, `user_settings` avec RLS ; stockage privé `waybill-photos` ; fonction Edge `read-waybill` pour la lecture automatique des LV avec Claude). Inscriptions désactivées.

## Commandes

- `npm install` : installer les dépendances.
- `npx vite --host` : serveur de test, accessible depuis le téléphone sur le même Wi-Fi (adresse en `/CarnetDeBord.app/`).
- `npm test` : tests (vitest). `npm run build` : vérification TypeScript et build.
- `gitleaks git -v` : chercher des secrets dans tout l'historique (installé avec `brew install gitleaks`).
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
- **Lettres de voiture (LV)** : plusieurs par chargement, à compléter plus tard, choix des LV « dans le camion » à la livraison, page LV. Un nouveau chargement reçoit d'office une LV vide (Scanner/Saisir la remplissent). La « Ville de chargement » et les dates de chargement et de livraison d'une LV sont celles de ses étapes : les modifier depuis la fiche change les étapes (`EventStore.setEventPlace`, `setEventTime`, `applyStepChanges` dans `src/lib/places.ts`), donc aussi leurs autres LV. Date de livraison seulement pour une LV livrée. Une LV sans étape de chargement (créée à la livraison) montre quand même ville et date de chargement : remplies, elles créent l'étape de chargement (sans km, plaques de la livraison ; `addLoadingStep`), enregistrée avec la livraison ou tout de suite depuis la page LV. Une nouvelle LV saisie à la livraison est livrée ici dès l'ouverture de sa fiche (date de livraison affichée). Choisir un chargement existant : pas encore fait.
- **Photos des LV et lecture automatique** par la fonction Edge `read-waybill`. Photos d'une LV supprimée, retirées d'une fiche ou prises dans une fiche fermée sans enregistrer : mises dans une corbeille locale (`trashPhotos`, `cdb.photo-trash`) vidée à chaque synchro. Ménage quotidien des photos orphelines de plus de 24 h (fonction SQL `orphan_waybill_photos`, migration `007_orphan_photos.sql`), et bouton « Nettoyer » dans les Options (photos de plus d’1 h, dit combien de plus récentes attendent).
- **Kilométrage en photo** : bouton appareil photo à côté du km ; la même fonction `read-waybill` (`kind: 'odometer'`, Haiku) lit l'écran du chrono (VDO DTCO à l'arrêt : « 123456.7km ») ou le compteur. Photo envoyée directement, non stockée, comptée dans les mêmes limites. Alerte si le km est inférieur au dernier relevé ou s'il y a plus de 2000 km d'écart.
- **Gasoil** : interrupteur « Plein complet » sur l'étape carburant (colonne `full_tank`, migration `005_full_tank.sql`), réglé d'office selon la station. Conso calculée d'un plein complet au suivant par tracteur, compléments compris (`src/lib/fuel.ts`) ; `fuelReport` donne pour une période le gasoil acheté et le gasoil consommé (km × conso de l'intervalle, ou conso habituelle des 4 derniers pleins si pas encore de plein). Affichée sur la carte du plein et dans les Options.
- **Cartes** de la semaine et du mois (accès au mois par « Carte du mois » dans la liste des semaines).
- **Statistiques** (bouton graphique en haut, `StatsPage.tsx`, calculs dans `src/lib/stats.ts`) : Jour / Semaine / Mois / Année, flèches et glissement, titre à toucher pour aller à une date, bouton de retour à la période en cours ; gros km avec comparaison, tuiles (heures, moyenne par jour, chargements, livraisons, gasoil consommé, conso), barres des km (toucher une barre ouvre la période), sections repliables : gasoil (courbe des derniers pleins, par station, AdBlue), temps de travail, clients et lieux (chargeurs et destinataires comptés par nom, sans tenir compte de la ville, un nom qui contient un autre client connu comme mot entier est regroupé sous lui (`clientGrouper`, aucun nom de client dans le code) ; départements des chargements et livraisons, ou pays hors de France ; tonnage ; anciennes étapes sans LV : champ `client` de l'étape), calendrier du mois, records et km par tracteur. Vue Jour : étapes de la journée et repos avant.
- **Recherche globale** (loupe en haut, `SearchPage.tsx`, `src/lib/search.ts`) : dans toutes les étapes et leurs LV (ville, département, client, chargeur, destinataire, n° de LV, marchandise, notes, station, plaque avec ou sans tirets, km, type d'étape), sans accents ni majuscules, tous les mots doivent se retrouver. Résultats groupés par jour, les plus récents en premier (100 au plus) ; toucher une étape ferme la recherche et l'affiche dans sa semaine (défilement jusqu'à elle et brève lueur) ; la dernière recherche est gardée à la réouverture.
- **Frais de déplacement** (`src/lib/allowances.ts`) : pastille « Frais … € » sous la semaine, à côté de la pastille « Carte » (carte de la semaine) (détail dans `AllowancesSheet.tsx`), tuile et section « Frais de route » dans les Statistiques (semaine, mois, année ; pas par jour). Bases et tarifs (avec date d'effet) dans les Options, enregistrés dans la table `user_settings` (migration `006_user_settings.sql`, une ligne par utilisateur, id = son identifiant), jamais dans le code.
- **Options** : mode Europe pour la recherche de villes, exports CSV (étapes et LV), compteur des lectures automatiques du mois.

## Choix déjà faits (ne pas reproposer sans raison nouvelle)

- **Chronologie Google abandonnée** (vrais trajets GPS) : pas d'API, export manuel seulement, recalage OSRM peu fiable. L'utilisateur a choisi de faire sans.
- **Itinéraires** : OSRM public, profil voiture, calculés **une seule fois** sur demande puis enregistrés (`week_maps`), simplifiés à quelques Ko ; bouton « Régénérer » si les étapes changent. Les étapes sans GPS sont placées au centre de leur ville. Lignes droites au choix.
- **Carte du mois** : un mois = les semaines rangées sous ce mois dans la liste (mois de leur **lundi**), entières ; elle réutilise les cartes des semaines. Une couleur par semaine, points sans numéro, pas de flèches.
- **Lecture des LV** : Claude Haiku par défaut (peu cher), bouton « Relire en mode fiable » avec Opus. Limites côté serveur : 2 lectures par photo, 30 par jour, 300 par mois. Alias de chargeurs (ETEX → Siniat).
- **Kilométrage automatique** : le Bluetooth du chrono (DTCO 4.1, interface ITS) demanderait une appli native et rien ne garantit qu'il donne le km ; on lit une photo de l'écran du chrono à la place. Fichier `.ddd` de la carte conducteur : piste possible plus tard pour vérifier les km.
- **Consommation** : jamais litres ÷ km d'une même semaine (compléments de 200-300 L, semaines sans plein). **Doumen = toujours plein complet**, AS24 et DKV = compléments (modifiable à la saisie ; anciennes étapes sans `full_tank` déduites de la station). Intervalle écarté si km ou litres manquants ou conso hors 15–50 L/100.
- **Statistiques** : mêmes règles que le reste (semaine au dimanche 22h ; mois et année = semaines entières dont le lundi y tombe). Comparaison avec la période d'avant **coupée au même moment** si la période est en cours. Km d'une période = du plus petit au plus grand relevé, tracteur par tracteur. Pas de badges pour l'instant.
- **Frais de déplacement** (règles validées sur les vraies semaines avec l'utilisateur) : calcul par journée de travail d'après l'heure et le lieu des **débuts et fins de journée** seulement. Fin hors des bases → GD 2 repas + découcher si la journée couvre 11h45–14h15, sinon GD 1 repas. Fin à une base → repas midi (11h45–14h15) et soir (18h45–21h15). Casse-croûte : départ strictement avant 5h **et pas de découcher la veille** (sinon compris dans le GD). Repas unique de nuit : 4 h entre 22h et 7h, sans casse-croûte ni découcher la veille. Prime départ lundi : dimanche ≥ 22h ou lundi < 2h. Jour sans étape après un découcher (bloqué), compté quand la reprise est notée : GD 2 repas ; + prime bloqué le dimanche et les jours fériés (pas le samedi). Tarif étranger si la fin (GD) ou une étape du jour (repas) est hors de France. Tarifs de l'entreprise au 1er janvier 2026 par défaut ; prime bloqué à saisir. Pas de correction à la main pour l'instant.
- **Mode démo** (`?demo`) uniquement en développement, sans aucun appel à Supabase.
- **Thème sombre**, icônes sobres (lucide), boutons de type petits et de même taille, débuts et fins de journée discrets.
- **Style « verre + frise »** (choisi sur maquettes) : fond très sombre avec halos de couleur qui dérivent, cartes translucides, frise verticale avec un point de couleur par étape (rond creux pour début et fin de journée), police **Manrope** (paquet npm, gardée hors ligne), gros km de la semaine en dégradé. Animations douces (fenêtres qui montent du bas, étapes en fondu, glissement de semaine), coupées si le téléphone demande de réduire les animations. **Ordre inchangé : le plus récent en premier.** Fenêtres en panneaux de verre qui montent du bas (formulaires, LV, Options, semaines, cartes) ; types d'étape en 3 colonnes à la couleur du type ; étiquette « LU » sur les champs de LV remplis par la lecture ; état coloré des LV dans leur page ; barre des lectures du mois dans les Options. Pas de bande bleue sur les plaques. **Barre du haut** : nom, pastille de synchro (vert à jour, orange en attente ou hors ligne avec le nombre, rouge erreur : toucher pour réessayer), puis Rechercher, LV, Statistiques, Options ; « Se déconnecter » est en bas des Options.

Après chaque nouvelle fonction ou décision importante, **mettre à jour ces deux sections**.
- `data/` : exclu de GitHub (données réelles pour le mode démo). Ne jamais le committer ni recopier son contenu ailleurs dans le dépôt.
