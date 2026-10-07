-- PLUKA V1 — Équipe PLUKA : membres, rôles, invitations par email
-- File target: supabase/migrations/0036_platform_staff_team.sql
-- Référence : docs/03_PRIVACY_RLS.md §4, §104, §115–§118 · AGENTS.md §64, §83 ·
--             migrations 0033 (même mécanique), 0035 (les rôles)
--
-- QUI
--
-- Tout ce qui suit est réservé au `super_admin` (0035). Un admin gère la
-- console, pas l'équipe qui la gère.
--
-- INVARIANTS
--
-- - l'équipe garde toujours au moins un super-admin : rétrograder ou retirer
--   le dernier est refusé en `55000`, sous verrou des super-admins ;
-- - retirer un membre le rend simple utilisateur (`platform_role = 'user'`,
--   `staff_role` effacé par le trigger de 0035) ; ses accès cessent à la
--   requête suivante, ses actions passées restent au journal (§114) ;
-- - aucune « impersonation » (AGENTS §83) : on donne un rôle, jamais
--   l'identité d'un autre.
--
-- INVITATIONS
--
-- Même mécanique que 0033 : pas de jeton à la création ; le worker le tire à
-- l'envoi et n'en stocke que le SHA-256 ; le jeton en clair n'existe que dans
-- l'email. L'acceptation exige un compte connecté **à l'adresse invitée**
-- (§117), une seule fois (§118). Validité 7 jours, comme 0033.
--
-- Les fonctions qui écrivent `platform_role` / `staff_role` lèvent le verrou
-- de colonnes de 0035 (`pluka.staff_write`) pour leur seule transaction,
-- après leur propre vérification.
--
-- L'AUDIT
--
-- `staff.<geste>`, jamais d'adresse (§92) : identifiants, rôles.

begin;

-- ============================================================
-- 1. Invitations
-- ============================================================

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null,
  staff_role public.staff_role not null,
  status public.invitation_status not null default 'pending',
  token_hash char(64) unique,
  invited_by_user_id uuid references public.users(id) on delete set null,
  accepted_by_user_id uuid references public.users(id) on delete set null,
  send_attempts integer not null default 0 check (send_attempts >= 0),
  last_send_error text,
  expires_at timestamptz not null,
  sent_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'opened')
);

create unique index ux_staff_invitations_open
  on public.staff_invitations(email)
  where status in ('pending', 'sent');

create trigger trg_staff_invitations_updated_at
  before update on public.staff_invitations
  for each row execute function private.set_updated_at();

alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from public, anon, authenticated;

comment on table public.staff_invitations is
  'Invitations a rejoindre l''equipe PLUKA (0036). Jeton tire par le worker, seul son SHA-256 stocke. Acces par fonctions security definer uniquement.';

-- ============================================================
-- 2. Lectures
-- ============================================================

create or replace function public.staff_list_members()
returns table (
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  staff_role public.staff_role,
  created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_super_admin('staff_list_members');

  return query
  select u.id, u.email::text, u.first_name, u.last_name, u.staff_role, u.created_at
  from public.users u
  where u.platform_role = 'pluka_admin'
  order by
    case u.staff_role when 'super_admin' then 0 when 'admin' then 1 else 2 end,
    u.email;
end;
$$;

create or replace function public.staff_list_invitations()
returns table (
  invitation_id uuid,
  email text,
  staff_role public.staff_role,
  status public.invitation_status,
  send_failed boolean,
  expires_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_super_admin('staff_list_invitations');

  return query
  select
    i.id,
    i.email::text,
    i.staff_role,
    case when i.expires_at <= now() then 'expired'::public.invitation_status else i.status end,
    i.status = 'pending' and i.last_send_error is not null,
    i.expires_at,
    i.sent_at,
    i.created_at
  from public.staff_invitations i
  where i.status in ('pending', 'sent')
  order by i.created_at desc;
end;
$$;

-- ============================================================
-- 3. Inviter, révoquer
-- ============================================================

create or replace function public.staff_invite(p_email text, p_staff_role public.staff_role)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email extensions.citext := lower(trim(p_email));
  v_invitation_id uuid;
begin
  perform private.assert_pluka_super_admin('staff_invite');

  if exists (
    select 1 from public.users u where u.email = v_email and u.platform_role = 'pluka_admin'
  ) then
    raise exception 'deja membre de l''equipe PLUKA' using errcode = '23505';
  end if;

  update public.staff_invitations
  set status = 'revoked', revoked_at = now()
  where email = v_email and status in ('pending', 'sent');

  insert into public.staff_invitations (email, staff_role, invited_by_user_id, expires_at)
  values (v_email, p_staff_role, (select auth.uid()), now() + interval '7 days')
  returning id into v_invitation_id;

  insert into private.outbox_events
    (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'email.staff_invitation',
    'staff_invitation',
    v_invitation_id,
    jsonb_build_object('staffInvitationId', v_invitation_id),
    'email.staff_invitation:' || v_invitation_id
  );

  perform private.record_audit(
    'staff.invite', 'staff_invitations', v_invitation_id,
    jsonb_build_object('staffRole', p_staff_role)
  );

  return v_invitation_id;
end;
$$;

create or replace function public.staff_revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.invitation_status;
begin
  perform private.assert_pluka_super_admin('staff_revoke_invitation');

  select i.status into v_status
  from public.staff_invitations i
  where i.id = p_invitation_id
  for update;

  if not found then
    raise exception 'invitation introuvable' using errcode = 'P0002';
  end if;

  if v_status not in ('pending', 'sent') then
    raise exception 'invitation deja close (%)', v_status using errcode = '55000';
  end if;

  update public.staff_invitations
  set status = 'revoked', revoked_at = now()
  where id = p_invitation_id;

  perform private.record_audit(
    'staff.revoke_invitation', 'staff_invitations', p_invitation_id,
    jsonb_build_object('statusFrom', v_status)
  );
end;
$$;

-- ============================================================
-- 4. Rôles et retrait
-- ============================================================

/* Verrouille les super-admins et rend leur nombre. */
create or replace function private.lock_super_admins()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform 1 from public.users where staff_role = 'super_admin' for update;
  select count(*) into v_count from public.users where staff_role = 'super_admin';
  return v_count;
end;
$$;

revoke all on function private.lock_super_admins() from public, anon, authenticated;

create or replace function public.staff_change_role(p_user_id uuid, p_staff_role public.staff_role)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_super_admins integer;
  v_current public.staff_role;
begin
  perform private.assert_pluka_super_admin('staff_change_role');

  v_super_admins := private.lock_super_admins();

  select u.staff_role into v_current
  from public.users u
  where u.id = p_user_id and u.platform_role = 'pluka_admin'
  for update;

  if not found then
    raise exception 'membre de l''equipe introuvable' using errcode = 'P0002';
  end if;

  if v_current = p_staff_role then
    return false;
  end if;

  if v_current = 'super_admin' and v_super_admins <= 1 then
    raise exception 'dernier super-admin de l''equipe' using errcode = '55000';
  end if;

  perform set_config('pluka.staff_write', 'on', true);
  update public.users set staff_role = p_staff_role where id = p_user_id;
  perform set_config('pluka.staff_write', '', true);

  perform private.record_audit(
    'staff.change_role', 'users', p_user_id,
    jsonb_build_object('roleFrom', v_current, 'roleTo', p_staff_role)
  );

  return true;
end;
$$;

create or replace function public.staff_remove(p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_super_admins integer;
  v_current public.staff_role;
begin
  perform private.assert_pluka_super_admin('staff_remove');

  v_super_admins := private.lock_super_admins();

  select u.staff_role into v_current
  from public.users u
  where u.id = p_user_id and u.platform_role = 'pluka_admin'
  for update;

  if not found then
    raise exception 'membre de l''equipe introuvable' using errcode = 'P0002';
  end if;

  if v_current = 'super_admin' and v_super_admins <= 1 then
    raise exception 'dernier super-admin de l''equipe' using errcode = '55000';
  end if;

  perform set_config('pluka.staff_write', 'on', true);
  update public.users set platform_role = 'user' where id = p_user_id;
  perform set_config('pluka.staff_write', '', true);

  perform private.record_audit(
    'staff.remove', 'users', p_user_id,
    jsonb_build_object('role', v_current)
  );
end;
$$;

-- ============================================================
-- 5. Le lien d'invitation
-- ============================================================

/* Aperçu avant connexion : le rôle et l'état du lien, rien d'autre. */
create or replace function public.preview_staff_invitation(p_token_hash text)
returns table (state text, staff_role public.staff_role)
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.staff_invitations%rowtype;
begin
  select * into v_invitation from public.staff_invitations i where i.token_hash = p_token_hash;

  if not found then
    return query select 'unknown'::text, null::public.staff_role;
    return;
  end if;

  return query select
    case
      when v_invitation.status not in ('pending', 'sent') then 'closed'
      when v_invitation.expires_at <= now() then 'expired'
      else 'valid'
    end,
    v_invitation.staff_role;
end;
$$;

create or replace function public.accept_staff_invitation(p_token_hash text)
returns public.staff_role
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.staff_invitations%rowtype;
  v_user public.users%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'connexion requise' using errcode = '42501';
  end if;

  select * into v_invitation
  from public.staff_invitations i
  where i.token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'invitation introuvable' using errcode = 'P0002';
  end if;

  if v_invitation.status not in ('pending', 'sent') then
    raise exception 'invitation close (%)', v_invitation.status using errcode = '55000';
  end if;

  if v_invitation.expires_at <= now() then
    update public.staff_invitations set status = 'expired' where id = v_invitation.id;
    raise exception 'invitation expiree' using errcode = '55000';
  end if;

  select * into v_user from public.users u where u.id = (select auth.uid()) for update;

  -- §117 : le lien transféré ne suffit pas. Le refus ne cite pas l'adresse.
  if v_user.email is distinct from v_invitation.email then
    raise exception 'invitation destinee a une autre adresse' using errcode = '42501';
  end if;

  -- Déjà dans l'équipe — entré entre-temps par un autre chemin : son rôle en
  -- place est conservé, l'invitation est consommée.
  if v_user.platform_role <> 'pluka_admin' then
    perform set_config('pluka.staff_write', 'on', true);
    update public.users
    set platform_role = 'pluka_admin', staff_role = v_invitation.staff_role
    where id = v_user.id;
    perform set_config('pluka.staff_write', '', true);
  end if;

  update public.staff_invitations
  set status = 'activated', activated_at = now(), accepted_by_user_id = v_user.id
  where id = v_invitation.id;

  perform private.record_audit(
    'staff.join', 'staff_invitations', v_invitation.id,
    jsonb_build_object('staffRole', v_invitation.staff_role)
  );

  return (select u.staff_role from public.users u where u.id = v_user.id);
end;
$$;

-- ============================================================
-- 6. Envoi — worker uniquement
-- ============================================================

create or replace function public.worker_claim_staff_invitation(
  p_invitation_id uuid,
  p_token_hash text
)
returns table (
  sendable boolean,
  email text,
  staff_role public.staff_role,
  inviter_name text,
  expires_at timestamptz,
  attempt integer
)
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.staff_invitations%rowtype;
begin
  select * into v_invitation
  from public.staff_invitations i
  where i.id = p_invitation_id
  for update;

  if not found or v_invitation.status <> 'pending' then
    return query select false, null::text, null::public.staff_role, null::text, null::timestamptz, 0;
    return;
  end if;

  if v_invitation.expires_at <= now() then
    update public.staff_invitations set status = 'expired' where id = p_invitation_id;
    return query select false, null::text, null::public.staff_role, null::text, null::timestamptz, 0;
    return;
  end if;

  update public.staff_invitations
  set token_hash = p_token_hash, send_attempts = send_attempts + 1
  where id = p_invitation_id;

  return query
  select
    true,
    v_invitation.email::text,
    v_invitation.staff_role,
    (select nullif(trim(concat_ws(' ', u.first_name, u.last_name)), '')
       from public.users u where u.id = v_invitation.invited_by_user_id),
    v_invitation.expires_at,
    v_invitation.send_attempts + 1;
end;
$$;

create or replace function public.worker_complete_staff_invitation(p_invitation_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.staff_invitations
  set status = 'sent', sent_at = now(), last_send_error = null
  where id = p_invitation_id and status = 'pending';
$$;

create or replace function public.worker_fail_staff_invitation(p_invitation_id uuid, p_error text)
returns integer language sql security definer set search_path = '' as $$
  update public.staff_invitations
  set last_send_error = left(p_error, 500)
  where id = p_invitation_id
  returning send_attempts;
$$;

-- ============================================================
-- 7. Droits d'exécution
-- ============================================================

revoke all on function public.staff_list_members() from public, anon;
revoke all on function public.staff_list_invitations() from public, anon;
revoke all on function public.staff_invite(text, public.staff_role) from public, anon;
revoke all on function public.staff_revoke_invitation(uuid) from public, anon;
revoke all on function public.staff_change_role(uuid, public.staff_role) from public, anon;
revoke all on function public.staff_remove(uuid) from public, anon;
revoke all on function public.preview_staff_invitation(text) from public;
revoke all on function public.accept_staff_invitation(text) from public, anon;

grant execute on function public.staff_list_members() to authenticated;
grant execute on function public.staff_list_invitations() to authenticated;
grant execute on function public.staff_invite(text, public.staff_role) to authenticated;
grant execute on function public.staff_revoke_invitation(uuid) to authenticated;
grant execute on function public.staff_change_role(uuid, public.staff_role) to authenticated;
grant execute on function public.staff_remove(uuid) to authenticated;
grant execute on function public.preview_staff_invitation(text) to anon, authenticated;
grant execute on function public.accept_staff_invitation(text) to authenticated;

revoke all on function public.worker_claim_staff_invitation(uuid, text) from public, anon, authenticated;
revoke all on function public.worker_complete_staff_invitation(uuid) from public, anon, authenticated;
revoke all on function public.worker_fail_staff_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.worker_claim_staff_invitation(uuid, text) to service_role;
grant execute on function public.worker_complete_staff_invitation(uuid) to service_role;
grant execute on function public.worker_fail_staff_invitation(uuid, text) to service_role;

commit;
