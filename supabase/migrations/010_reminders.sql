-- CarnetDeBord.app : échéances (carte conducteur, FCO, visite médicale, contrôles techniques, chronotachygraphe)
-- et ensemble routier principal, dans la même ligne que les autres réglages.
-- À coller dans Supabase → SQL Editor, puis « Run ». Peut être relancé sans risque.

alter table public.user_settings add column if not exists reminders jsonb;
