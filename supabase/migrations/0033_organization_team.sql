-- PLUKA V1 — Équipe d'une organisation : membres, rôles et invitations par email
-- File target: supabase/migrations/0033_organization_team.sql
-- Référence : docs/03_PRIVACY_RLS.md §3, §15, §114, §115–§118 ·
--             docs/01_ARCHITECTURE.md §22 · AGENTS.md §64, §81, §82
--
-- POURQUOI
--
-- `organization_members` existe depuis 0001 avec ses quatre rôles (owner,
-- admin, editor, viewer), mais aucune écriture : pas de policy INSERT, UPDATE
-- ni DELETE, et §15 veut que « les mutations membres passent par un service
-- serveur ». Cette migration livre ce service.
--
-- QUI GÈRE L'ÉQUIPE
--
-- `private.can_manage_org_team` : un `pluka_admin`, ou un **owner** de
-- l'organisation. Personne d'autre — un admin d'organisation n'a pas la main
-- sur l'équipe. §3 laisse sa part « selon politique » ; le prototype tranche
-- (`orgTeam` : « Propriétaire — gère tout, y compris l'organisation et
-- l'équipe » ; « Administratrice — gère l'événement, les sources et les
-- participants »). Les rôles sont comparés par valeur, jamais par rang
-- (AGENTS §81).
--
-- INVARIANTS
--
-- - une organisation qui a un owner en garde au moins un : rétrograder ou
--   retirer le dernier owner est refusé en `55000` (§15). Les owners sont
--   verrouillés pendant le contrôle, pour que deux retraits concurrents ne
--   passent pas chacun en voyant l'autre ;
-- - retirer un membre coupe ses accès B2B immédiatement — la RLS relit
--   l'appartenance à chaque requête (§114) — et ne lui transfère rien.
--
-- INVITATIONS
--
-- Une invitation vise une adresse et un rôle. Elle n'a **pas de jeton à sa
-- création** : le worker le tire au moment de l'envoi, n'en garde que le
-- SHA-256 (`token_hash`), et met le jeton en clair dans l'email — seul endroit
-- où il existe (AGENTS §64). Un jeton en clair ne transite donc jamais par
-- l'outbox, la file ou la base.
--
-- Une relance d'envoi tire un nouveau jeton et remplace le hash : le lien
-- d'un email qui ne serait jamais parti n'a pas à rester valide. La clé
-- d'idempotence du fournisseur inclut le numéro de tentative, pour qu'un
-- nouvel email ne soit pas dédoublonné vers l'ancien jeton.
--
-- Accepter exige un compte connecté **dont l'adresse est celle de
-- l'invitation** (§117) : un lien transféré ne fait pas entrer quelqu'un
-- d'autre. L'activation est unique, sous verrou (§118).
--
-- Réinviter la même adresse révoque l'invitation ouverte précédente : une
-- seule invitation ouverte par organisation et par adresse.
--
-- Durée de validité : 7 jours. Aucune spécification ne la chiffre — c'est une
-- décision de ce lot, documentée dans 05_ROUTES_FLOWS.
--
-- L'AUDIT
--
-- Chaque geste écrit `private.record_audit` dans sa transaction. Jamais
-- d'adresse email (§92) : l'identifiant de l'invitation ou du membre, le rôle,
-- l'organisation.
--
-- CODES D'ERREUR
--
-- `42501` refus · `P0002` introuvable · `55000` transition refusée (dernier
-- owner, invitation close) · `23505` déjà membre.

begin;

-- ============================================================
-- 1. Invitations
-- ============================================================

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email extensions.citext not null,
  role public.organization_member_role not null,
  -- pending → sent → activated, ou → revoked / expired. `opened` n'est pas
  -- posé : rien ne mesure l'ouverture d'un email, et ce n'est pas souhaité.
  status public.invitation_status not null default 'pending',
  -- Nul jusqu'au premier envoi. SHA-256 hexadécimal, comme
  -- `participant_invitations.token_hash`.
  token_hash char(64) unique,
  invited_by_user_id uuid references public.users(id) on delete set null,
  accepted_by_user_id uuid references public.users(id) on delete set null,
  send_attempts integer not null default 0 check (send_attempts >= 0),
  -- Erreur normalisée du dernier envoi raté — jamais l'adresse ni le contenu.
  last_send_error text,
  expires_at timestamptz not null,
  sent_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'opened')
);

create unique index ux_organization_invitations_open
  on public.organization_invitations(organization_id, email)
  where status in ('pending', 'sent');

create index ix_organization_invitations_organization
  on public.organization_invitations(organization_id, created_at desc);

create trigger trg_organization_invitations_updated_at
  before update on public.organization_invitations
  for each row execute function private.set_updated_at();

-- Deny by default, et aucune policy : tout passe par les fonctions ci-dessous.
alter table public.organization_invitations enable row level security;
revoke all on public.organization_invitations from public, anon, authenticated;

comment on table public.organization_invitations is
  'Invitations a rejoindre l''equipe d''une organisation. Jeton tire par le worker a l''envoi, seul son SHA-256 est stocke. Acces uniquement par fonctions security definer (0033).';

-- ============================================================
-- 2. Garde
-- ============================================================

create or replace function private.can_manage_org_team(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    where u.id = (select auth.uid()) and u.platform_role = 'pluka_admin'
  ) or exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = (select auth.uid())
      and om.role = 'owner'
  );
$$;

create or replace function private.assert_can_manage_org_team(
  p_organization_id uuid,
  p_action text
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_org_team(p_organization_id) then
    raise exception '% : gestion de l''equipe refusee', p_action using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.can_manage_org_team(uuid) from public, anon, authenticated;
revoke all on function private.assert_can_manage_org_team(uuid, text) from public, anon, authenticated;

-- ============================================================
-- 3. Lectures de l'équipe
-- ============================================================

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
  perform private.assert_can_manage_org_team(p_organization_id, 'org_list_members');

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

/*
 * Invitations ouvertes. Une invitation `sent` dont la date est passée est
 * rendue `expired` à la lecture, sans écriture : la ligne sera marquée au
 * moment où quelqu'un tentera de l'utiliser.
 */
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
  perform private.assert_can_manage_org_team(p_organization_id, 'org_list_invitations');

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
-- 4. Inviter
-- ============================================================

create or replace function public.org_invite_member(
  p_organization_id uuid,
  p_email text,
  p_role public.organization_member_role
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email extensions.citext := lower(trim(p_email));
  v_invitation_id uuid;
begin
  perform private.assert_can_manage_org_team(p_organization_id, 'org_invite_member');

  perform 1 from public.organizations o where o.id = p_organization_id for share;
  if not found then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.organization_members om
    join public.users u on u.id = om.user_id
    where om.organization_id = p_organization_id and u.email = v_email
  ) then
    raise exception 'deja membre de l''organisation' using errcode = '23505';
  end if;

  -- Une seule invitation ouverte par adresse : la précédente est révoquée,
  -- son lien cesse de fonctionner.
  update public.organization_invitations
  set status = 'revoked', revoked_at = now()
  where organization_id = p_organization_id
    and email = v_email
    and status in ('pending', 'sent');

  insert into public.organization_invitations
    (organization_id, email, role, invited_by_user_id, expires_at)
  values
    (p_organization_id, v_email, p_role, (select auth.uid()), now() + interval '7 days')
  returning id into v_invitation_id;

  -- §22.2 : l'envoi part dans la transaction qui a créé l'invitation.
  insert into private.outbox_events
    (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'email.organization_invitation',
    'organization_invitation',
    v_invitation_id,
    jsonb_build_object('invitationId', v_invitation_id),
    'email.organization_invitation:' || v_invitation_id
  );

  perform private.record_audit(
    'organization_member.invite',
    'organization_invitations',
    v_invitation_id,
    jsonb_build_object('organizationId', p_organization_id, 'role', p_role)
  );

  return v_invitation_id;
end;
$$;

create or replace function public.org_revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_organization_id uuid;
  v_status public.invitation_status;
begin
  select i.organization_id, i.status into v_organization_id, v_status
  from public.organization_invitations i
  where i.id = p_invitation_id
  for update;

  -- La garde passe avant le « introuvable » : un tiers n'apprend pas qu'un
  -- identifiant existe.
  if not found or not private.can_manage_org_team(v_organization_id) then
    perform private.assert_can_manage_org_team(coalesce(v_organization_id, p_invitation_id), 'org_revoke_invitation');
    raise exception 'invitation introuvable' using errcode = 'P0002';
  end if;

  if v_status not in ('pending', 'sent') then
    raise exception 'invitation deja close (%)', v_status using errcode = '55000';
  end if;

  update public.organization_invitations
  set status = 'revoked', revoked_at = now()
  where id = p_invitation_id;

  perform private.record_audit(
    'organization_member.revoke_invitation',
    'organization_invitations',
    p_invitation_id,
    jsonb_build_object('organizationId', v_organization_id, 'statusFrom', v_status)
  );
end;
$$;

-- ============================================================
-- 5. Rôles et retrait
-- ============================================================

/*
 * Verrouille les owners de l'organisation et rend leur nombre. Appelé avant
 * toute opération qui pourrait en retirer un.
 */
create or replace function private.lock_org_owners(p_organization_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform 1 from public.organization_members
  where organization_id = p_organization_id and role = 'owner'
  for update;

  select count(*) into v_count from public.organization_members
  where organization_id = p_organization_id and role = 'owner';

  return v_count;
end;
$$;

revoke all on function private.lock_org_owners(uuid) from public, anon, authenticated;

create or replace function public.org_change_member_role(
  p_organization_id uuid,
  p_user_id uuid,
  p_role public.organization_member_role
)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_owners integer;
  v_current public.organization_member_role;
begin
  perform private.assert_can_manage_org_team(p_organization_id, 'org_change_member_role');

  v_owners := private.lock_org_owners(p_organization_id);

  select om.role into v_current
  from public.organization_members om
  where om.organization_id = p_organization_id and om.user_id = p_user_id
  for update;

  if not found then
    raise exception 'membre introuvable' using errcode = 'P0002';
  end if;

  if v_current = p_role then
    return false;
  end if;

  if v_current = 'owner' and v_owners <= 1 then
    raise exception 'dernier proprietaire de l''organisation' using errcode = '55000';
  end if;

  update public.organization_members
  set role = p_role
  where organization_id = p_organization_id and user_id = p_user_id;

  perform private.record_audit(
    'organization_member.change_role',
    'organization_members',
    p_user_id,
    jsonb_build_object('organizationId', p_organization_id, 'roleFrom', v_current, 'roleTo', p_role)
  );

  return true;
end;
$$;

create or replace function public.org_remove_member(p_organization_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_owners integer;
  v_current public.organization_member_role;
begin
  perform private.assert_can_manage_org_team(p_organization_id, 'org_remove_member');

  v_owners := private.lock_org_owners(p_organization_id);

  select om.role into v_current
  from public.organization_members om
  where om.organization_id = p_organization_id and om.user_id = p_user_id
  for update;

  if not found then
    raise exception 'membre introuvable' using errcode = 'P0002';
  end if;

  if v_current = 'owner' and v_owners <= 1 then
    raise exception 'dernier proprietaire de l''organisation' using errcode = '55000';
  end if;

  -- §114 : l'accès cesse ici, à la prochaine requête. Les objets créés par le
  -- membre restent à l'organisation (§82) : rien ne les rattache à sa personne.
  delete from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id;

  perform private.record_audit(
    'organization_member.remove',
    'organization_members',
    p_user_id,
    jsonb_build_object('organizationId', p_organization_id, 'role', v_current)
  );
end;
$$;

-- ============================================================
-- 6. Le lien d'invitation
-- ============================================================

/*
 * Aperçu avant connexion — §115, « limitation des données avant
 * authentification » : le nom de l'organisation, le rôle et l'état du lien.
 * Ni l'adresse invitée, ni l'équipe.
 *
 * `state` : `valid`, `expired`, `closed` (révoquée ou déjà utilisée) ou
 * `unknown`. Le jeton fait 256 bits : distinguer `unknown` n'aide pas à le
 * deviner.
 */
create or replace function public.preview_organization_invitation(p_token_hash text)
returns table (
  state text,
  organization_name text,
  role public.organization_member_role
)
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.organization_invitations%rowtype;
begin
  select * into v_invitation
  from public.organization_invitations i
  where i.token_hash = p_token_hash;

  if not found then
    return query select 'unknown'::text, null::text, null::public.organization_member_role;
    return;
  end if;

  return query
  select
    case
      when v_invitation.status not in ('pending', 'sent') then 'closed'
      when v_invitation.expires_at <= now() then 'expired'
      else 'valid'
    end,
    o.name,
    v_invitation.role
  from public.organizations o
  where o.id = v_invitation.organization_id;
end;
$$;

create or replace function public.accept_organization_invitation(p_token_hash text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.organization_invitations%rowtype;
  v_user_email extensions.citext;
begin
  if (select auth.uid()) is null then
    raise exception 'connexion requise' using errcode = '42501';
  end if;

  -- §118 : une seule activation, même sous deux requêtes simultanées.
  select * into v_invitation
  from public.organization_invitations i
  where i.token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'invitation introuvable' using errcode = 'P0002';
  end if;

  if v_invitation.status not in ('pending', 'sent') then
    raise exception 'invitation close (%)', v_invitation.status using errcode = '55000';
  end if;

  if v_invitation.expires_at <= now() then
    update public.organization_invitations set status = 'expired' where id = v_invitation.id;
    raise exception 'invitation expiree' using errcode = '55000';
  end if;

  -- §117 : le lien transféré ne suffit pas. Le refus ne cite pas l'adresse
  -- attendue.
  select u.email into v_user_email from public.users u where u.id = (select auth.uid());

  if v_user_email is distinct from v_invitation.email then
    raise exception 'invitation destinee a une autre adresse' using errcode = '42501';
  end if;

  -- Déjà membre — ajouté entre-temps par un autre chemin : le rôle en place
  -- est conservé, l'invitation est consommée.
  insert into public.organization_members (organization_id, user_id, role)
  values (v_invitation.organization_id, (select auth.uid()), v_invitation.role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invitations
  set status = 'activated', activated_at = now(), accepted_by_user_id = (select auth.uid())
  where id = v_invitation.id;

  perform private.record_audit(
    'organization_member.join',
    'organization_invitations',
    v_invitation.id,
    jsonb_build_object('organizationId', v_invitation.organization_id, 'role', v_invitation.role)
  );

  return v_invitation.organization_id;
end;
$$;

-- ============================================================
-- 7. Envoi — worker uniquement
-- ============================================================

/*
 * Le worker réclame l'envoi en apportant le hash du jeton qu'il vient de
 * tirer. Rend `sendable = false` pour une invitation déjà envoyée, close ou
 * expirée : le message de file a alors rempli son office.
 *
 * Le destinataire et l'organisation sont relus ici, au moment de l'envoi, et
 * nulle part recopiés.
 */
create or replace function public.worker_claim_organization_invitation(
  p_invitation_id uuid,
  p_token_hash text
)
returns table (
  sendable boolean,
  email text,
  role public.organization_member_role,
  organization_name text,
  inviter_name text,
  expires_at timestamptz,
  attempt integer
)
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.organization_invitations%rowtype;
begin
  select * into v_invitation
  from public.organization_invitations i
  where i.id = p_invitation_id
  for update;

  if not found or v_invitation.status <> 'pending' then
    return query select false, null::text, null::public.organization_member_role,
      null::text, null::text, null::timestamptz, 0;
    return;
  end if;

  if v_invitation.expires_at <= now() then
    update public.organization_invitations set status = 'expired' where id = p_invitation_id;
    return query select false, null::text, null::public.organization_member_role,
      null::text, null::text, null::timestamptz, 0;
    return;
  end if;

  update public.organization_invitations
  set token_hash = p_token_hash, send_attempts = send_attempts + 1
  where id = p_invitation_id;

  return query
  select
    true,
    v_invitation.email::text,
    v_invitation.role,
    o.name,
    nullif(trim(concat_ws(' ', u.first_name, u.last_name)), ''),
    v_invitation.expires_at,
    v_invitation.send_attempts + 1
  from public.organizations o
  left join public.users u on u.id = v_invitation.invited_by_user_id
  where o.id = v_invitation.organization_id;
end;
$$;

create or replace function public.worker_complete_organization_invitation(p_invitation_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.organization_invitations
  set status = 'sent', sent_at = now(), last_send_error = null
  where id = p_invitation_id and status = 'pending';
$$;

/* Rend le nombre de tentatives faites : le worker abandonne au-delà de 5. */
create or replace function public.worker_fail_organization_invitation(
  p_invitation_id uuid,
  p_error text
)
returns integer language sql security definer set search_path = '' as $$
  update public.organization_invitations
  set last_send_error = left(p_error, 500)
  where id = p_invitation_id
  returning send_attempts;
$$;

-- ============================================================
-- 8. Droits d'exécution
-- ============================================================

revoke all on function public.org_list_members(uuid) from public, anon;
revoke all on function public.org_list_invitations(uuid) from public, anon;
revoke all on function public.org_invite_member(uuid, text, public.organization_member_role) from public, anon;
revoke all on function public.org_revoke_invitation(uuid) from public, anon;
revoke all on function public.org_change_member_role(uuid, uuid, public.organization_member_role) from public, anon;
revoke all on function public.org_remove_member(uuid, uuid) from public, anon;
revoke all on function public.preview_organization_invitation(text) from public;
revoke all on function public.accept_organization_invitation(text) from public, anon;

grant execute on function public.org_list_members(uuid) to authenticated;
grant execute on function public.org_list_invitations(uuid) to authenticated;
grant execute on function public.org_invite_member(uuid, text, public.organization_member_role) to authenticated;
grant execute on function public.org_revoke_invitation(uuid) to authenticated;
grant execute on function public.org_change_member_role(uuid, uuid, public.organization_member_role) to authenticated;
grant execute on function public.org_remove_member(uuid, uuid) to authenticated;
-- L'aperçu précède la connexion : la page d'invitation l'appelle en anonyme.
grant execute on function public.preview_organization_invitation(text) to anon, authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;

revoke all on function public.worker_claim_organization_invitation(uuid, text) from public, anon, authenticated;
revoke all on function public.worker_complete_organization_invitation(uuid) from public, anon, authenticated;
revoke all on function public.worker_fail_organization_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.worker_claim_organization_invitation(uuid, text) to service_role;
grant execute on function public.worker_complete_organization_invitation(uuid) to service_role;
grant execute on function public.worker_fail_organization_invitation(uuid, text) to service_role;

commit;
