-- PLUKA V1 — Suppression d'une organisation vide depuis la console d'administration
-- File target: supabase/migrations/0032_admin_delete_organization.sql
-- Référence : docs/00_PRODUCT_SPEC.md §3.5 · docs/03_PRIVACY_RLS.md §92, §104 ·
--             AGENTS.md §13, §14, §82 · migrations 0029, 0030, 0031
--
-- POURQUOI UNE SUPPRESSION RESTREINTE
--
-- Les clés étrangères vers `organizations` ne sont pas neutres. Supprimer une
-- organisation qui porte des données :
--
-- - effacerait ses memberships (`on delete cascade`) ;
-- - laisserait ses événements sans organisation (`set null`) mais toujours
--   `organizer_managed` ;
-- - effacerait la provenance d'informations publiées
--   (`race_fact_versions.validated_by_organization_id`, `race_notices`,
--   `race_change_events`) — une version publiée est immuable (§14) et chaque
--   fait publié doit rester traçable (§13) ;
-- - détacherait des droits « Inclus organisateur » de leur origine
--   (`entitlements`) ;
-- - échouerait sur un import de participants (`restrict`).
--
-- La suppression n'est donc ouverte qu'à une organisation **sans aucune
-- donnée liée** — typiquement une création par erreur. Les autres se
-- terminent par le statut `archived` (« Terminé »), via 0031.
--
-- `private.audit_logs` et `private.analytics_events` ne bloquent pas : ce sont
-- des journaux, leur `organization_id` passe à `null`, et les entrées d'audit
-- qui visent l'organisation la désignent par `entity_id`, qui n'est pas une
-- clé étrangère et survit.
--
-- CODES D'ERREUR
--
-- `42501` refus d'accès · `P0002` introuvable · `55000` des données restent
-- liées — le message les nomme, pour les logs ; l'écran dit quoi faire.
--
-- L'AUDIT
--
-- `organization.delete`, avec le slug et le statut au moment de la
-- suppression : la ligne disparaît, le journal doit suffire à dire laquelle.

begin;

create or replace function public.admin_delete_organization(p_organization_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_slug text;
  v_status public.organization_status;
  v_linked text[] := array[]::text[];
begin
  perform private.assert_pluka_admin('admin_delete_organization');

  select o.slug, o.status into v_slug, v_status
  from public.organizations o
  where o.id = p_organization_id
  for update;

  if not found then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.organization_members where organization_id = p_organization_id) then
    v_linked := array_append(v_linked, 'organization_members');
  end if;
  if exists (select 1 from public.events where organization_id = p_organization_id) then
    v_linked := array_append(v_linked, 'events');
  end if;
  if exists (select 1 from public.sources where organization_id = p_organization_id) then
    v_linked := array_append(v_linked, 'sources');
  end if;
  if exists (select 1 from public.race_fact_versions where validated_by_organization_id = p_organization_id) then
    v_linked := array_append(v_linked, 'race_fact_versions');
  end if;
  if exists (select 1 from public.race_notices where published_by_organization_id = p_organization_id) then
    v_linked := array_append(v_linked, 'race_notices');
  end if;
  if exists (select 1 from public.race_change_events where published_by_organization_id = p_organization_id) then
    v_linked := array_append(v_linked, 'race_change_events');
  end if;
  if exists (select 1 from public.entitlements where organization_id = p_organization_id) then
    v_linked := array_append(v_linked, 'entitlements');
  end if;
  if exists (select 1 from public.participant_imports where organization_id = p_organization_id) then
    v_linked := array_append(v_linked, 'participant_imports');
  end if;
  if exists (select 1 from public.enrichment_imports where organization_id = p_organization_id) then
    v_linked := array_append(v_linked, 'enrichment_imports');
  end if;

  if cardinality(v_linked) > 0 then
    raise exception 'organisation liee a des donnees : %', array_to_string(v_linked, ', ')
      using errcode = '55000';
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

comment on function public.admin_delete_organization(uuid) is
  'Supprime une organisation sans aucune donnee liee (membres, evenements, sources, provenance, droits, imports). Sinon 55000. Audite.';

revoke all on function public.admin_delete_organization(uuid) from public, anon;
grant execute on function public.admin_delete_organization(uuid) to authenticated;

commit;
