-- CarnetDeBord.app : réglages de la feuille de semaine en PDF (nom du conducteur, agence, colonnes des dépôts),
-- dans la même ligne que les réglages des frais.
-- À coller dans Supabase → SQL Editor, puis « Run ». Peut être relancé sans risque.

alter table public.user_settings add column if not exists week_sheet jsonb;
