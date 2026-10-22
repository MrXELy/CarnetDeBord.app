---
paths: ["supabase/**", "src/lib/supabase.ts"]
---

# Supabase : schéma et migrations

- Les migrations SQL (`supabase/migrations/`) sont lancées à la main par l'utilisateur dans l'éditeur SQL de Supabase.
- Pas de migration 001 : `supabase/schema.sql` en tient lieu (installation neuve, il reprend aussi l'index de la 008) ; les migrations vont de 002 à 012.
- 005 : colonne `full_tank` (plein complet). 006 : table `user_settings` (une ligne par utilisateur, id = son identifiant). 007 : fonction SQL `orphan_waybill_photos` (photos orphelines). 008 : index `events (user_id, updated_at)` pour la synchro. 009 : colonne `week_sheet` de `user_settings`. 010 : colonne `reminders` (échéances). 011 : change en LV ce qui reste dans les anciennes colonnes `client` et `cmr_number` des étapes, retire ces colonnes et efface les lignes supprimées (à lancer après la mise en ligne de l'appli). 012 : colonne `finished_at` des étapes (fin d'un chargement ou d'une livraison), **à lancer avant la mise en ligne** (sinon les envois d'étapes sont refusés).
- Fonction Edge `read-waybill` : lecture des LV et du kilométrage (voir `lv.md`). Déploiement : `npx --yes supabase@2.121.0 functions deploy read-waybill --project-ref bjtqghlacclhbjjyarxj --use-api`.
