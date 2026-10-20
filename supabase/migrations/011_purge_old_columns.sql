-- CarnetDeBord.app : ménage de la base.
-- 1. Anciennes colonnes « client » et « cmr_number » des étapes, remplacées par les lettres de voiture :
--    ce qui y est encore noté devient une LV, puis les deux colonnes sont retirées.
-- 2. Lignes supprimées (« deleted_at » rempli) : vraiment effacées. Ensuite, l'appli efface elle-même,
--    une fois par jour, celles supprimées depuis plus de 30 jours.
-- À coller dans Supabase → SQL Editor, puis « Run », APRÈS la mise en ligne de la nouvelle version de l'appli
-- (l'ancienne envoie encore ces colonnes). Peut être relancé sans risque.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'client'
  ) then
    -- Étape avec un client ou un n° de LV, mais sans LV : une LV pour elle
    -- (chargement : le client devient le chargeur ; livraison : le destinataire).
    insert into public.waybills (id, user_id, loading_event_id, delivery_event_id, number, shipper, consignee)
    select
      gen_random_uuid(),
      e.user_id,
      case when e.type = 'chargement' then e.id end,
      case when e.type = 'livraison' then e.id end,
      nullif(trim(e.cmr_number), ''),
      case when e.type = 'chargement' then nullif(trim(e.client), '') end,
      case when e.type = 'livraison' then nullif(trim(e.client), '') end
    from public.events e
    where e.type in ('chargement', 'livraison')
      and e.deleted_at is null
      and (nullif(trim(e.client), '') is not null or nullif(trim(e.cmr_number), '') is not null)
      and not exists (
        select 1 from public.waybills w
        where w.deleted_at is null and (w.loading_event_id = e.id or w.delivery_event_id = e.id)
      );

    alter table public.events drop column client;
    alter table public.events drop column if exists cmr_number;
  end if;
end;
$$;

-- Lignes supprimées : les LV d'abord (elles font référence aux étapes).
delete from public.waybills where deleted_at is not null;
delete from public.week_maps where deleted_at is not null;
delete from public.events where deleted_at is not null;
