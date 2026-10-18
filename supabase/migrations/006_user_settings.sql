-- CarnetDeBord.app : réglages de l'utilisateur partagés entre ses appareils
-- (bases et tarifs des frais de déplacement). Une seule ligne par utilisateur, id = son identifiant.
-- À coller dans Supabase → SQL Editor, puis « Run ». Peut être relancé sans risque.

create table if not exists public.user_settings (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  allowances  jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists user_settings_user_updated_idx on public.user_settings (user_id, updated_at);

alter table public.user_settings enable row level security;

drop policy if exists "Chaque utilisateur gère ses réglages" on public.user_settings;
create policy "Chaque utilisateur gère ses réglages" on public.user_settings
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and id = auth.uid());

-- Même déclencheur que pour les étapes : date de modification fixée par le serveur.
drop trigger if exists user_settings_touch_updated_at on public.user_settings;
create trigger user_settings_touch_updated_at
  before insert or update on public.user_settings
  for each row execute function public.events_touch_updated_at();
