---
paths: ["src/lib/route.ts", "src/lib/geo.ts", "src/lib/weekMapGen.ts", "src/components/PlaceField.tsx", "src/components/RouteMap.tsx", "src/components/RouteChoiceSheet.tsx", "src/components/MapSvg.tsx"]
---

# Conditions d'utilisation des services publics gratuits

À vérifier avant d'utiliser un nouveau service, à respecter dans le code, à noter ici.

- **FOSSGIS (Valhalla)** : au plus une demande par seconde par serveur (`politeFetch` dans `src/lib/route.ts`, 1,1 s d'écart), mention OpenStreetMap avec lien « signaler une erreur » sous les cartes (`MapCredits`), adresse de contact sur le site (pas d'adresse affichée : choix de l'utilisateur, pour ne mettre aucune donnée personnelle dans le dépôt public).
- **OSRM public** : en secours de Valhalla.
- **Photon (komoot)** : usage raisonnable (pas de chiffre, limité en cas d'abus).
- **geo.api.gouv.fr** : environ 50 demandes par seconde par adresse IP ; l'autocomplétion attend 300 ms après la frappe, très en dessous.
- **Plan IGN** (tuiles WMTS de la Géoplateforme, `data.geopf.fr`, sans clé) : pas de limite de demandes (CGU de cartes.gouv.fr), Licence Ouverte Etalab (mention de l'IGN sur la carte), seulement les tuiles affichées, jamais de préchargement.
