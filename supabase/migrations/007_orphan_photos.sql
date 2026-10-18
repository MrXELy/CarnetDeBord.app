-- CarnetDeBord.app : ménage des photos de lettres de voiture.
-- Photos « orphelines » : dans le stockage, mais dans aucune LV existante (LV supprimée, fiche abandonnée…).
-- L'appli les liste avec cette fonction puis les efface par l'API de stockage.
-- À coller dans Supabase → SQL Editor, puis « Run ». Peut être relancé sans risque.

-- Photos de l'utilisateur connecté qui ne sont dans aucune LV non supprimée,
-- envoyées depuis plus de « min_age » (jamais une photo qu'on vient de prendre dans une fiche encore ouverte).
create or replace function public.orphan_waybill_photos(min_age interval default interval '24 hours')
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where auth.uid() is not null
    and o.bucket_id = 'waybill-photos'
    and (storage.foldername(o.name))[1] = auth.uid()::text
    and o.created_at < now() - min_age
    and not exists (
      select 1
      from public.waybills w
      where w.user_id = auth.uid()
        and w.deleted_at is null
        and o.name = any (w.photo_paths)
    );
$$;

-- Nombre et poids total des photos de l'utilisateur connecté (affichés dans les Options).
create or replace function public.waybill_photo_stats()
returns table (photos bigint, bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*), coalesce(sum((o.metadata ->> 'size')::bigint), 0)
  from storage.objects o
  where auth.uid() is not null
    and o.bucket_id = 'waybill-photos'
    and (storage.foldername(o.name))[1] = auth.uid()::text;
$$;

revoke all on function public.orphan_waybill_photos(interval) from public, anon;
revoke all on function public.waybill_photo_stats() from public, anon;
grant execute on function public.orphan_waybill_photos(interval) to authenticated;
grant execute on function public.waybill_photo_stats() to authenticated;
