---
paths: ["src/lib/weekReplay.ts", "src/lib/weekReplay.test.ts", "src/lib/replayCamera.ts", "src/lib/replayCamera.test.ts", "src/lib/replayDraw.ts", "src/lib/replayDraw.test.ts", "src/lib/replayVideo.ts", "src/components/WeekReplay.tsx"]
---

# Semaine, journée et mois rejoués

## Fichiers

`src/lib/weekReplay.ts` : chronologie (calcul pur, testé) ; `src/lib/replayCamera.ts` : caméra (calcul pur, testé) ; `src/lib/replayDraw.ts` : dessin d'une image sur un canvas, fond de carte compris (contours en `Path2D`, net à tous les zooms), sert à l'aperçu et à la vidéo, noms des villes placés par `placeLabels` (calcul pur, testé) ; `src/components/WeekReplay.tsx` : fenêtre (chargée à la demande), commune à la semaine, à la journée et au mois (`heading`, `title`, `fileName`) ; `src/lib/replayVideo.ts` : vidéo.

## Fonctionnement

- Bouton rond ▶ en bas à gauche de la carte de la semaine ; aussi **Journée rejouée** sur la carte d'une journée et **Mois rejoué** sur la carte du mois (tous les lieux du mois à la suite avec les itinéraires des semaines à jour).
- Animation chronologique sur le fond sombre des cartes (France, départements, villes) : tracés qui se dessinent à la couleur du jour, camion (point blanc), lieux atteints avec le **nom de leur ville** (toute étape ; seulement les lieux du jour affiché : au passage au jour suivant, les noms des jours d'avant s'effacent, les points restent ; une ville écrite une seule fois, au passage le plus récent ; noms qui se chevauchent laissés de côté, les plus récents d'abord ; effacés pendant les 1,5 premières secondes du dézoom final), jour et heure en haut, km parcourus et étape en bas (« Chargement — Colomiers (31) », « Vers … », « Repos · 14 h 15 — Villeneuve-sur-Lot (47) » avec carte assombrie), barre d'avancement. **Pas de nom de client** (vidéo pour l'utilisateur seul).
- **Camion à vitesse constante à l'écran** (durée d'un trajet selon la longueur de son tracé, choix de l'utilisateur), arrêts 1,6 s et repos 2,6 s (`STOP_SECONDS`, `REST_SECONDS`), réduits seulement s'ils dépassent 60 % de la durée choisie (un message donne alors la durée minimale pour tout lire) ; départ après une fin de journée ou trajet de plus de 12 h : repos puis trajet à 70 km/h.
- **Caméra** proche du camion (largeur de la vue réglable, 100 à 1000 km, 280 par défaut, retenue sur l'appareil : `replayViewKm` ; au moins cette largeur, recule sur les longs trajets : elle couvre le trajet de ± 2,5 s autour de l'instant), lissée (moyenne en cloche sur ± 2,4 s), calculée d'après le moment de l'animation (même image en lecture, au curseur et en vidéo) ; **à la fin, dézoom de 2,5 s sur toute la semaine puis 2 s de pause** avec « 5 jours · 15 lieux » (`OUTRO_SECONDS` ajoutées à la durée choisie). Fond de carte redessiné à chaque image (villes repères selon le zoom). Itinéraires enregistrés par tronçon, sinon lignes droites.
- Format vertical (1080 × 1920) ou carré (1080 × 1080) et durée (15 à 120 s), retenus sur l'appareil (`replayFormat`, `replayDuration`). Lecture, pause, curseur pour avancer à la main.
- **Créer la vidéo** : MP4 1080 px, 30 images/s, fabriqué image par image avec WebCodecs (Mediabunny, codec : le premier que le navigateur sait encoder, H.264 en général), plus vite que la lecture, sans serveur ; avancement en %, Annuler ; puis bouton « Partager la vidéo (13 Mo) » (geste séparé : le partage doit suivre un toucher) : menu de partage sur téléphone, téléchargement sur PC (`shareFile`). Navigateur sans WebCodecs (Firefox Android) : message « ouvre l'appli avec Chrome ». Vidéo périmée si un réglage change.
