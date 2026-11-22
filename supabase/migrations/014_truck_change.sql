-- CarnetDeBord.app : étape « Changement de camion » (au dépôt : on rend un camion, on en prend un autre).
-- L'étape porte le camion pris (plaques et compteur habituels) et le camion rendu (colonnes prev_*).
-- À coller dans Supabase → SQL Editor, puis « Run ». Peut être relancé sans risque.
-- À lancer AVANT de mettre l'appli en ligne : sinon le serveur refuse les changements de camion envoyés.

alter table public.events drop constraint if exists events_type_check;
alter table public.events add constraint events_type_check
  check (type in ('debut_journee', 'chargement', 'livraison', 'carburant', 'changement_camion', 'fin_journee'));

alter table public.events add column if not exists prev_tractor_plate text;
alter table public.events add column if not exists prev_trailer_plate text;
alter table public.events add column if not exists prev_odometer_km integer;
