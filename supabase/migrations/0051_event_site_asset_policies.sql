-- PLUKA V1 — Le site de l'événement : qui dépose les images
-- File target: supabase/migrations/0051_event_site_asset_policies.sql
-- Référence : docs/features/EVENT_SITE.md §4 · migration 0049 · 03_PRIVACY_RLS §8, §83
--
-- 0049 laissait le bucket `event-site-assets` sans policy, « seul le serveur
-- dépose, sous clé de service ». Mais `apps/app` n'emploie aucune clé de
-- service, et un test le garde. Les images se déposent donc sous la session
-- de l'éditeur, et la base dit où :
--
--   - dans le dossier de l'événement, premier segment du chemin (son UUID) ;
--   - par owner, admin ou editor de son organisation, ou l'admin PLUKA.
--
-- L'app réencode l'image avant de la déposer (métadonnées retirées, taille
-- bornée). Le bucket n'accepte de toute façon que PNG, JPEG et WebP, et il
-- est servi depuis le domaine du stockage, pas depuis celui des sites.
--
-- La lecture reste publique par l'adresse publique du bucket ; la policy de
-- lecture ne sert qu'au retrait, que le stockage fait précéder d'une lecture.

begin;

create or replace function private.can_edit_event_site_asset(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_folder text := split_part(p_name, '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  return private.user_can_manage_event(v_folder::uuid, 'editor') or private.is_pluka_admin();
end;
$$;

comment on function private.can_edit_event_site_asset(text) is
  'Un chemin de `event-site-assets` appartient à l''événement de son premier segment ; seuls ses éditeurs y écrivent.';

revoke all on function private.can_edit_event_site_asset(text) from public, anon;
grant execute on function private.can_edit_event_site_asset(text) to authenticated;

create policy event_site_assets__insert__site_editor on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-site-assets' and private.can_edit_event_site_asset(name));

create policy event_site_assets__select__site_editor on storage.objects
  for select to authenticated
  using (bucket_id = 'event-site-assets' and private.can_edit_event_site_asset(name));

create policy event_site_assets__delete__site_editor on storage.objects
  for delete to authenticated
  using (bucket_id = 'event-site-assets' and private.can_edit_event_site_asset(name));

commit;
