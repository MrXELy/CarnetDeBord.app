-- CarnetDeBord.app : cartes des semaines (itinéraires calculés une fois puis enregistrés).
-- À coller dans Supabase → SQL Editor, puis « Run ». Peut être relancé sans risque.

create table if not exists public.week_maps (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week_start   timestamptz not null,
  stops_hash   text not null,
  legs         jsonb not null default '[]',
  generated_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- Une seule carte par semaine et par utilisateur.
create unique index if not exists week_maps_user_week_idx on public.week_maps (user_id, week_start);
create index if not exists week_maps_user_updated_idx on public.week_maps (user_id, updated_at);

alter table public.week_maps enable row level security;

drop policy if exists "Chaque utilisateur gère ses cartes" on public.week_maps;
create policy "Chaque utilisateur gère ses cartes" on public.week_maps
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Même déclencheur que pour les étapes : date de modification fixée par le serveur.
drop trigger if exists week_maps_touch_updated_at on public.week_maps;
create trigger week_maps_touch_updated_at
  before insert or update on public.week_maps
  for each row execute function public.events_touch_updated_at();
