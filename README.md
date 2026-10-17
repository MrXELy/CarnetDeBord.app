# CarnetDeBord.app

Application web pour noter et suivre mes trajets de chauffeur routier (France et Europe), pensée pour le téléphone et consultable sur PC.

👉 **https://mrxely.github.io/CarnetDeBord.app/**

## Fonctionnalités

- **Vue par semaine** : les jours bien séparés, le plus récent en premier, avec les km parcourus et l'amplitude de chaque journée.
- **Bouton « + »** pour ajouter une étape : début de journée, chargement, livraison, carburant ou fin de journée.
  - Immatriculations tracteur et remorque reprises automatiquement de la saisie précédente.
  - Lieu trouvé par GPS ou saisi avec suggestions ; département (France) et pays ajoutés automatiquement.
  - Date et heure actuelles par défaut, modifiables.
  - Chargement / livraison : client et n° de lettre de voiture.
  - Carburant : station (Doumen, AS24, DKV), litres de gasoil et d'AdBlue.
- **Fonctionne sans réseau** : les saisies sont gardées dans le téléphone et envoyées dès que le réseau revient.
- **Synchronisé** entre téléphone et PC grâce à Supabase.
- **Installable** sur l'écran d'accueil du téléphone, comme une vraie appli.

## Technique

React + Vite + TypeScript, données dans [Supabase](https://supabase.com), lieux via [Photon](https://photon.komoot.io) (OpenStreetMap) et [geo.api.gouv.fr](https://geo.api.gouv.fr). Mise en ligne automatique sur GitHub Pages à chaque envoi sur `main`.

## Mise en place (une seule fois)

1. Créer un projet gratuit sur [supabase.com](https://supabase.com).
2. Dans **SQL Editor**, coller le contenu de [supabase/schema.sql](supabase/schema.sql) et cliquer sur **Run**, puis faire de même avec [supabase/migrations/002_waybills.sql](supabase/migrations/002_waybills.sql) (lettres de voiture).
3. Copier l'URL du projet (bouton **Connect**) et la clé **publishable** (**Settings → API Keys**) dans [src/config.ts](src/config.ts).
4. Dans **Authentication → Sign In / Providers → Email**, désactiver **Confirm email**.
5. Sur GitHub, dans **Settings → Pages**, choisir **Source : GitHub Actions**.

## Installer sur le téléphone

Ouvrir l'adresse de l'appli, puis :
- **Android (Chrome)** : menu ⋮ → *Ajouter à l'écran d'accueil*.
- **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.

## Développement

```sh
npm install     # installer les dépendances
npm run dev     # lancer l'appli en local
npm test        # lancer les tests
npm run build   # compiler la version de production
```

## À venir

- Gestion des numéros de lettre de voiture
- Export des données

## Mode démo (tests en local)

Pour tester avec un historique réaliste sans toucher aux vraies données :

1. Convertir une sauvegarde de l'ancien projet : `node scripts/import-legacy.mjs <truck-manager-backup.json>`. Le résultat va dans `data/demo-events.json`, dossier jamais publié.
2. Lancer `npm run dev` et ouvrir `http://localhost:5173/CarnetDeBord.app/?demo`. Ajouter `?demo=reset` pour recharger les données d'origine.

En mode démo, tout reste dans le navigateur : rien n'est envoyé à Supabase. Ce mode n'existe pas dans la version en ligne.
