---
paths: ["src/lib/route.ts", "src/lib/weekStops.ts", "src/lib/weekStops.test.ts", "src/lib/weekMapGen.ts", "src/lib/weekMapGen.test.ts", "src/components/MapSvg.tsx", "src/components/WeekMap.tsx", "src/components/MonthMap.tsx", "src/components/RouteChoiceSheet.tsx", "src/components/RouteMap.tsx"]
---

# Cartes et itinéraires

Conditions des services utilisés : `services-publics.md`.

## Fichiers

`MapSvg.tsx` : dessin commun des cartes (fond IGN, villes repères, tracés, export PNG). `WeekMap.tsx` et `MonthMap.tsx` : cartes de la semaine et du mois ; `WeekMap` avec `day` : carte d'une journée (lieux pris par `dayStops` dans `src/lib/weekStops.ts`) ; `src/lib/weekMapGen.ts` calcule et enregistre les itinéraires d'une semaine.

## Cartes de la semaine, du mois et d'une journée

- Accès au mois par « Carte du mois » dans la liste des semaines ; à une journée par la petite pastille carte à côté du nom du jour dans la semaine, ou en touchant un jour dans la légende de la carte de la semaine ; depuis les Statistiques, pastille sous le titre de la période (pas pour l'année).
- Carte d'une journée : ses lieux renumérotés, départ du dernier lieu de la veille, chaque lieu avec seulement les étapes du jour ; itinéraires de la carte de la semaine (sinon lignes droites, bouton « Générer la semaine ») ; même ▶ pour la rejouer.
- Réglages retenus sur l'appareil : itinéraires ou lignes droites, « France entière » (sinon cadrée sur les trajets), villes, départements, et numéros des étapes (carte de la semaine).
- **Carte du mois** : un mois = les semaines rangées sous ce mois dans la liste (mois de leur **lundi**), entières ; elle réutilise les cartes des semaines. Une couleur par semaine, points sans numéro, pas de flèches.
- **Numéros masqués** (carte de la semaine) : un petit point par étape, sans regroupement des lieux proches ; la liste sous la carte garde les numéros. **France entière** : toute la métropole, agrandie si un trajet en sort. **Enregistrer l'image** : bouton rond à icône posé en bas à droite de la carte ; seul « Générer / Régénérer » reste sous la carte.

## Itinéraires (choix faits)

- Valhalla public (FOSSGIS, `valhalla1.openstreetmap.de`), profil voiture (choisi par l'utilisateur : on compare aux km réels, le profil camion n'apporte rien), OSRM public en secours ; calculés **une seule fois** sur demande puis enregistrés (`week_maps`), simplifiés à quelques Ko ; bouton « Régénérer » toujours proposé (mis en avant si les étapes ont changé, discret sinon).
- Calcul **tronçon par tronçon** (d'un lieu au suivant) : Valhalla propose jusqu'à 3 itinéraires, on garde celui dont la longueur est la plus proche des **km relevés au compteur** (même tracteur, écart de 1 à 2000 km), sinon le plus rapide (`stopSegments`, `closestRoute`). Le serveur public d'OSRM ne propose jamais d'autre itinéraire. Une semaine d'environ 20 tronçons prend une vingtaine de secondes (une demande par seconde).
- Un itinéraire enregistré par tronçon (`MapLeg` : `key`, `km`, `manual` ; anciennes cartes : un tracé par jour, sans `key`), mis bout à bout par jour pour le dessin (`joinDayLegs`). Les étapes sans GPS sont placées au centre de leur ville. Lignes droites au choix.

## Choisir l'itinéraire (`RouteChoiceSheet.tsx`, chargée à la demande)

- Dans la liste de la carte de la semaine, entre deux lieux qui se suivent, bouton « Itinéraire : X km · compteur Y km » (cachés au départ : lien « Choix d'itinéraire » / « Cacher le choix d'itinéraire » sous « Régénérer », réglage retenu sur l'appareil : `mapRouteButtons`). La fenêtre redemande les itinéraires du tronçon, les dessine en couleurs, avec durée, écart au compteur, « conseillé » (le plus proche du compteur) et « ACTUEL » ; le choix est enregistré (`withChosenRoute`, `manual: true`) et gardé à la régénération sans nouveau calcul.
- **« Passer par une ville… »** (`routeVia` dans `src/lib/route.ts`) : ville choisie avec l'autocomplétion (sans GPS), deux itinéraires ajoutés, « par le centre de X » (rue la plus proche du centre de la commune) et « par la grande route près de X » (voie rapide ou nationale la plus proche, `search_filter: min_road_class trunk` ; montré seulement s'il diffère du premier), le plus proche du compteur sélectionné d'office ; « Ajouter une autre ville » pour plusieurs villes dans l'ordre (retirables). Valhalla ne propose pas d'autres itinéraires avec une ville de passage. Le texte (« par le centre de Gaillac ») est gardé avec le tronçon (`MapLeg.via`) et affiché sur son bouton ; un itinéraire enregistré absent des propositions reste en tête de liste (« ACTUEL »). Validé après essais : par le centre ajoute la traversée de la ville, la grande route se raccroche parfois à une autre route ; le compteur tranche.
- **Placer un point** (bouton rond à icône de pin posé en bas à droite de la carte, orange avec une croix pour annuler pendant le placement ; puis toucher la carte ; pas d'appui long : choix de l'utilisateur ; « Passer par une ville… » reste sous la carte) : point pris tel quel, rayon de recherche de la route selon le zoom (`tapRadius`, 20 pixels, 15 à 300 m : sans rayon, Valhalla peut prendre l'autre sens d'une autoroute et imposer un demi-tour), nommé d'après sa commune (`communeAt`, geo.api.gouv.fr : « par un point près de Souillac »), déplaçable au doigt (recalcul au lâcher), sans recadrage de la carte.
- Villes et points se cumulent, **rangés du départ vers l'arrivée** (`orderWaypoints`), le choix dans la liste est retenu par clé. **Points de passage enregistrés avec l'itinéraire choisi** (`MapLeg.waypoints`) : à la réouverture, ils reviennent sur la carte et dans « Passage par », modifiables ; l'itinéraire enregistré reste sélectionné (« ACTUEL ») tant qu'on ne touche à rien, sans doublon si le nouveau calcul retombe dessus. Choisir un itinéraire proposé efface les points.
- **Carte navigable** dans cette fenêtre seulement (`RouteMap.tsx`, Leaflet) : zoom, déplacement, toucher un tracé le choisit ; fond **Plan IGN** gardé clair malgré le thème sombre (choix de l'utilisateur) ; les cartes de la semaine et du mois restent en SVG.
