-- PLUKA V1 — Comptes inactifs depuis 3 ans
-- File target: supabase/migrations/0079_inactive_accounts.sql
-- Référence : pluka.run/confidentialite (« supprimés après 3 ans sans
--             connexion ») · docs/03_PRIVACY_RLS.md §93, §94 · 0078
--
-- LE PRINCIPE
--
-- Pas d'effacement silencieux (AGENTS §102). 30 jours avant les 3 ans sans
-- connexion, la purge de la nuit ouvre une demande de suppression et un e-mail
-- prévient le coureur. La suite est celle de 0078 : se reconnecter annule, et
-- sans retour le compte est effacé.
--
-- L'échéance court depuis l'envoi de l'e-mail, pas depuis la demande : un
-- fournisseur en panne retarde l'effacement au lieu de le rendre muet. Une
-- demande pour inactivité dont l'e-mail n'est jamais parti n'est jamais
-- exécutée ; elle reste visible, en échec.
--
-- La dernière activité est la dernière connexion, ou la création du compte
-- pour qui ne s'est jamais connecté.

begin;

alter table private.account_deletion_requests
  add column reason text not null default 'user'
    constraint account_deletion_reason check (reason in ('user', 'inactivity')),
  add column notice_status text not null default 'none'
    constraint account_deletion_notice_status check (notice_status in ('none', 'pending', 'sent', 'failed')),
  add column notice_attempts integer not null default 0
    constraint account_deletion_notice_attempts check (notice_attempts >= 0),
  add column notice_error text,
  add column notice_sent_at timestamptz,
  add constraint account_deletion_inactivity_notice
    check (reason = 'user' or notice_status <> 'none');

-- ============================================================
-- 1. L'envoi de l'avertissement, par le worker
-- ============================================================

create or replace function public.worker_claim_account_notice(p_user uuid)
returns table (
  sendable boolean,
  recipient_email text,
  first_name text,
  purge_after timestamptz,
  attempt integer
)
language plpgsql security definer set search_path = '' as $$
declare
  v_request private.account_deletion_requests%rowtype;
begin
  select * into v_request from private.account_deletion_requests r
  where r.user_id = p_user for update;

  -- Demande annulée entre-temps, ou avertissement déjà parti : rien à faire.
  if not found or v_request.reason <> 'inactivity' or v_request.notice_status <> 'pending' then
    return query select false, null::text, null::text, null::timestamptz, 0;
    return;
  end if;

  update private.account_deletion_requests r
  set notice_attempts = r.notice_attempts + 1
  where r.user_id = p_user;

  return query select
    u.email is not null,
    u.email::text,
    u.first_name,
    -- L'e-mail annonce la date que l'envoi fixera (voir complete).
    greatest(v_request.purge_after, now() + interval '30 days'),
    v_request.notice_attempts + 1
  from public.users u where u.id = p_user;
end;
$$;

create or replace function public.worker_complete_account_notice(p_user uuid)
returns void
language sql security definer set search_path = '' as $$
  update private.account_deletion_requests r
  set notice_status = 'sent',
      notice_sent_at = now(),
      notice_error = null,
      purge_after = greatest(r.purge_after, now() + interval '30 days')
  where r.user_id = p_user and r.reason = 'inactivity' and r.notice_status = 'pending';
$$;

create or replace function public.worker_fail_account_notice(
  p_user uuid, p_error text, p_abandon boolean
)
returns void
language sql security definer set search_path = '' as $$
  update private.account_deletion_requests r
  set notice_error = left(p_error, 500),
      notice_status = case when p_abandon then 'failed' else 'pending' end
  where r.user_id = p_user and r.reason = 'inactivity' and r.notice_status = 'pending';
$$;

-- ============================================================
-- 2. La purge de la nuit prévient, puis efface
-- ============================================================

create or replace function private.purge_expired_data(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cutoff date := (p_now - interval '12 months')::date;
  v_rows integer;
  v_demographics integer;
  v_signals integer;
  v_audit integer;
  v_editions uuid[];
  v_request record;
  v_inactive record;
  v_deleted integer := 0;
  v_cancelled integer := 0;
  v_blocked integer := 0;
  v_awaiting integer := 0;
  v_notices integer := 0;
begin
  -- Comptes d'abord : une participation détachée rejoint la liste de
  -- l'organisation, et suit la purge des listes juste après.
  for v_request in
    select r.user_id, r.requested_at, r.reason, r.notice_status, au.last_sign_in_at
    from private.account_deletion_requests r
    left join auth.users au on au.id = r.user_id
    where r.purge_after <= p_now
  loop
    if v_request.last_sign_in_at is not null
       and v_request.last_sign_in_at > v_request.requested_at then
      -- Revenu entre-temps : la demande tombe.
      delete from private.account_deletion_requests where user_id = v_request.user_id;
      v_cancelled := v_cancelled + 1;
    elsif v_request.reason = 'inactivity' and v_request.notice_status <> 'sent' then
      -- Jamais prévenu : on n'efface pas.
      v_awaiting := v_awaiting + 1;
    elsif private.account_deletion_blocker(v_request.user_id) is not null then
      -- Devenu non supprimable (une organisation, une publication) : on garde
      -- la demande, le support tranche.
      v_blocked := v_blocked + 1;
    else
      perform private.delete_user_account(v_request.user_id);
      v_deleted := v_deleted + 1;
    end if;
  end loop;

  -- Bientôt 3 ans sans connexion : prévenir, 30 jours avant.
  for v_inactive in
    select u.id
    from public.users u
    join auth.users au on au.id = u.id
    where coalesce(au.last_sign_in_at, au.created_at)
            < p_now - interval '3 years' + interval '30 days'
      and not exists (
        select 1 from private.account_deletion_requests r where r.user_id = u.id
      )
      and private.account_deletion_blocker(u.id) is null
  loop
    insert into private.account_deletion_requests
      (user_id, requested_at, purge_after, reason, notice_status)
    values (v_inactive.id, p_now, p_now + interval '30 days', 'inactivity', 'pending');

    insert into private.outbox_events
      (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
    values (
      'email.account_inactivity',
      'user',
      v_inactive.id,
      jsonb_build_object('accountNoticeUserId', v_inactive.id),
      'email.account_inactivity:' || v_inactive.id::text || ':' || p_now::date::text
    )
    on conflict (idempotency_key) do nothing;

    v_notices := v_notices + 1;
  end loop;

  v_editions := array(
    select ed.id from public.editions ed
    where coalesce(ed.end_date, ed.start_date) < v_cutoff
  );

  delete from private.participant_demographics d
  using public.participant_races pr, public.races r
  where d.participant_race_id = pr.id
    and r.id = pr.race_id
    and r.edition_id = any(v_editions);
  get diagnostics v_demographics = row_count;

  delete from private.participant_performance_signals s
  using public.participant_races pr, public.races r
  where s.participant_race_id = pr.id
    and r.id = pr.race_id
    and r.edition_id = any(v_editions);
  get diagnostics v_signals = row_count;

  delete from public.participant_races pr
  using public.races r
  where r.id = pr.race_id
    and r.edition_id = any(v_editions)
    and pr.user_id is null;
  get diagnostics v_rows = row_count;

  delete from private.audit_logs where created_at < p_now - interval '1 year';
  get diagnostics v_audit = row_count;

  return jsonb_build_object(
    'accountsDeleted', v_deleted,
    'deletionsCancelled', v_cancelled,
    'deletionsBlocked', v_blocked,
    'deletionsAwaitingNotice', v_awaiting,
    'inactivityNotices', v_notices,
    'participantRows', v_rows,
    'demographics', v_demographics,
    'performanceSignals', v_signals,
    'auditLogs', v_audit
  );
end;
$$;

-- ============================================================
-- 3. Droits, fonction par fonction (0071)
-- ============================================================

revoke all on function private.purge_expired_data(timestamptz) from public, anon, authenticated;
revoke all on function public.worker_claim_account_notice(uuid) from public, anon, authenticated;
revoke all on function public.worker_complete_account_notice(uuid) from public, anon, authenticated;
revoke all on function public.worker_fail_account_notice(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.worker_claim_account_notice(uuid) to service_role;
grant execute on function public.worker_complete_account_notice(uuid) to service_role;
grant execute on function public.worker_fail_account_notice(uuid, text, boolean) to service_role;

commit;
