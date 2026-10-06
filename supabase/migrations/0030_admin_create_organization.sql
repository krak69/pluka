-- PLUKA V1 — Création d'une organisation depuis la console d'administration
-- File target: supabase/migrations/0030_admin_create_organization.sql
-- Référence : docs/00_PRODUCT_SPEC.md §3.5 (« gestion d'organisations ») ·
--             docs/03_PRIVACY_RLS.md §104 · migrations 0028, 0029
--
-- POURQUOI
--
-- `public.organizations` n'a aucune policy INSERT (0005 : deux policies
-- SELECT). Une policy de plus rendrait l'écriture possible mais non auditée.
-- Même contrat que les cinq gestes de 0029 :
--
-- 1. `private.assert_pluka_admin` en première instruction — `42501` ;
-- 2. l'insertion et `private.record_audit` dans la même transaction ;
-- 3. un slug déjà pris remonte en `23505`, que `@pluka/db` traduit en
--    `conflict`.
--
-- Le statut n'est pas un paramètre : la ligne prend le défaut de la colonne
-- (`active`, 0001). Choisir un statut à la création est une décision produit
-- que ce lot ne prend pas.
--
-- L'audit est minimal (§92) : le slug et le statut. Ni le nom, ni l'adresse de
-- contact.
--
-- Aucune nouvelle policy. Aucune nouvelle table.

begin;

create or replace function public.admin_create_organization(
  p_name text,
  p_slug text,
  p_contact_email text default null,
  p_website_url text default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_status public.organization_status;
begin
  perform private.assert_pluka_admin('admin_create_organization');

  insert into public.organizations (name, slug, contact_email, website_url)
  values (p_name, p_slug, p_contact_email, p_website_url)
  returning id, status into v_id, v_status;

  perform private.record_audit(
    'organization.create',
    'organizations',
    v_id,
    jsonb_build_object('slug', p_slug, 'status', v_status)
  );

  return v_id;
end;
$$;

comment on function public.admin_create_organization(text, text, text, text) is
  'Cree une organisation au statut par defaut de la colonne. Reserve a pluka_admin. Audite.';

revoke all on function public.admin_create_organization(text, text, text, text) from public, anon;
grant execute on function public.admin_create_organization(text, text, text, text) to authenticated;

commit;
