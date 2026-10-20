-- CarnetDeBord.app : lettres de voiture (LV).
-- À coller dans Supabase → SQL Editor, puis « Run ». Peut être relancé sans risque.

create table if not exists public.waybills (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  loading_event_id  uuid references public.events (id) on delete set null,
  delivery_event_id uuid references public.events (id) on delete set null,
  number            text,
  shipper           text,
  consignee         text,
  planned_city      text,
  goods             text,
  weight_kg         numeric(9, 1),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists waybills_user_updated_idx on public.waybills (user_id, updated_at);

alter table public.waybills enable row level security;

drop policy if exists "Chaque utilisateur gère ses lettres de voiture" on public.waybills;
create policy "Chaque utilisateur gère ses lettres de voiture" on public.waybills
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Même déclencheur que pour les étapes : date de modification fixée par le serveur.
drop trigger if exists waybills_touch_updated_at on public.waybills;
create trigger waybills_touch_updated_at
  before insert or update on public.waybills
  for each row execute function public.events_touch_updated_at();

-- Reprise de l'existant (client et n° de LV notés sur les anciennes étapes) : faite par la migration 011,
-- qui retire ensuite ces deux colonnes.
