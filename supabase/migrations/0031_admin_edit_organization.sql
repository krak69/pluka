-- PLUKA V1 — Fiche et édition d'une organisation depuis la console d'administration
-- File target: supabase/migrations/0031_admin_edit_organization.sql
-- Référence : docs/00_PRODUCT_SPEC.md §3.5 (« gestion d'organisations ») ·
--             docs/03_PRIVACY_RLS.md §92, §104 · migrations 0028, 0029, 0030
--
-- POURQUOI
--
-- 0030 crée une organisation ; rien ne permet ensuite de la corriger.
-- `public.organizations` n'a pas de policy UPDATE, et une policy rendrait
-- l'écriture possible mais non auditée. Même contrat que 0029 et 0030.
--
-- CE QUE CETTE MIGRATION FAIT
--
-- 1. `admin_get_organization` — la fiche, champs éditables compris
--    (`website_url` n'est pas dans la liste de 0028). Lecture opérationnelle :
--    pas d'audit, comme `admin_list_organizations` (décision du lot 4a).
-- 2. `admin_update_organization` — nom, email de contact, site web et statut.
--    La ligne est verrouillée (`for update`) ; garde, écriture et audit dans
--    la même transaction.
--
-- CE QUI NE CHANGE PAS
--
-- Le **slug** : il identifie l'organisation, et la règle des épreuves
-- s'applique (changer un slug casse ce qui le cite). Le **logo** : il demande
-- un dépôt de fichier que la console n'a pas.
--
-- LE STATUT
--
-- Les quatre valeurs de `organization_status` sont acceptées. Aujourd'hui, le
-- statut ne gouverne qu'une chose : `organizations__select__active` (0005) ne
-- rend publique que la ligne d'une organisation `active`. Il ne retire aucun
-- accès aux membres — aucune spécification ne dit ce que « suspendu » doit
-- couper, et cette migration ne l'invente pas.
--
-- L'AUDIT
--
-- `organization.update`, avec la liste des champs modifiés et, si le statut
-- change, ses deux valeurs. Jamais le nom ni l'email (§92). Une édition qui
-- ne change rien n'écrit ni la ligne ni le journal, et rend 0.
--
-- CODES D'ERREUR
--
-- `42501` refus d'accès · `P0002` organisation introuvable.

begin;

-- ============================================================
-- 1. Fiche
-- ============================================================

create or replace function public.admin_get_organization(p_organization_id uuid)
returns table (
  organization_id uuid,
  name text,
  slug text,
  status public.organization_status,
  contact_email text,
  website_url text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
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
  where o.id = p_organization_id;
end;
$$;

comment on function public.admin_get_organization(uuid) is
  'Fiche d''une organisation, tous statuts, champs editables compris. Reserve a pluka_admin. Non audite (lecture operationnelle).';

-- ============================================================
-- 2. Édition
-- ============================================================

/*
 * Remplace les quatre champs éditables. Rend le nombre de champs modifiés :
 * 0 quand la saisie est identique à la ligne, et rien n'est alors écrit.
 *
 * `is distinct from` : passer d'une valeur à `null` (effacer le site web) est
 * une modification.
 */
create or replace function public.admin_update_organization(
  p_organization_id uuid,
  p_name text,
  p_contact_email text,
  p_website_url text,
  p_status public.organization_status
)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_current public.organizations%rowtype;
  v_changed text[] := array[]::text[];
  v_after jsonb;
begin
  perform private.assert_pluka_admin('admin_update_organization');

  select * into v_current
  from public.organizations o
  where o.id = p_organization_id
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
$$;

comment on function public.admin_update_organization(uuid, text, text, text, public.organization_status) is
  'Edite nom, email de contact, site web et statut d''une organisation. Slug inchange. Audite (champs modifies, jamais leurs valeurs hors statut).';

-- ============================================================
-- 3. Droits d'exécution
-- ============================================================

revoke all on function public.admin_get_organization(uuid) from public, anon;
revoke all on function public.admin_update_organization(uuid, text, text, text, public.organization_status) from public, anon;

grant execute on function public.admin_get_organization(uuid) to authenticated;
grant execute on function public.admin_update_organization(uuid, text, text, text, public.organization_status) to authenticated;

commit;
