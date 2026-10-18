-- CarnetDeBord.app : à coller dans Supabase → SQL Editor, puis « Run ».

create table if not exists public.events (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type          text not null check (type in ('debut_journee', 'chargement', 'livraison', 'carburant', 'fin_journee')),
  occurred_at   timestamptz not null,
  tractor_plate text not null default '',
  trailer_plate text not null default '',
  odometer_km   integer,
  city          text not null default '',
  postcode      text,
  department    text,
  country_code  text,
  lat           double precision,
  lon           double precision,
  notes         text,
  client        text,
  cmr_number    text,
  station       text check (station in ('Doumen', 'AS24', 'DKV')),
  diesel_l      numeric(7, 2),
  adblue_l      numeric(7, 2),
  full_tank     boolean,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists events_user_occurred_idx on public.events (user_id, occurred_at desc);
create index if not exists events_user_updated_idx on public.events (user_id, updated_at);

alter table public.events enable row level security;

drop policy if exists "Chaque utilisateur gère ses événements" on public.events;
create policy "Chaque utilisateur gère ses événements" on public.events
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- La date de modification est toujours fixée par le serveur : la synchro
-- s'appuie dessus pour ne récupérer que ce qui a changé.
create or replace function public.events_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before insert or update on public.events
  for each row execute function public.events_touch_updated_at();
