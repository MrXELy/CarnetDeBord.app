---
paths: ["src/lib/stats.ts", "src/lib/stats.test.ts", "src/lib/emptyKm.ts", "src/lib/emptyKm.test.ts", "src/lib/search.ts", "src/components/StatsPage.tsx", "src/components/stats/**", "src/components/SearchPage.tsx"]
---

# Statistiques, km à vide et recherche

## Statistiques (`StatsPage.tsx`, calculs dans `src/lib/stats.ts`)

- Jour / Semaine / Mois / Année, flèches et glissement, titre à toucher pour aller à une date, bouton de retour à la période en cours ; gros km avec comparaison, tuiles (heures, moyenne par jour, chargements, livraisons, gasoil consommé, conso), barres des km (toucher une barre ouvre la période), sections repliables : gasoil (courbe des derniers pleins, par station, AdBlue), temps de travail, clients et lieux, calendrier du mois, records et km par tracteur. Vue Jour : étapes de la journée et repos avant.
- Clients et lieux : chargeurs et destinataires comptés par nom, sans tenir compte de la ville ; un nom qui contient un autre client connu comme mot entier est regroupé sous lui (`clientGrouper`, aucun nom de client dans le code) ; départements des chargements et livraisons, ou pays hors de France ; tonnage ; temps sur place (`onSiteTimes`) : moyenne de la période et clients où l'on reste le plus longtemps (une fois par étape et par client, plus de 24 h ou fin avant l'arrivée ignorées).
- Page laissée ouverte : « maintenant » rafraîchi au passage d'une limite de période, au retour sur la page, ou toutes les 10 min au plus (`nowIsStale`).
- Pastille « Carte du jour / de la semaine / du mois » sous le titre de la période (pas pour l'année).
- **Règles** : semaine au dimanche 22h ; mois et année = semaines entières dont le lundi y tombe. Comparaison avec la période d'avant **coupée au même moment** si la période est en cours. Km d'une période = somme des **tronçons** entre deux relevés qui se suivent avec le même tracteur, dont les deux relevés sont dans la période ; pas comptés : le repos (fin de journée → début suivant), un changement de tracteur sans relevé, les relevés incohérents (km qui baisse, saut de plus de 2000 km). Plaques comparées avec `plateKey`. Le même calcul donne les km de l'accueil, des jours, de la liste des semaines et des cartes (`periodKm` dans `src/lib/dates.ts`). Pas de badges pour l'instant.

## Km à vide (`src/lib/emptyKm.ts`, mémorisé dans `EventStore.kmTimeline()`)

- Affichage : « dont X km à vide · Y % » sous le gros km (toutes les vues), section « Km à vide » (semaine, mois, année : barre en charge / à vide, part comparée à la période d'avant, nombre de trajets à vide et moyenne, le plus long qui ouvre son jour, détail par tracteur s'il y en a plusieurs, trajets incomplets signalés) et part à vide en gris dans les barres des km.
- **Règles validées avec l'utilisateur** : de la **dernière livraison au chargement suivant**, retour à la maison et trajet du matin jusqu'au premier chargement compris ; chargement le vendredi et livraison le lundi = en charge. Livraison suivie d'une livraison = en charge. Une LV chargée avant et livrée après la livraison = pas à vide ; après la dernière livraison notée, à vide sauf s'il reste une LV dans le camion (une LV oubliée ne bloque pas un trajet terminé). Même calcul par tronçons que les km : jamais de soustraction entre deux compteurs ; partie inconnue non comptée et trajet signalé « incomplet ». Avant la première opération ou si une étape sans km change l'état en route : état inconnu, non compté. Part = à vide ÷ (à vide + en charge). Un trajet compte (nombre, moyenne, plus long) dans la période de son chargement.

## Recherche globale (loupe en haut, `SearchPage.tsx`, `src/lib/search.ts`)

Dans toutes les étapes et leurs LV (ville, département, client, chargeur, destinataire, n° de LV, marchandise, notes, station, plaque avec ou sans tirets, km, type d'étape), sans accents ni majuscules, tous les mots doivent se retrouver. Résultats groupés par jour, les plus récents en premier (100 au plus) ; toucher une étape ferme la recherche et l'affiche dans sa semaine (défilement jusqu'à elle et brève lueur) ; la dernière recherche est gardée à la réouverture.
