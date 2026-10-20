---
paths: ["src/lib/sync.ts", "src/lib/syncRun.test.ts", "src/lib/sync.test.ts", "src/lib/useEvents.ts", "src/lib/signOut.ts", "src/lib/photos.ts", "src/types.ts"]
---

# Synchro et déconnexion

## `src/lib/sync.ts` : synchro hors ligne d'abord (cache localStorage, file d'envoi), `EventStore`

- Chaque `Collection` a un compteur `version` ; les listes `events` et `waybills` gardent le même tableau tant que rien ne change (les caches et les `useMemo` s'appuient dessus). **Tout code qui modifie `items` doit augmenter `version`.** `loadedAt` et `deliveredAt` utilisent un index mémorisé.
- Une synchro demandée pendant une synchro en cours est relancée une seule fois à sa fin.
- Si le lot d'envoi est refusé, les lignes repartent une par une (`isRowRefusal`) : la ligne refusée reste dans la file, l'erreur la nomme (`RowRefusedError`) et la synchro continue (réception, LV, photos, cartes, réglages) ; une LV qui pointe vers une étape refusée est refusée seule. Panne réseau, session expirée, colonne ou table absente : pas de renvoi ligne par ligne.
- Le curseur de réception est `date|id` (un ancien curseur, la date seule, est encore lu).
- Suppression : la ligne garde `deleted_at` le temps que les autres appareils l'apprennent, puis l'appli l'efface vraiment du serveur (une fois par jour, celles supprimées depuis plus de 30 jours : `purge`, LV avant les étapes). Chaque appareil relit tout une fois par semaine (`pull(true)`, clé `full_synced`) et oublie ce que le serveur n'a plus, sauf ce qui attend d'être envoyé.
- Les anciennes colonnes `client` et `cmr_number` des étapes (d'avant les LV) n'existent plus : `normalizeEvent` les retire du cache.

## Déconnexion (`src/lib/signOut.ts`, bouton en bas des Options)

Envoie d'abord ce qui attend, avertit s'il reste des envois ou des photos non envoyés (perte à confirmer), puis efface les clés `cdb.<id>.*` et les photos de l'utilisateur, seulement si la session est vraiment fermée (sinon message et rechargement). Bouton occupé (« Envoi en cours… », « Déconnexion… »), une seule déconnexion à la fois, envoi limité à 20 s (`SEND_TIMEOUT_MS`) : au-delà, même avertissement de perte que pour un échec. Les réglages de l'appareil (`cdb.settings`) sont gardés.
