-- PLUKA V1 — Un super-admin supprime une organisation, quoi qu'elle porte
-- File target: supabase/migrations/0038_organization_tombstone.sql
-- Référence : migrations 0032, 0037 · 03_PRIVACY_RLS §114 · 04_ENTITLEMENTS ·
--             AGENTS §13, §14, §102 · décision produit du 2026-10-07
--
-- LA DÉCISION
--
-- « Un super-admin doit pouvoir supprimer une organisation facilement, sans
-- garde-fou particulier », en *détachant* ce qu'elle porte : ses événements
-- restent et deviennent « Maintenus par PLUKA », les préparations et les
-- droits déjà accordés aux coureurs restent intacts.
--
-- POURQUOI UNE PIERRE TOMBALE
--
-- Effacer la ligne `organizations` est impossible sans casser deux choses que
-- la base protège :
--
-- - un droit « Inclus organisateur » doit nommer l'organisation qui le
--   finance (contrainte de 0001) — l'effacer retirerait l'accès des coureurs ;
-- - une notice officielle doit rester attribuée à une organisation, et la
--   provenance d'une information publiée ne se réécrit pas (§13, §14).
--
-- La suppression d'une organisation qui porte des données garde donc sa ligne
-- comme **pierre tombale** : `deleted_at` posé, statut `archived`, slug
-- libéré, invisible partout. Tout ce qui faisait vivre
-- l'organisation disparaît : membres (accès coupés à la requête suivante,
-- §114), invitations, imports de participants et d'enrichissement. Ses
-- événements sont détachés. Provenance et droits gardent leur référence.
--
-- Une organisation vide est toujours effacée pour de bon, comme en 0032.
--
-- QUI
--
-- Le super-admin seul supprime une organisation qui porte des données. Un
-- admin garde la règle de 0032 : seulement une organisation vide.

begin;

alter table public.organizations
  add column deleted_at timestamptz,
  add column deleted_by_user_id uuid references public.users(id) on delete set null;

comment on column public.organizations.deleted_at is
  'Suppression avec pierre tombale (0038) : la ligne reste pour la provenance et les droits deja accordes, invisible partout.';

-- La garde d'équipe (0035) refuse une organisation supprimée : plus aucune
-- invitation, plus aucun rôle n'y entre.
create or replace function private.can_manage_org_team(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_organization_id and o.deleted_at is null
  ) and (
    private.is_pluka_admin() or exists (
      select 1 from public.organization_members om
      where om.organization_id = p_organization_id
        and om.user_id = (select auth.uid())
        and om.role = 'owner'
    )
  );
$$;

-- Les lectures et l'édition de console ignorent une organisation supprimée.
create or replace function public.admin_list_organizations(p_limit integer DEFAULT 100)
 RETURNS TABLE(organization_id uuid, name text, slug text, status organization_status, contact_email text, events_count bigint, races_count bigint, members_count bigint, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_pluka_admin('admin_list_organizations');

  return query select
    o.id,
    o.name,
    o.slug,
    o.status,
    o.contact_email::text,
    (select count(*) from public.events e where e.organization_id = o.id),
    (select count(*)
       from public.races r
       join public.editions ed on ed.id = r.edition_id
       join public.events e2 on e2.id = ed.event_id
      where e2.organization_id = o.id),
    (select count(*) from public.organization_members m where m.organization_id = o.id),
    o.created_at
  from public.organizations o
  where o.deleted_at is null
  order by o.name
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$function$

;
create or replace function public.admin_get_organization(p_organization_id uuid)
 RETURNS TABLE(organization_id uuid, name text, slug text, status organization_status, contact_email text, website_url text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_pluka_admin('admin_get_organization');

  return query select
    o.id,
    o.name,
    o.slug,
    o.status,
    o.contact_email::text,
    o.website_url,
    o.created_at,
    o.updated_at
  from public.organizations o
  where o.id = p_organization_id and o.deleted_at is null;
end;
$function$

;
create or replace function public.admin_platform_counters()
 RETURNS TABLE(events_total bigint, events_published bigint, editions_total bigint, races_total bigint, races_published bigint, organizations_total bigint, organizations_active bigint, participations_active bigint, candidates_pending bigint, jobs_failed bigint, reports_open bigint, products_draft bigint, sources_failed bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_pluka_admin('admin_platform_counters');

  return query select
    (select count(*) from public.events),
    (select count(*) from public.events where status = 'published'),
    (select count(*) from public.editions),
    (select count(*) from public.races),
    (select count(*) from public.races where status = 'published'),
    (select count(*) from public.organizations where deleted_at is null),
    (select count(*) from public.organizations where status = 'active' and deleted_at is null),
    (select count(*) from public.participant_races where status = 'active'),
    (select count(*) from private.fact_candidates
      where status in ('detected', 'needs_review', 'conflict')),
    (select count(*) from private.ingestion_jobs where status = 'failed'),
    (select count(*) from public.community_reports where status = 'open'),
    (select count(*) from public.nutrition_products where status = 'draft'),
    (select count(*) from public.sources where status = 'failed');
end;
$function$

;
create or replace function public.admin_update_organization(p_organization_id uuid, p_name text, p_contact_email text, p_website_url text, p_status organization_status)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_current public.organizations%rowtype;
  v_changed text[] := array[]::text[];
  v_after jsonb;
begin
  perform private.assert_pluka_admin('admin_update_organization');

  select * into v_current
  from public.organizations o
  where o.id = p_organization_id and o.deleted_at is null
  for update;

  if not found then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;

  if v_current.name is distinct from p_name then
    v_changed := array_append(v_changed, 'name');
  end if;
  if v_current.contact_email::text is distinct from p_contact_email then
    v_changed := array_append(v_changed, 'contactEmail');
  end if;
  if v_current.website_url is distinct from p_website_url then
    v_changed := array_append(v_changed, 'websiteUrl');
  end if;
  if v_current.status is distinct from p_status then
    v_changed := array_append(v_changed, 'status');
  end if;

  if cardinality(v_changed) = 0 then
    return 0;
  end if;

  update public.organizations
  set name = p_name,
      contact_email = p_contact_email,
      website_url = p_website_url,
      status = p_status
  where id = p_organization_id;

  v_after := jsonb_build_object('changed', to_jsonb(v_changed));
  if 'status' = any (v_changed) then
    v_after := v_after || jsonb_build_object('statusFrom', v_current.status, 'statusTo', p_status);
  end if;

  perform private.record_audit('organization.update', 'organizations', p_organization_id, v_after);

  return cardinality(v_changed);
end;
$function$

;

create or replace function public.admin_delete_organization(p_organization_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_slug text;
  v_status public.organization_status;
  v_dependencies jsonb;
begin
  perform private.assert_pluka_admin('admin_delete_organization');

  select o.slug, o.status into v_slug, v_status
  from public.organizations o
  where o.id = p_organization_id and o.deleted_at is null
  for update;

  if not found then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_object_agg(d.kind, d.total), '{}'::jsonb) into v_dependencies
  from private.organization_dependencies(p_organization_id) d;

  -- Vide : effacée pour de bon, par tout membre de l'administration qui écrit.
  if v_dependencies = '{}'::jsonb then
    delete from public.organizations where id = p_organization_id;

    perform private.record_audit(
      'organization.delete', 'organizations', p_organization_id,
      jsonb_build_object('slug', v_slug, 'status', v_status, 'mode', 'erased')
    );
    return;
  end if;

  -- Elle porte des données : seul le super-admin la supprime.
  if not private.is_pluka_super_admin() then
    raise exception 'organisation liee a des donnees : %',
      (select string_agg(key, ', ' order by key) from jsonb_object_keys(v_dependencies) as key)
      using errcode = '55000';
  end if;

  -- Ses événements sont détachés : ils deviennent « Maintenus par PLUKA ».
  update public.events
  set organization_id = null, management_status = 'pluka_managed'
  where organization_id = p_organization_id;

  -- Ce qui la faisait vivre disparaît. Les lignes d'import suivent en cascade.
  delete from public.organization_members where organization_id = p_organization_id;
  delete from public.organization_invitations where organization_id = p_organization_id;
  delete from public.participant_imports where organization_id = p_organization_id;
  delete from public.enrichment_imports where organization_id = p_organization_id;

  -- La ligne reste, invisible : provenance et droits gardent leur référence.
  -- Le slug est libéré pour qu'une nouvelle organisation puisse le reprendre.
  update public.organizations
  set deleted_at = now(),
      deleted_by_user_id = (select auth.uid()),
      status = 'archived',
      slug = v_slug || '-supprimee-' || left(replace(p_organization_id::text, '-', ''), 8)
  where id = p_organization_id;

  perform private.record_audit(
    'organization.delete', 'organizations', p_organization_id,
    jsonb_build_object('slug', v_slug, 'status', v_status, 'mode', 'tombstone', 'detached', v_dependencies)
  );
end;
$$;

comment on function public.admin_delete_organization(uuid) is
  'Supprime une organisation. Vide : effacee (admin ou super-admin). Avec donnees : pierre tombale, evenements detaches, membres/invitations/imports supprimes (super-admin seul). Audite.';

commit;
