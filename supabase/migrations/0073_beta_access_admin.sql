-- PLUKA V1 — Accès bêta : l'accorder, le retirer, le réserver
-- File target: supabase/migrations/0073_beta_access_admin.sql
-- Référence : docs/04_ENTITLEMENTS.md §14, §61, §125 (grantBetaAccess)
--
-- POURQUOI
--
-- `beta_access_grants` existe depuis 0003 et le résolveur sait le lire, mais
-- rien n'écrivait la table : aucun testeur ne pouvait recevoir l'accès bêta, et
-- la page d'offre promettait un accès que personne n'avait.
--
-- CE QUE LA MIGRATION LIVRE
--
-- - accorder un accès bêta global à une ou plusieurs adresses, jusqu'à une
--   date de fin obligatoire (§14), avec une raison ;
-- - une adresse sans compte est réservée : l'accès s'ouvre à la création du
--   compte. Un vrai test commence avant que les testeurs se soient inscrits ;
-- - accorder à nouveau prolonge l'accès en cours au lieu d'en créer un second
--   (index unique de 0003) ;
-- - retirer, avec une raison ;
-- - à la date de fin, rien à faire : le résolveur ne lit plus l'accès, et les
--   droits reviennent au niveau commercial normal (§14).
--
-- Global seulement : un testeur a tout, sur toutes ses courses, comme un
-- PLUKA+ temporaire (§61). La source reste distincte (`beta`) pour analyser les
-- droits après la phase de test.
--
-- QUI
--
-- Un `pluka_admin` — un droit commercial ne se pose pas depuis le support.
-- Chaque geste écrit le journal, sans adresse (§92).

begin;

-- ============================================================
-- 1. Les réservations
-- ============================================================

create table private.beta_access_reservations (
  email extensions.citext primary key,
  ends_at timestamptz not null,
  reason text,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

revoke all on private.beta_access_reservations from public, anon, authenticated;

comment on table private.beta_access_reservations is
  'Accès bêta réservés à une adresse sans compte, ouverts à la création du compte (0073).';

/* Accorde, ou prolonge, l'accès bêta global d'un compte. Rend `granted` ou `extended`. */
create function private.grant_global_beta(
  p_user_id uuid,
  p_ends_at timestamptz,
  p_reason text,
  p_by uuid
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_existing uuid;
begin
  select id into v_existing
  from public.beta_access_grants
  where user_id = p_user_id and scope_type = 'global' and status = 'active'
  for update;

  if v_existing is not null then
    update public.beta_access_grants
    set ends_at = p_ends_at, reason = coalesce(p_reason, reason)
    where id = v_existing;
    return 'extended';
  end if;

  insert into public.beta_access_grants
    (user_id, scope_type, status, ends_at, reason, created_by_user_id)
  values (p_user_id, 'global', 'active', p_ends_at, p_reason, p_by);
  return 'granted';
end;
$$;

-- À la création d'un compte, une réservation devient un accès.
create function private.open_reserved_beta_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_reservation private.beta_access_reservations%rowtype;
begin
  select * into v_reservation
  from private.beta_access_reservations
  where email = new.email
  for update;

  if not found then
    return null;
  end if;

  if v_reservation.ends_at > now() then
    perform private.grant_global_beta(
      new.id, v_reservation.ends_at, v_reservation.reason, v_reservation.created_by_user_id
    );
  end if;

  delete from private.beta_access_reservations where email = new.email;
  return null;
end;
$$;

create trigger trg_users_open_reserved_beta
  after insert on public.users
  for each row execute function private.open_reserved_beta_access();

-- ============================================================
-- 2. Accorder
-- ============================================================

/*
 * Rend `{ granted, extended, reserved, invalid }` : les comptes qui reçoivent
 * l'accès, ceux dont l'accès est prolongé, les adresses réservées faute de
 * compte, et le nombre d'entrées illisibles.
 */
create function public.admin_grant_beta_access(
  p_emails text[],
  p_ends_at timestamptz,
  p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_raw text;
  v_email extensions.citext;
  v_user uuid;
  v_granted integer := 0;
  v_extended integer := 0;
  v_reserved integer := 0;
  v_invalid integer := 0;
  v_reason text := nullif(trim(p_reason), '');
begin
  perform private.assert_pluka_admin('admin_grant_beta_access');

  if p_ends_at is null or p_ends_at <= now() then
    raise exception 'la date de fin doit être dans le futur' using errcode = '22023';
  end if;

  foreach v_raw in array coalesce(p_emails, array[]::text[]) loop
    v_email := lower(trim(v_raw));

    if v_email is null or v_email::text = '' then
      continue;
    end if;

    if v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_invalid := v_invalid + 1;
      continue;
    end if;

    select u.id into v_user from public.users u where u.email = v_email;

    if v_user is null then
      insert into private.beta_access_reservations (email, ends_at, reason, created_by_user_id)
      values (v_email, p_ends_at, v_reason, (select auth.uid()))
      on conflict (email) do update
        set ends_at = excluded.ends_at, reason = coalesce(excluded.reason, private.beta_access_reservations.reason);
      v_reserved := v_reserved + 1;
    elsif private.grant_global_beta(v_user, p_ends_at, v_reason, (select auth.uid())) = 'granted' then
      v_granted := v_granted + 1;
    else
      v_extended := v_extended + 1;
    end if;
  end loop;

  perform private.record_audit(
    'beta_access.grant',
    'beta_access_grants',
    null,
    jsonb_build_object(
      'granted', v_granted, 'extended', v_extended, 'reserved', v_reserved,
      'invalid', v_invalid, 'endsAt', p_ends_at
    )
  );

  return jsonb_build_object(
    'granted', v_granted, 'extended', v_extended, 'reserved', v_reserved, 'invalid', v_invalid
  );
end;
$$;

-- ============================================================
-- 3. Retirer
-- ============================================================

create function public.admin_revoke_beta_access(p_grant_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.entitlement_status;
begin
  perform private.assert_pluka_admin('admin_revoke_beta_access');

  select status into v_status from public.beta_access_grants where id = p_grant_id for update;

  if not found then
    raise exception 'accès bêta introuvable' using errcode = 'P0002';
  end if;

  if v_status <> 'active' then
    raise exception 'accès bêta déjà clos (%)', v_status using errcode = '55000';
  end if;

  update public.beta_access_grants
  set status = 'revoked', revoked_at = now(), revoke_reason = nullif(trim(p_reason), '')
  where id = p_grant_id;

  perform private.record_audit('beta_access.revoke', 'beta_access_grants', p_grant_id, null);
end;
$$;

/* Retirer une réservation avant que le compte existe. */
create function public.admin_cancel_beta_reservation(p_email text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_cancel_beta_reservation');

  delete from private.beta_access_reservations where email = lower(trim(p_email));

  if not found then
    raise exception 'réservation introuvable' using errcode = 'P0002';
  end if;

  perform private.record_audit('beta_access.cancel_reservation', 'beta_access_grants', null, null);
end;
$$;

-- ============================================================
-- 4. Lire
-- ============================================================

/*
 * Les accès bêta en cours et à venir, puis les réservations. Un accès dont la
 * date est passée est rendu `expired` à la lecture, sans écriture.
 */
create function public.admin_list_beta_access()
returns table (
  grant_id uuid,
  email text,
  first_name text,
  last_name text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  reason text,
  reserved boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_list_beta_access');

  return query
  select
    g.id,
    u.email::text,
    u.first_name,
    u.last_name,
    case
      when g.status = 'active' and g.ends_at is not null and g.ends_at <= now() then 'expired'
      else g.status::text
    end,
    g.starts_at,
    g.ends_at,
    g.reason,
    false
  from public.beta_access_grants g
  join public.users u on u.id = g.user_id
  where g.scope_type = 'global'
  union all
  select null, r.email::text, null, null, 'reserved', r.created_at, r.ends_at, r.reason, true
  from private.beta_access_reservations r
  order by 9 desc, 7 desc nulls last;
end;
$$;

-- ============================================================
-- 5. Droits d'exécution
-- ============================================================

revoke all on function private.grant_global_beta(uuid, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function private.open_reserved_beta_access() from public, anon, authenticated;

revoke all on function public.admin_grant_beta_access(text[], timestamptz, text) from public, anon;
revoke all on function public.admin_revoke_beta_access(uuid, text) from public, anon;
revoke all on function public.admin_cancel_beta_reservation(text) from public, anon;
revoke all on function public.admin_list_beta_access() from public, anon;
grant execute on function public.admin_grant_beta_access(text[], timestamptz, text) to authenticated;
grant execute on function public.admin_revoke_beta_access(uuid, text) to authenticated;
grant execute on function public.admin_cancel_beta_reservation(text) to authenticated;
grant execute on function public.admin_list_beta_access() to authenticated;

commit;
