-- CarnetDeBord.app : photos des lettres de voiture et suivi des lectures automatiques.
-- À coller dans Supabase → SQL Editor, puis « Run ». Peut être relancé sans risque.

-- 1. Photos rattachées à chaque LV (chemins dans le stockage).
alter table public.waybills add column if not exists photo_paths text[] not null default '{}';

-- 2. Espace de stockage privé : chaque utilisateur n'accède qu'à son dossier « <son id>/… ».
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('waybill-photos', 'waybill-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

drop policy if exists "Photos LV : lecture" on storage.objects;
create policy "Photos LV : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'waybill-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Photos LV : ajout" on storage.objects;
create policy "Photos LV : ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'waybill-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Photos LV : remplacement" on storage.objects;
create policy "Photos LV : remplacement" on storage.objects for update to authenticated
  using (bucket_id = 'waybill-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Photos LV : suppression" on storage.objects;
create policy "Photos LV : suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'waybill-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3. Journal des lectures automatiques : sert aux limites (par photo, par jour, par mois)
--    et à afficher le coût réel. Écrit uniquement par la fonction « read-waybill ».
create table if not exists public.ocr_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  photo_path    text not null,
  created_at    timestamptz not null default now(),
  status        text not null default 'en_cours', -- en_cours / ok / erreur
  model         text,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(10, 5)
);

create index if not exists ocr_usage_user_created_idx on public.ocr_usage (user_id, created_at);
create index if not exists ocr_usage_photo_idx on public.ocr_usage (photo_path);

alter table public.ocr_usage enable row level security;

-- Lecture seule pour l'utilisateur (aucune politique d'écriture : seule la fonction, avec la clé serveur, écrit).
drop policy if exists "Chaque utilisateur voit ses lectures" on public.ocr_usage;
create policy "Chaque utilisateur voit ses lectures" on public.ocr_usage
  for select using (user_id = auth.uid());
