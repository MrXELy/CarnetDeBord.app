-- CarnetDeBord.app : index pour la synchro des étapes.
-- L'appli demande « les étapes modifiées depuis la dernière synchro, classées par date de modification » :
-- cet index évite de parcourir toutes les étapes de l'utilisateur à chaque fois.
-- À coller dans Supabase → SQL Editor, puis « Run ». Peut être relancé sans risque.

create index if not exists events_user_updated_idx on public.events (user_id, updated_at);
