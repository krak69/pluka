-- PLUKA V1 — Changer l'organisation qui gère un événement
-- File target: supabase/migrations/0044_event_organization_change.sql
-- Référence : docs/02_DATA_MODEL.md §3.1 · 00_PRODUCT_SPEC §4.1 · migrations 0035, 0038, 0041
--
-- Décision produit du 2026-10-08 : l'organisation qui gère un événement se
-- change depuis la fiche événement, et **seul un super-admin PLUKA** peut le
-- faire. Rattacher, changer ou détacher.
--
-- Pourquoi super-admin : `events.organization_id` décide qui, côté
-- organisateur, lit l'événement, ses épreuves et la liste opérationnelle de
-- leurs inscrits (`participant_races__select__org_member`, 0005), et qui peut
-- publier une information « Officielle » (§32). Changer d'organisation
-- déplace ces accès d'un bloc : l'ancienne les perd immédiatement, la
-- nouvelle les reçoit.
--
-- Ce qui ne bouge pas : les imports de participants et d'enrichissement
-- restent à l'organisation qui les a faits ; la provenance des informations
-- publiées (`published_by_organization_id`) et les droits des coureurs
-- (`entitlements.organization_id`) gardent leur organisation d'origine. Aucun
-- droit de coureur n'est retiré.
--
-- DEUX VERROUS
--
-- 1. `admin_change_event_organization` — le geste, gardé super-admin, audité.
-- 2. Un trigger sur `events` : les policies UPDATE de 0005 et 0007 laissent
--    un éditeur d'organisation ou n'importe quel `pluka_admin` réécrire la
--    ligne, `organization_id` compris. Sans ce trigger, la RPC ne serait
--    qu'une porte parmi d'autres. Une session sans utilisateur (service
--    role, migrations) n'est pas concernée : elle n'a pas d'acteur à juger.
--
-- Le statut de gestion suit la règle de 0041 : avec une organisation,
-- `organizer_managed` (« Partenaire ») ; sans, `pluka_managed`.

begin;

-- ============================================================
-- 1. Verrou sur la colonne
-- ============================================================

create or replace function private.guard_event_organization_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     and (select auth.uid()) is not null
     and not private.is_pluka_super_admin() then
    raise exception 'seul un super-admin PLUKA change l''organisation d''un evenement'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_event_organization_change() from public, anon, authenticated;

create trigger events_guard_organization_change
  before update of organization_id on public.events
  for each row execute function private.guard_event_organization_change();

-- ============================================================
-- 2. Le geste
-- ============================================================

create or replace function public.admin_change_event_organization(
  p_event_id uuid,
  p_organization_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous uuid;
begin
  perform private.assert_pluka_super_admin('admin_change_event_organization');

  select e.organization_id into v_previous
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception 'evenement introuvable' using errcode = 'P0002';
  end if;

  if p_organization_id is not null and not exists (
    select 1 from public.organizations o
    where o.id = p_organization_id and o.deleted_at is null
  ) then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;

  -- Même organisation : rien à écrire, rien à journaliser.
  if v_previous is not distinct from p_organization_id then
    return false;
  end if;

  update public.events
  set organization_id = p_organization_id,
      management_status = case
        when p_organization_id is null then 'pluka_managed'
        else 'organizer_managed'
      end::public.management_status
  where id = p_event_id;

  perform private.record_audit(
    'event.change_organization', 'events', p_event_id,
    jsonb_build_object('from', v_previous, 'to', p_organization_id)
  );

  return true;
end;
$$;

comment on function public.admin_change_event_organization(uuid, uuid) is
  'Rattache, change ou detache l''organisation d''un evenement (null = maintenu par PLUKA). Super-admin seul. Rend false si rien ne change. Audite.';

revoke all on function public.admin_change_event_organization(uuid, uuid) from public, anon;
grant execute on function public.admin_change_event_organization(uuid, uuid) to authenticated;

commit;
