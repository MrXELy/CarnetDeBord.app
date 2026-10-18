-- CarnetDeBord.app : plein complet ou simple complément, pour calculer la consommation.
-- À coller dans Supabase → SQL Editor, puis « Run ». Peut être relancé sans risque.
-- Vide sur les anciennes étapes : l'appli considère alors Doumen = plein, AS24 et DKV = complément.

alter table public.events add column if not exists full_tank boolean;
