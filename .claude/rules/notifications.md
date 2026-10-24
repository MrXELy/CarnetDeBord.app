---
paths: ["src/sw.ts", "src/lib/notifiedFinishes.ts", "src/lib/stepNotification.ts", "src/components/StepNotificationSetting.tsx", "src/components/FinishStepButton.tsx", "vite.config.ts"]
---

# Notifications

Plan validé avec l'utilisateur (octobre 2026) : **A** bouton de fin d'étape dans une notification (fait, sans serveur) ; **B** alertes 1 h avant 13 h et 15 h d'amplitude, envoyées par Supabase (Web Push, à faire). Choix B : plus aucun repos réduit possible → une seule alerte (12 h après le début), pas celle de 14 h.

## Service worker (`src/sw.ts`)

- vite-plugin-pwa en `injectManifest` (service worker écrit à la main) : précache des fichiers listés à la construction, `index.html` pour toute adresse (en ligne seulement), mise à jour automatique (`skipWaiting`, `clientsClaim`).
- Aussi actif sur le serveur de test (`devOptions`), sans rien garder hors ligne. Chrome le refuse avec le certificat fait maison : pour tester les notifications, `HTTP=1 npx vite` puis http://localhost:5173/CarnetDeBord.app/ (PC), ou le téléphone relié en USB avec la redirection de port de `chrome://inspect` (localhost:5173).

## A. Fin d'étape depuis la notification

- Réglage **par appareil** dans les Options (`stepNotifications` de `cdb.settings`, `StepNotificationSetting.tsx`) : la permission de Chrome est demandée en l'activant ; bloquée → interrupteur grisé et explication.
- Tant qu'un chargement ou une livraison n'a pas de fin (`unfinishedStep`, mêmes règles que le bouton de l'appli), notification « Livraison en cours », « Narbonne (11) · Arrivée à 14:35 », bouton « Fin de la livraison » (`stepNotice`). Sans son, gardée affichée (tag `step`, une seule). Retirée quand la fin est validée dans l'appli, quand une autre étape est notée, ou si le réglage est coupé. Balayée par l'utilisateur : revient à la prochaine ouverture de l'appli.
- Bouton touché : le service worker garde l'heure du toucher dans IndexedDB (base `carnetdebord-notifications`, `notifiedFinishes.ts`), prévient l'appli si elle est ouverte, puis affiche 4 s « Fin de la livraison notée à 15:20 ». L'appli applique les fins en attente à l'ouverture, au retour au premier plan et sur message du service worker (`applyFinishes`) : ignorées si l'étape est supprimée, inconnue ou déjà finie.
- Limite acceptée : tant que l'appli n'est pas rouverte sur le téléphone, la fin n'est pas envoyée à Supabase (le PC ne la voit pas encore) ; l'heure enregistrée reste celle du toucher.
- Toucher le texte de la notification ouvre l'appli.
