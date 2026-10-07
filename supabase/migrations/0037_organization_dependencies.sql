-- PLUKA V1 — Ce qui empêche de supprimer une organisation, dit avant le clic
-- File target: supabase/migrations/0037_organization_dependencies.sql
-- Référence : migration 0032 · retour d'usage du 2026-10-07
--
-- POURQUOI
--
-- 0032 refuse de supprimer une organisation qui porte encore des données, et
-- son refus nommait les tables en cause — dans les logs seulement. L'écran
-- disait « porte encore des données » sans dire lesquelles : impossible de
-- savoir quoi faire.
--
-- CE QUE CETTE MIGRATION FAIT
--
-- 1. `private.organization_dependencies` compte, par famille, ce qui retient
--    une organisation. C'est désormais **la seule** définition de « liée » :
-- 2. `admin_delete_organization` (0032) est redéfinie pour s'y appuyer — même
--    garde, même verrou, même audit, même refus `55000` ;
-- 3. `admin_get_organization_dependencies` la rend à la fiche, qui peut dire
--    « 2 événements, 4 informations publiées » avant qu'on clique.
--
-- La lecture est réservée à qui peut supprimer (super-admin, admin) : Support
-- ne voit pas le geste, il n'a pas besoin de ce qui le bloque.

begin;

create or replace function private.organization_dependencies(p_organization_id uuid)
returns table (kind text, total bigint)
language sql stable security definer set search_path = '' as $$
  select kind, total from (
    values
      ('members', (select count(*) from public.organization_members where organization_id = p_organization_id)),
      ('events', (select count(*) from public.events where organization_id = p_organization_id)),
      ('sources', (select count(*) from public.sources where organization_id = p_organization_id)),
      ('published_facts', (select count(*) from public.race_fact_versions where validated_by_organization_id = p_organization_id)),
      ('notices', (select count(*) from public.race_notices where published_by_organization_id = p_organization_id)),
      ('change_events', (select count(*) from public.race_change_events where published_by_organization_id = p_organization_id)),
      ('entitlements', (select count(*) from public.entitlements where organization_id = p_organization_id)),
      ('participant_imports', (select count(*) from public.participant_imports where organization_id = p_organization_id)),
      ('enrichment_imports', (select count(*) from public.enrichment_imports where organization_id = p_organization_id))
  ) as dependency(kind, total)
  where total > 0;
$$;

revoke all on function private.organization_dependencies(uuid) from public, anon, authenticated;

create or replace function public.admin_get_organization_dependencies(p_organization_id uuid)
returns table (kind text, total bigint)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_get_organization_dependencies');

  return query select d.kind, d.total from private.organization_dependencies(p_organization_id) d;
end;
$$;

revoke all on function public.admin_get_organization_dependencies(uuid) from public, anon;
grant execute on function public.admin_get_organization_dependencies(uuid) to authenticated;

create or replace function public.admin_delete_organization(p_organization_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_slug text;
  v_status public.organization_status;
  v_linked text;
begin
  perform private.assert_pluka_admin('admin_delete_organization');

  select o.slug, o.status into v_slug, v_status
  from public.organizations o
  where o.id = p_organization_id
  for update;

  if not found then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;

  select string_agg(d.kind, ', ') into v_linked
  from private.organization_dependencies(p_organization_id) d;

  if v_linked is not null then
    raise exception 'organisation liee a des donnees : %', v_linked using errcode = '55000';
  end if;

  delete from public.organizations where id = p_organization_id;

  perform private.record_audit(
    'organization.delete',
    'organizations',
    p_organization_id,
    jsonb_build_object('slug', v_slug, 'status', v_status)
  );
end;
$$;

commit;
