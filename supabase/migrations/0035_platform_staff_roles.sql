-- PLUKA V1 — Rôles de l'équipe PLUKA : super-admin, admin, support
-- File target: supabase/migrations/0035_platform_staff_roles.sql
-- Référence : docs/03_PRIVACY_RLS.md §4, §8, §104 · AGENTS.md §81, §83 ·
--             décision produit du 2026-10-07
--
-- POURQUOI
--
-- `platform_role = 'pluka_admin'` ouvrait tout : lecture et écriture, sur
-- toute la console. L'équipe PLUKA a désormais trois rôles :
--
--   super_admin  tout, y compris Paramètres et l'équipe PLUKA elle-même ;
--   admin        toute la console, sauf Paramètres ;
--   support      lecture seule — vue d'ensemble, événements, organisations,
--                utilisateurs, traitements, journal. Aucune écriture.
--
-- `platform_role` garde son sens (« fait partie de l'équipe PLUKA ») ; le
-- rôle précis est `users.staff_role`, nul hors de l'équipe.
--
-- REFUS PAR DÉFAUT
--
-- Les trois helpers existants — `is_pluka_admin`, `user_id_is_pluka_admin`,
-- `assert_pluka_admin` — sont appelés par toutes les écritures (policies de
-- 0007, publication de 0012, transitions de 0022, imports de 0023, gestes de
-- 0029 à 0033). Ils signifient désormais « peut écrire » : super_admin ou
-- admin. Support les perd tous d'un coup.
--
-- Les lectures de Support sont ensuite rouvertes **une à une** : un oubli ne
-- produit qu'un refus, jamais une écriture permise. C'est le sens inverse qui
-- serait dangereux — énumérer les écritures à fermer.
--
-- Les lectures rouvertes :
--
-- - les RPC de console listées dans `private.staff_read_actions()` ;
-- - les policies SELECT des événements, éditions, épreuves et de leurs
--   journaux de statut ;
-- - la lecture de l'équipe d'une organisation (0033).
--
-- COMPATIBILITÉ
--
-- Un compte passé `pluka_admin` sans rôle précis reçoit `admin` — le rôle
-- d'écriture le plus étroit, sans Paramètres. Les comptes déjà `pluka_admin`
-- avant cette migration deviennent `super_admin`, pour qu'aucune équipe ne
-- se retrouve enfermée dehors.
--
-- LE VERROU DE COLONNES
--
-- `protect_user_columns` (0005) refusait déjà tout changement de
-- `platform_role` sous une session. Il couvre maintenant `staff_role`. Les
-- fonctions de 0036 qui gèrent l'équipe le lèvent pour leur seule
-- transaction, par `pluka.staff_write` — un réglage qu'aucun client ne peut
-- poser : PostgREST n'expose pas `set_config`.

begin;

-- ============================================================
-- 1. Le rôle
-- ============================================================

create type public.staff_role as enum ('super_admin', 'admin', 'support');

alter table public.users add column staff_role public.staff_role;

update public.users set staff_role = 'super_admin' where platform_role = 'pluka_admin';

alter table public.users
  add constraint users_staff_role_only_for_pluka_team
  check ((platform_role = 'pluka_admin') = (staff_role is not null));

comment on column public.users.staff_role is
  'Role dans l''equipe PLUKA (0035) : super_admin, admin, support. Nul hors equipe. Administre cote serveur uniquement.';

/*
 * Garde la cohérence entre les deux colonnes sans que chaque écriture ait à y
 * penser : entrer dans l'équipe sans rôle donne `admin`, en sortir efface le
 * rôle. Rien d'autre n'est corrigé. Nommé pour passer avant `users_protect_columns` (ordre alphabétique
 * des triggers BEFORE).
 */
create or replace function private.normalize_staff_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.platform_role = 'pluka_admin' and new.staff_role is null then
    new.staff_role := 'admin';
  elsif tg_op = 'UPDATE'
    and old.platform_role = 'pluka_admin'
    and new.platform_role <> 'pluka_admin' then
    -- Sortir de l'équipe efface le rôle. Poser un rôle sur un compte hors
    -- équipe n'est pas « corrigé » en silence : la contrainte le refuse.
    new.staff_role := null;
  end if;

  return new;
end;
$$;

create trigger users_normalize_staff_role
  before insert or update of platform_role, staff_role on public.users
  for each row execute function private.normalize_staff_role();

-- ============================================================
-- 2. Le verrou de colonnes
-- ============================================================

create or replace function private.protect_user_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Le garde-fou vise les sessions client. Un traitement serveur légitime —
  -- support, migration, worker — agit sans session utilisateur : `auth.uid()`
  -- y est nul, et il reste responsable de ses propres vérifications (§8).
  if (select auth.uid()) is null then
    return new;
  end if;

  -- 0036 : les fonctions de gestion de l'équipe PLUKA lèvent le verrou pour
  -- leur transaction, après avoir vérifié elles-mêmes le droit (super_admin).
  if coalesce(current_setting('pluka.staff_write', true), '') <> 'on' then
    if new.platform_role is distinct from old.platform_role then
      raise exception 'platform_role est administré côté serveur'
        using errcode = '42501';
    end if;

    if new.staff_role is distinct from old.staff_role then
      raise exception 'staff_role est administré côté serveur'
        using errcode = '42501';
    end if;
  end if;

  if new.email is distinct from old.email then
    raise exception 'email est administré par Supabase Auth'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id then
    raise exception 'id est immuable' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ============================================================
-- 3. Helpers — refus par défaut
-- ============================================================

create or replace function private.staff_role_of(p_user_id uuid)
returns public.staff_role language sql stable security definer set search_path = '' as $$
  select u.staff_role from public.users u
  where u.id = p_user_id and u.platform_role = 'pluka_admin';
$$;

/* « Peut écrire » : super_admin ou admin. Support n'y entre pas. */
create or replace function private.is_pluka_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    private.staff_role_of((select auth.uid())) in ('super_admin', 'admin'),
    false
  );
$$;

comment on function private.is_pluka_admin() is
  'Ecriture d''administration PLUKA : super_admin ou admin (0035). Support exclu.';

create or replace function private.user_id_is_pluka_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.staff_role_of(p_user_id) in ('super_admin', 'admin'), false);
$$;

/* Tout membre de l'équipe PLUKA, support compris : la lecture. */
create or replace function private.is_pluka_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.staff_role_of((select auth.uid())) is not null;
$$;

create or replace function private.is_pluka_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.staff_role_of((select auth.uid())) = 'super_admin', false);
$$;

/*
 * Lectures de console ouvertes à Support — la liste est ici, et seulement
 * ici. Une RPC absente exige l'écriture : c'est le refus par défaut.
 */
create or replace function private.staff_read_actions()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    'admin_platform_counters',
    'admin_list_organizations',
    'admin_get_organization',
    'admin_search_users',
    'admin_get_user',
    'admin_list_jobs',
    'admin_list_audit'
  ];
$$;

create or replace function private.assert_pluka_admin(p_action text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_action = any (private.staff_read_actions()) then
    if not private.is_pluka_staff() then
      raise exception 'action reservee a l''equipe PLUKA : %', p_action using errcode = '42501';
    end if;
    return;
  end if;

  if not private.is_pluka_admin() then
    -- `42501` est le code que PostgreSQL émet lui-même sur une policy violée :
    -- l'appelant n'a pas à distinguer un refus de fonction d'un refus de table.
    raise exception 'action reservee a l''administration PLUKA : %', p_action
      using errcode = '42501';
  end if;
end;
$$;

create or replace function private.assert_pluka_super_admin(p_action text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_pluka_super_admin() then
    raise exception 'action reservee aux super-admins PLUKA : %', p_action using errcode = '42501';
  end if;
end;
$$;

-- `is_pluka_staff` et `is_pluka_super_admin` restent exécutables par tous,
-- comme `is_pluka_admin` : les policies sont évaluées avec les droits de
-- l'appelant, et ces fonctions ne disent rien d'autre que son propre statut.
revoke all on function private.staff_role_of(uuid) from public, anon, authenticated;
revoke all on function private.staff_read_actions() from public, anon, authenticated;
revoke all on function private.assert_pluka_super_admin(text) from public, anon, authenticated;

-- ============================================================
-- 4. Lectures rouvertes à Support
-- ============================================================

-- Les policies SELECT existantes (0005, 0006, 0022) restent ; celles-ci
-- s'ajoutent, en OU, pour le reste de l'équipe.
create policy events__select__pluka_staff on public.events
  for select to authenticated using (private.is_pluka_staff());
create policy editions__select__pluka_staff on public.editions
  for select to authenticated using (private.is_pluka_staff());
create policy races__select__pluka_staff on public.races
  for select to authenticated using (private.is_pluka_staff());
create policy event_status_transitions__select__pluka_staff on public.event_status_transitions
  for select to authenticated using (private.is_pluka_staff());
create policy edition_status_transitions__select__pluka_staff on public.edition_status_transitions
  for select to authenticated using (private.is_pluka_staff());
create policy race_status_transitions__select__pluka_staff on public.race_status_transitions
  for select to authenticated using (private.is_pluka_staff());

-- Équipe d'une organisation (0033) : gérer reste à l'owner et à qui écrit ;
-- lire s'ouvre à toute l'équipe PLUKA.
create or replace function private.can_manage_org_team(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_pluka_admin() or exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = (select auth.uid())
      and om.role = 'owner'
  );
$$;

create or replace function private.can_read_org_team(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_pluka_staff() or private.can_manage_org_team(p_organization_id);
$$;

revoke all on function private.can_read_org_team(uuid) from public, anon, authenticated;

create or replace function public.org_list_members(p_organization_id uuid)
returns table (
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  role public.organization_member_role,
  joined_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_read_org_team(p_organization_id) then
    raise exception 'org_list_members : lecture de l''equipe refusee' using errcode = '42501';
  end if;

  return query
  select u.id, u.email::text, u.first_name, u.last_name, om.role, om.created_at
  from public.organization_members om
  join public.users u on u.id = om.user_id
  where om.organization_id = p_organization_id
  order by
    case om.role when 'owner' then 0 when 'admin' then 1 when 'editor' then 2 else 3 end,
    u.email;
end;
$$;

create or replace function public.org_list_invitations(p_organization_id uuid)
returns table (
  invitation_id uuid,
  email text,
  role public.organization_member_role,
  status public.invitation_status,
  send_failed boolean,
  expires_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_read_org_team(p_organization_id) then
    raise exception 'org_list_invitations : lecture de l''equipe refusee' using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.email::text,
    i.role,
    case when i.expires_at <= now() then 'expired'::public.invitation_status else i.status end,
    i.status = 'pending' and i.last_send_error is not null,
    i.expires_at,
    i.sent_at,
    i.created_at
  from public.organization_invitations i
  where i.organization_id = p_organization_id
    and i.status in ('pending', 'sent')
  order by i.created_at desc;
end;
$$;

-- ============================================================
-- 5. Le rôle de la session, pour l'interface
-- ============================================================

/*
 * Rend le rôle de l'appelant dans l'équipe PLUKA, ou `null`. Sert à composer
 * le menu de la console — jamais à autoriser : chaque fonction garde sa
 * propre garde, et un menu trompé n'ouvre rien.
 */
create or replace function public.my_staff_role()
returns public.staff_role language sql stable security definer set search_path = '' as $$
  select private.staff_role_of((select auth.uid()));
$$;

revoke all on function public.my_staff_role() from public, anon;
grant execute on function public.my_staff_role() to authenticated;

commit;
