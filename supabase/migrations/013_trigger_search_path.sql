-- CarnetDeBord.app : fixe le search_path de la fonction qui met à jour updated_at
-- (alerte « Function Search Path Mutable » du Security Advisor de Supabase).
-- À coller dans Supabase → SQL Editor, puis « Run ». Peut être relancé sans risque.

alter function public.events_touch_updated_at() set search_path = '';
