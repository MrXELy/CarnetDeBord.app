---
paths: ["src/lib/waybills.ts", "src/lib/places.ts", "src/lib/ocr.ts", "src/lib/odometer.ts", "src/lib/liveReading.ts", "src/lib/photos.ts", "src/components/Waybill*.tsx", "src/components/EventForm.tsx", "src/components/EventCard.tsx", "src/components/ReadingDetails.tsx", "src/components/PhotoViewer.tsx", "supabase/functions/read-waybill/**"]
---

# Étapes, lettres de voiture (LV), photos et lecture automatique

## Étapes

Début et fin de journée, chargement, livraison, carburant (Doumen, AS24, DKV ; gasoil, AdBlue). Immatriculations reprises automatiquement ; le début de journée reprend le km de la fin de journée précédente. Lieu par GPS ou autocomplétion (Photon, geo.api.gouv.fr).

**Fin d'un chargement ou d'une livraison** (`finished_at`, migration 012 ; calculs dans `src/lib/onSite.ts`) : le chauffeur note l'étape **en arrivant** (heure de l'étape = arrivée), puis un bouton juste au-dessus de la barre du bas (`FinishStepButton.tsx`, « Fin du chargement », lieu, « Arrivée à … » sur 3 lignes) enregistre l'heure de fin d'un appui. Il reste tant que la fin n'est pas validée et **disparaît si une autre étape est notée après** (fin laissée vide). Champ « Fin » facultatif dans la fiche (corrigeable, refusé avant l'arrivée), **prérempli avec l'heure d'arrivée** tant qu'il n'est pas saisi (rien n'est alors enregistré) ; la carte de l'étape montre « 08:12 → 09:40 » (pas de durée sur place). Fin égale à l'arrivée : pas comptée dans les calculs. Colonne « Heure de fin » dans l'export CSV.

## LV

- Plusieurs par chargement, à compléter plus tard, choix des LV « dans le camion » à la livraison, page LV (glisser à gauche ou à droite change d'onglet : À compléter, Dans le camion, Toutes ; sans boucler ; LV regroupées par semaine de chargement, « Cette semaine » en premier). Un nouveau chargement reçoit d'office une LV vide (Scanner/Saisir la remplissent).
- La « Ville de chargement » et les dates de chargement et de livraison d'une LV sont celles de ses étapes : les modifier depuis la fiche change les étapes (`EventStore.setEventPlace`, `setEventTime`, `applyStepChanges` dans `src/lib/places.ts`), donc aussi leurs autres LV. Date de livraison seulement pour une LV livrée.
- Fiche LV en **lecture seule** à l'ouverture (texte simple, photos à regarder sans poubelle, champs vides cachés, n° « À compléter ») ; bouton « Modifier » en bas pour la saisie ; nouvelle LV ou LV encore vide (`isBlankWaybill`) : saisie directe, avec un gros bouton « Scanner la lettre de voiture » à la place des photos tant qu'il n'y en a pas.
- Seule la première photo est lue automatiquement ; les suivantes (bons de livraison…) sont seulement ajoutées (« Lire la photo » à la demande, sur la dernière photo).
- Dans les fiches de chargement et de livraison, un œil à droite de chaque LV ouvre sa fiche (crayon si la LV est encore vide : elle s'ouvre en saisie). Plus de croix pour retirer : « Supprimer la lettre » dans la fiche, effectif à l'enregistrement de l'étape.
- Fiche LV (maquette « Lettre de voiture ») : état en étiquette à côté du titre (À compléter, Dans le camion, Livrée), photos, remarques en tuile ambre, tuile bleue « Chargement » (ville, jour et heure) et tuile verte « Livraison prévue » / « Livraison » côte à côte, puis une ligne par champ (N° LV, expéditeur, destinataire, marchandise, poids ; « À compléter » en ambre). Bas toujours visible : « Modifier » en lecture ; corbeille, « Relire en mode fiable » et « Enregistrer » en saisie. L'ancienne pastille « Chargée / Livrée » (`waybillContext`) est retirée.
- Une LV sans étape de chargement (créée à la livraison) montre quand même ville et date de chargement : remplies, elles créent l'étape de chargement (sans km, plaques de la livraison ; `addLoadingStep`), enregistrée avec la livraison ou tout de suite depuis la page LV. Une nouvelle LV saisie à la livraison est livrée ici dès l'ouverture de sa fiche (date de livraison affichée).
- Choisir un chargement existant : pas encore fait.

## Photos et lecture automatique (fonction Edge `read-waybill`)

- **Pendant la lecture** : tuile des étapes cochées au fur et à mesure (préparation, envoi, « L'IA regarde la photo » ou relecture fiable ; `step` de l'état `busy`), avec la dernière remarque de l'IA dessous. Après : une ligne sous la photo montre la dernière remarque ou information écrite par l'IA, bouton « Détails » (`ReadingDetails.tsx`) avec ses remarques, ce qu'elle a lu ou non, durée et coût, ou la raison de l'échec (`src/lib/liveReading.ts` lit la réponse inachevée). Lecture en direct pour les LV seulement (`stream: true`, une ligne JSON par message) ; le kilométrage reste en une fois. L'appli accepte encore l'ancienne réponse en une fois. En mode démo, lecture simulée.
- **Choix** : Claude Haiku par défaut (peu cher), bouton « Relire en mode fiable » avec Opus. Limites côté serveur : 2 lectures par photo, 30 par jour, 300 par mois. Alias de chargeurs (ETEX → Siniat). L'IA écrit d'abord de courtes remarques (`remarks`) pour le chauffeur, puis les informations ; on n'affiche pas son raisonnement interne. Étiquette « LU » sur les champs remplis par la lecture (verte, orange si l'IA n'est pas sûre : liste `uncertain`, aussi marquée « pas sûr » dans les Détails).
- **Marchandise** : l'IA recopie une ligne unique, ou résume plusieurs lignes en une ligne courte (total par unité + nature générale, 80 caractères au plus) ; l'utilisateur garde ce résumé, même avec le champ plus grand.
- Photos d'une LV supprimée, retirées d'une fiche ou prises dans une fiche fermée sans enregistrer : corbeille locale (`trashPhotos`, `cdb.photo-trash`) vidée à chaque synchro. La file d'envoi des photos (IndexedDB) et la corbeille sont communes au navigateur : seules les photos de l'utilisateur connecté (chemin `<id>/…`) sont envoyées ou effacées, jamais celles du mode démo (`demo/…`) ou d'un autre compte.
- Ménage quotidien des photos orphelines de plus de 24 h (fonction SQL `orphan_waybill_photos`, migration 007), et bouton « Nettoyer » dans les Options (photos de plus d'1 h, dit combien de plus récentes attendent).

## Kilométrage en photo

Bouton « Lire le km sur le chrono » sous le compteur ; la même fonction `read-waybill` (`kind: 'odometer'`, Haiku) lit l'écran du chrono (VDO DTCO à l'arrêt : « 123456.7km ») ou le compteur. Photo envoyée directement, non stockée, comptée dans les mêmes limites. Alerte si le km est inférieur au dernier relevé ou s'il y a plus de 2000 km d'écart. Choix : pas de Bluetooth du chrono (DTCO 4.1, interface ITS : appli native, km pas garanti) ; fichier `.ddd` de la carte conducteur, piste possible plus tard pour vérifier les km.
