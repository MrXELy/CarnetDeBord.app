# CarnetDeBord.app

Application web pour noter et suivre mes trajets de chauffeur routier (France et Europe) : étapes de la journée, lettres de voiture, carburant, cartes et statistiques. Pensée pour le téléphone, consultable sur PC.

👉 **https://mrxely.github.io/CarnetDeBord.app/**

<p align="center">
  <img src="docs/screenshots/semaine.png" width="260" alt="Vue de la semaine">
  <img src="docs/screenshots/stats-semaine.png" width="260" alt="Statistiques de la semaine">
  <img src="docs/screenshots/carte-semaine.png" width="260" alt="Carte de la semaine">
</p>

> Les captures utilisent des données inventées (villes publiques, « Client A », fausses plaques).

## Fonctionnalités

### La semaine

- **Vue par semaine** : les jours séparés, le plus récent en premier, avec une frise verticale et un point de couleur par type d'étape. La semaine commence le dimanche à 22h.
- En haut : **km de la semaine**, amplitude totale, nombre d'étapes et nombre de lettres de voiture encore dans le camion.
- **Glisser du doigt** pour changer de semaine, ou toucher le titre pour **choisir une semaine** dans la liste (groupée par mois) ou aller à une date.

### Les étapes

<p align="center">
  <img src="docs/screenshots/etape-carburant.png" width="260" alt="Saisie d'un plein de carburant">
  <img src="docs/screenshots/semaines.png" width="260" alt="Choisir une semaine">
</p>

- **Bouton « + »** : début de journée, chargement, livraison, carburant ou fin de journée.
- **Immatriculations** du tracteur et de la remorque reprises de la saisie précédente ; le **début de journée** reprend le lieu et le km de la fin de journée précédente.
- **Lieu** par GPS ou par recherche avec suggestions (département et pays ajoutés automatiquement). Mode Europe dans les Options.
- **Kilométrage en photo** : une photo de l'écran du chrono (ou du compteur) remplit le km. Alerte si le km est plus petit que le dernier relevé ou s'il y a plus de 2000 km d'écart.
- **Carburant** : station (Doumen, AS24, DKV), litres de gasoil et d'AdBlue, et interrupteur **« Plein complet »** (allumé d'office chez Doumen, éteint pour les compléments AS24 et DKV).

### Les lettres de voiture (LV)

<p align="center">
  <img src="docs/screenshots/lettres-de-voiture.png" width="260" alt="Page des lettres de voiture">
</p>

- **Plusieurs LV par chargement** ; un nouveau chargement reçoit d'office une LV vide, à compléter plus tard.
- À la livraison, on coche les LV **« dans le camion »** qui sont livrées.
- **Photo de la LV et lecture automatique** : l'appli lit le numéro, l'expéditeur, le destinataire, la marchandise et le poids (Claude Haiku, avec un bouton « Relire en mode fiable »). Les champs remplis par la lecture sont marqués « LU ».
- **Page LV** avec filtres (à compléter, dans le camion, toutes) et recherche. Modifier la ville ou la date de chargement depuis une LV modifie l'étape correspondante.

### La consommation de gasoil

- Calculée **d'un plein complet au suivant**, tracteur par tracteur : tous les litres mis entre deux pleins complets, compléments compris, divisés par les km parcourus. Les compléments de 200 à 300 L ne faussent donc rien.
- Une **semaine sans plein a quand même consommé** : chaque km prend la consommation de l'intervalle entre pleins qui le contient, ou la consommation habituelle (moyenne des 4 derniers pleins) s'il n'y a pas encore eu de plein complet après.
- Affichée sur la carte de chaque plein complet (« 30,1 L/100 km depuis le plein du 5 oct. ») et dans les Options.

### Les cartes

- **Carte de la semaine** : les étapes reliées jour par jour, une couleur par jour, avec les km de chaque journée. Itinéraires routiers calculés une seule fois puis enregistrés, ou lignes droites.
- **Carte du mois** : toutes les semaines du mois, une couleur par semaine.
- Export de la carte en image.

### Les statistiques

<p align="center">
  <img src="docs/screenshots/stats-gasoil.png" width="260" alt="Statistiques du gasoil et du temps de travail">
  <img src="docs/screenshots/stats-clients.png" width="260" alt="Clients et départements">
  <img src="docs/screenshots/stats-calendrier.png" width="260" alt="Calendrier du mois et records">
</p>

- Par **jour, semaine, mois ou année**, avec les flèches ou en glissant du doigt. Toucher le titre pour aller directement à une date.
- **Km de la période** comparés à la période d'avant (au même moment si la période est en cours).
- **Tuiles** : heures, moyenne par jour, chargements, livraisons, gasoil consommé et acheté, consommation en L/100 km.
- **Barres des km** par jour, semaine ou mois, avec la part à vide en gris : toucher une barre ouvre la période.
- **Km à vide** : de la dernière livraison au chargement suivant (retour à la maison compris). Part des km, comparaison avec la période d'avant, nombre de trajets à vide, le plus long, détail par tracteur. Calculé tracteur par tracteur : changer de tracteur ne fausse jamais le chiffre.
- **Gasoil** : courbe des derniers pleins complets, répartition par station, AdBlue.
- **Temps de travail** : début et fin moyens, amplitude, repos le plus court (un repère, le chrono fait foi).
- **Clients et lieux** : chargeurs et destinataires les plus fréquents (un nom qui contient un autre client, comme « Usine (Client A) », est compté avec lui), départements des chargements et livraisons, tonnage.
- **Calendrier du mois** en couleurs, **records** (plus grosse journée, plus grosse semaine, plus longue amplitude) et km par tracteur.
- **Vue Jour** : les étapes de la journée dans l'ordre et le repos qui l'a précédée.

### Et aussi

<p align="center">
  <img src="docs/screenshots/options.png" width="260" alt="Options">
</p>

- **Fonctionne sans réseau** : les saisies restent dans le téléphone et partent dès que le réseau revient.
- **Synchronisé** entre téléphone et PC grâce à Supabase.
- **Exports CSV** (étapes et lettres de voiture), à ouvrir avec Excel ou LibreOffice.
- **Compteur des lectures automatiques** du mois dans les Options (limites : 2 par photo, 30 par jour, 300 par mois).
- **Installable** sur l'écran d'accueil du téléphone, comme une vraie appli.

## Technique

React 19, Vite, TypeScript, PWA. Données dans [Supabase](https://supabase.com) (tables protégées par utilisateur, stockage privé des photos, fonction Edge `read-waybill` qui lit les LV et le km avec Claude). Lieux via [Photon](https://photon.komoot.io) (OpenStreetMap) et [geo.api.gouv.fr](https://geo.api.gouv.fr), itinéraires via [OSRM](https://project-osrm.org). Mise en ligne automatique sur GitHub Pages à chaque envoi sur `main`.

## Mise en place (une seule fois)

1. Créer un projet gratuit sur [supabase.com](https://supabase.com).
2. Dans **SQL Editor**, coller et lancer (**Run**) dans l'ordre : [supabase/schema.sql](supabase/schema.sql), puis les fichiers de [supabase/migrations/](supabase/migrations/) (`002` à `005`).
3. Copier l'URL du projet (bouton **Connect**) et la clé **publishable** (**Settings → API Keys**) dans [src/config.ts](src/config.ts).
4. Dans **Authentication → Sign In / Providers → Email**, désactiver **Confirm email** (et les inscriptions une fois son compte créé).
5. Pour la lecture automatique : ajouter le secret `ANTHROPIC_API_KEY` dans **Edge Functions → Secrets**, puis déployer la fonction :
   `npx supabase functions deploy read-waybill --project-ref <projet> --use-api`.
6. Sur GitHub, dans **Settings → Pages**, choisir **Source : GitHub Actions**.

## Installer sur le téléphone

Ouvrir l'adresse de l'appli, puis :
- **Android (Chrome)** : menu ⋮ → *Ajouter à l'écran d'accueil*.
- **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.

## Développement

```sh
npm install         # installer les dépendances
npx vite --host     # lancer l'appli en local (accessible depuis le téléphone sur le même Wi-Fi)
npm test            # lancer les tests
npm run build       # vérifier TypeScript et compiler la version de production
```

## Mode démo (tests en local)

Pour tester avec un historique réaliste sans toucher aux vraies données :

1. Convertir une sauvegarde de l'ancien projet : `node scripts/import-legacy.mjs <truck-manager-backup.json>`. Le résultat va dans `data/demo-events.json`, dossier jamais publié.
2. Lancer l'appli et ouvrir `http://localhost:5173/CarnetDeBord.app/?demo`. Ajouter `?demo=reset` pour recharger les données d'origine.

En mode démo, tout reste dans le navigateur : rien n'est envoyé à Supabase. Ce mode n'existe pas dans la version en ligne.
