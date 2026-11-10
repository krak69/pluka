-- PLUKA V1 — Prévenir le coureur dont l'heure de départ change
-- File target: supabase/migrations/0082_start_changes.sql
-- Référence : 0081 · docs/engines/PLAN_ENGINE.md §5.2 · 00_PRODUCT_SPEC §46 ·
--             AGENTS §15, §102
--
-- DÉCISIONS DU 2026-11-10
--
-- - Une vague se supprime. Ses coureurs repartent à l'heure de l'épreuve ;
--   son information officielle est retirée, son historique gardé.
-- - Changer quelqu'un de vague, à la main ou par un fichier, le prévient : un
--   e-mail, et une alerte dans son compte.
--
-- UN SEUL MÉCANISME
--
-- Tout ce qui déplace le départ d'un coureur à cause d'une vague passe par
-- `participant_start_changes` : une vague déclarée qui le rattache, l'heure
-- de sa vague qui change, sa vague supprimée, un changement de vague. Une
-- ligne dit l'avant et l'après (vague, heure) ; elle porte l'e-mail et
-- l'alerte, que le coureur referme.
--
-- Les gestes sur une vague n'enfilent donc plus l'analyse générique (0081
-- l'enfilait) : elle préviendrait une seconde fois, et sans l'avant/après.
-- L'événement de changement reste écrit, pour l'historique officiel.
--
-- QUI EST PRÉVENU
--
-- Un coureur activé, inscrit (`active`), sans départ personnel : pour lui
-- seul la vague décide de l'heure (PLAN_ENGINE §5.2). Une ligne importée
-- jamais activée n'a personne à prévenir. Comme l'annulation (0067), l'e-mail
-- part même si le coureur a coupé les notifications : c'est son heure de
-- départ. L'organisation ne lit jamais ces lignes (AGENTS §19).

begin;

-- ============================================================
-- 1. Les changements de départ
-- ============================================================

create table public.participant_start_changes (
  id uuid primary key default gen_random_uuid(),
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  previous_wave_name text,
  new_wave_name text,
  previous_start_at timestamptz not null,
  new_start_at timestamptz not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  notice_status text not null default 'pending'
    constraint start_change_notice_status check (notice_status in ('pending', 'sent', 'failed')),
  notice_attempts integer not null default 0 constraint start_change_attempts check (notice_attempts >= 0),
  notice_error text,
  notice_sent_at timestamptz
);

create index ix_start_changes_unseen
  on public.participant_start_changes (participant_race_id, created_at desc)
  where seen_at is null;

alter table public.participant_start_changes enable row level security;

-- Le coureur lit les siens ; personne d'autre, organisation comprise.
create policy participant_start_changes__select__owner
  on public.participant_start_changes for select to authenticated
  using (exists (
    select 1 from public.participant_races pr
    where pr.id = participant_start_changes.participant_race_id
      and pr.user_id = (select auth.uid())
  ));

revoke all on public.participant_start_changes from anon, authenticated;
grant select (id, participant_race_id, previous_wave_name, new_wave_name,
              previous_start_at, new_start_at, created_at, seen_at)
  on public.participant_start_changes to authenticated;

comment on table public.participant_start_changes is
  'Départs déplacés par une vague (0082) : avant/après, e-mail et alerte du coureur. Jamais lu par l''organisation.';

-- Une ligne, et son e-mail dans la même transaction.
create or replace function private.record_start_change(
  p_participant_race_id uuid,
  p_previous_wave_name text,
  p_new_wave_name text,
  p_previous_start_at timestamptz,
  p_new_start_at timestamptz
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.participant_races pr
    where pr.id = p_participant_race_id
      and pr.user_id is not null
      and pr.status = 'active'
      and pr.personal_start_datetime is null
  ) then
    return;
  end if;

  insert into public.participant_start_changes
    (participant_race_id, previous_wave_name, new_wave_name, previous_start_at, new_start_at)
  values (p_participant_race_id, p_previous_wave_name, p_new_wave_name,
          p_previous_start_at, p_new_start_at)
  returning id into v_id;

  insert into private.outbox_events
    (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'email.start_changed', 'participant_start_change', v_id,
    jsonb_build_object('startChangeId', v_id),
    'email.start_changed:' || v_id::text
  );
end;
$$;

-- Un coureur change de vague : à la main, par un fichier, par une vague
-- déclarée qui le rattache, ou supprimée qui le détache.
create or replace function private.notify_start_wave_change()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_race_start timestamptz;
  v_old record;
  v_new record;
begin
  select r.start_datetime into v_race_start from public.races r where r.id = new.race_id;
  select w.name, w.start_datetime into v_old from public.race_start_waves w where w.id = old.start_wave_id;
  select w.name, w.start_datetime into v_new from public.race_start_waves w where w.id = new.start_wave_id;

  perform private.record_start_change(
    new.id,
    v_old.name, v_new.name,
    coalesce(v_old.start_datetime, v_race_start),
    coalesce(v_new.start_datetime, v_race_start)
  );
  return null;
end;
$$;

create trigger trg_participant_races_start_wave_change
  after update of start_wave_id on public.participant_races
  for each row
  when (old.start_wave_id is distinct from new.start_wave_id)
  execute function private.notify_start_wave_change();

-- L'événement d'une vague, pour l'historique officiel, sans analyse générique.
create or replace function private.record_wave_change_event(
  p_race_id uuid, p_fact_id uuid, p_kind text,
  p_from_version_id uuid, p_to_version_id uuid, p_wave_name text,
  p_actor uuid, p_organization_id uuid
)
returns void
language sql security definer set search_path = '' as $$
  insert into public.race_change_events
    (race_id, fact_id, from_version_id, to_version_id, severity, title,
     published_by_user_id, published_by_organization_id, change_kind)
  values (
    p_race_id, p_fact_id, p_from_version_id, p_to_version_id, 'critical',
    case when p_kind = 'retired' then 'Vague ' || p_wave_name || ' : supprimée'
         else 'Vague ' || p_wave_name || ' : heure de départ' end,
    p_actor, p_organization_id, p_kind
  );
$$;

-- ============================================================
-- 2. Supprimer une vague
-- ============================================================

create or replace function public.org_delete_start_wave(p_wave_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_wave record;
  v_who record;
  v_current uuid;
begin
  select w.id, w.race_id, w.name, w.fact_id into v_wave
  from public.race_start_waves w where w.id = p_wave_id for update;
  if v_wave.id is null then
    raise exception 'vague introuvable' using errcode = 'P0002';
  end if;

  perform private.assert_wave_authority(v_wave.race_id);
  select * into v_who from private.fact_gesture_authority(v_wave.race_id);

  -- Ses coureurs repartent à l'heure de l'épreuve, et en sont prévenus
  -- (déclencheur ci-dessus) tant que la vague existe encore.
  update public.participant_races set start_wave_id = null where start_wave_id = p_wave_id;

  if v_wave.fact_id is not null then
    select f.current_version_id into v_current from public.race_facts f where f.id = v_wave.fact_id;

    perform set_config('pluka.wave_gesture', 'on', true);
    update public.race_facts set archived_at = now()
    where id = v_wave.fact_id and archived_at is null;
    perform set_config('pluka.wave_gesture', '', true);

    perform private.record_wave_change_event(
      v_wave.race_id, v_wave.fact_id, 'retired', v_current, null, v_wave.name,
      v_who.actor_user_id,
      case when v_who.authority = 'organization_member' then v_who.organization_id end
    );

    insert into private.fact_publication_acts
      (race_id, fact_id, fact_version_id, action, actor_user_id, authority, actor_role, note)
    values (v_wave.race_id, v_wave.fact_id, v_current, 'retire', v_who.actor_user_id,
            v_who.authority, v_who.actor_role, 'Vague supprimée');
  end if;

  delete from public.race_start_waves where id = p_wave_id;

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values (v_who.actor_user_id, v_who.organization_id, 'wave.delete', 'race_start_waves', p_wave_id,
          jsonb_build_object('factId', v_wave.fact_id));
end;
$$;

-- ============================================================
-- 3. Le coureur referme l'alerte
-- ============================================================

create or replace function public.acknowledge_start_changes(p_participant_race_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from public.participant_races pr
    where pr.id = p_participant_race_id and pr.user_id = (select auth.uid())
  ) then
    raise exception 'participation introuvable' using errcode = 'P0002';
  end if;

  update public.participant_start_changes
  set seen_at = now()
  where participant_race_id = p_participant_race_id and seen_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ============================================================
-- 4. L'e-mail, par le worker
-- ============================================================

create or replace function public.worker_claim_start_change(p_change_id uuid)
returns table (
  sendable boolean,
  recipient_email text,
  first_name text,
  event_name text,
  race_name text,
  timezone text,
  participant_race_id uuid,
  previous_wave_name text,
  new_wave_name text,
  previous_start_at timestamptz,
  new_start_at timestamptz,
  has_plan boolean,
  attempt integer
)
language plpgsql security definer set search_path = '' as $$
declare
  v_change public.participant_start_changes%rowtype;
begin
  select * into v_change from public.participant_start_changes c
  where c.id = p_change_id for update;

  if not found or v_change.notice_status <> 'pending' then
    return query select false, null::text, null::text, null::text, null::text, null::text,
      null::uuid, null::text, null::text, null::timestamptz, null::timestamptz, false, 0;
    return;
  end if;

  update public.participant_start_changes c
  set notice_attempts = c.notice_attempts + 1
  where c.id = p_change_id;

  return query
  select u.email is not null, u.email::text, u.first_name, e.name, r.name, r.timezone::text,
         pr.id, v_change.previous_wave_name, v_change.new_wave_name,
         v_change.previous_start_at, v_change.new_start_at,
         exists (select 1 from public.race_plans p
                 where p.participant_race_id = pr.id and p.status = 'active'),
         v_change.notice_attempts + 1
  from public.participant_races pr
  join public.users u on u.id = pr.user_id
  join public.races r on r.id = pr.race_id
  join public.editions ed on ed.id = r.edition_id
  join public.events e on e.id = ed.event_id
  where pr.id = v_change.participant_race_id;
end;
$$;

create or replace function public.worker_complete_start_change(p_change_id uuid)
returns void
language sql security definer set search_path = '' as $$
  update public.participant_start_changes
  set notice_status = 'sent', notice_sent_at = now(), notice_error = null
  where id = p_change_id and notice_status = 'pending';
$$;

create or replace function public.worker_fail_start_change(
  p_change_id uuid, p_error text, p_abandon boolean
)
returns void
language sql security definer set search_path = '' as $$
  update public.participant_start_changes
  set notice_error = left(p_error, 500),
      notice_status = case when p_abandon then 'failed' else 'pending' end
  where id = p_change_id and notice_status = 'pending';
$$;

-- ============================================================
-- 5. Déclarer et changer une vague (0081), sans analyse générique
-- ============================================================

create or replace function public.org_declare_start_wave(
  p_race_id uuid,
  p_name text,
  p_start_datetime timestamptz
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_race record;
  v_who record;
  v_source record;
  v_trust public.trust_level;
  v_wave_id uuid := gen_random_uuid();
  v_fact_key text;
  v_fact_id uuid;
  v_version_id uuid;
  v_text text;
begin
  select r.id, r.edition_id, r.timezone into v_race from public.races r where r.id = p_race_id;
  if v_race.id is null then
    raise exception 'épreuve introuvable' using errcode = 'P0002';
  end if;

  perform private.assert_wave_authority(p_race_id);
  select * into v_who from private.fact_gesture_authority(p_race_id);

  if v_name is null or char_length(v_name) > 120 then
    raise exception 'une vague porte un nom de 1 à 120 caractères' using errcode = '22023';
  end if;
  if p_start_datetime is null then
    raise exception 'une vague porte une heure de départ' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.race_start_waves w
    where w.race_id = p_race_id and lower(w.name) = lower(v_name)
  ) then
    raise exception 'cette vague existe déjà' using errcode = '23505';
  end if;

  -- L'organisation publie de l'officiel ; l'équipe PLUKA, du « Validée PLUKA ».
  v_trust := case when v_who.authority = 'organization_member' then 'official' else 'pluka_validated' end;
  v_fact_key := 'start/wave/' || v_wave_id::text;
  v_text := private.start_wave_text(v_name, p_start_datetime, v_race.timezone);

  select * into v_source from private.manual_source_of(
    v_race.edition_id, v_who.actor_user_id, v_who.organization_id,
    v_who.authority = 'organization_member'
  );

  insert into public.race_facts (race_id, category, fact_key)
  values (p_race_id, 'start', v_fact_key)
  returning id into v_fact_id;

  insert into public.race_fact_versions
    (fact_id, version_number, value_text, value_json, trust_level, workflow_status,
     created_by_user_id, published_by_user_id, validated_by_user_id,
     validated_by_organization_id, validated_at, published_at)
  values (
    v_fact_id, 1, v_text,
    jsonb_build_object('name', v_name, 'startAt', p_start_datetime, 'timezone', v_race.timezone),
    v_trust, 'published',
    v_who.actor_user_id, v_who.actor_user_id, v_who.actor_user_id,
    case when v_trust = 'official' then v_who.organization_id end,
    now(), now()
  )
  returning id into v_version_id;

  insert into public.fact_sources
    (fact_version_id, source_id, source_snapshot_id, excerpt, is_primary)
  values (v_version_id, v_source.manual_source_id, v_source.manual_snapshot_id, null, true);

  update public.race_facts set current_version_id = v_version_id where id = v_fact_id;

  -- Le déclencheur de 0061 rattache les inscrits qui ont déclaré ce nom.
  insert into public.race_start_waves (id, race_id, name, start_datetime, sort_order, fact_id)
  values (
    v_wave_id, p_race_id, v_name, p_start_datetime,
    (select coalesce(max(w.sort_order), 0) + 1 from public.race_start_waves w where w.race_id = p_race_id),
    v_fact_id
  );

  -- Les coureurs rattachés sont prévenus un par un (0082) ; l'événement reste
  -- pour l'historique, sans analyse générique.
  perform private.record_wave_change_event(
    p_race_id, v_fact_id, 'published', null, v_version_id, v_name, v_who.actor_user_id,
    case when v_who.authority = 'organization_member' then v_who.organization_id end
  );

  insert into private.fact_publication_acts
    (race_id, fact_id, fact_version_id, action, actor_user_id, authority, actor_role,
     trust_level, published_value)
  values (
    p_race_id, v_fact_id, v_version_id, 'publish', v_who.actor_user_id, v_who.authority,
    v_who.actor_role, v_trust,
    jsonb_build_object('valueText', v_text, 'name', v_name, 'startAt', p_start_datetime)
  );

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values (v_who.actor_user_id, v_who.organization_id, 'wave.declare', 'race_start_waves', v_wave_id,
          jsonb_build_object('factKey', v_fact_key));

  return v_wave_id;
end;
$$;


create or replace function public.org_update_start_wave(
  p_wave_id uuid,
  p_name text,
  p_start_datetime timestamptz
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_wave record;
  v_race record;
  v_who record;
  v_current public.race_fact_versions;
  v_trust public.trust_level;
  v_next integer;
  v_version_id uuid;
  v_text text;
begin
  select w.id, w.race_id, w.name, w.start_datetime, w.fact_id into v_wave
  from public.race_start_waves w where w.id = p_wave_id for update;
  if v_wave.id is null then
    raise exception 'vague introuvable' using errcode = 'P0002';
  end if;

  perform private.assert_wave_authority(v_wave.race_id);
  select * into v_who from private.fact_gesture_authority(v_wave.race_id);
  select r.timezone into v_race from public.races r where r.id = v_wave.race_id;

  if v_name is null or char_length(v_name) > 120 then
    raise exception 'une vague porte un nom de 1 à 120 caractères' using errcode = '22023';
  end if;
  if p_start_datetime is null then
    raise exception 'une vague porte une heure de départ' using errcode = '22023';
  end if;
  if v_name = v_wave.name and p_start_datetime = v_wave.start_datetime then
    raise exception 'aucune modification' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.race_start_waves w
    where w.race_id = v_wave.race_id and w.id <> p_wave_id and lower(w.name) = lower(v_name)
  ) then
    raise exception 'cette vague existe déjà' using errcode = '23505';
  end if;
  if v_wave.fact_id is null then
    raise exception 'vague sans information officielle' using errcode = '55000';
  end if;

  v_trust := case when v_who.authority = 'organization_member' then 'official' else 'pluka_validated' end;
  v_text := private.start_wave_text(v_name, p_start_datetime, v_race.timezone);

  select * into v_current from public.race_fact_versions v
  where v.id = (select f.current_version_id from public.race_facts f where f.id = v_wave.fact_id);

  select coalesce(max(v.version_number), 0) + 1 into v_next
  from public.race_fact_versions v where v.fact_id = v_wave.fact_id;

  perform set_config('pluka.wave_gesture', 'on', true);

  insert into public.race_fact_versions
    (fact_id, version_number, value_text, value_json, trust_level, workflow_status,
     supersedes_version_id, created_by_user_id, published_by_user_id, validated_by_user_id,
     validated_by_organization_id, validated_at, published_at)
  values (
    v_wave.fact_id, v_next, v_text,
    jsonb_build_object('name', v_name, 'startAt', p_start_datetime, 'timezone', v_race.timezone),
    v_trust, 'published', v_current.id,
    v_who.actor_user_id, v_who.actor_user_id, v_who.actor_user_id,
    case when v_trust = 'official' then v_who.organization_id end,
    now(), now()
  )
  returning id into v_version_id;

  perform set_config('pluka.wave_gesture', '', true);

  update public.race_fact_versions set workflow_status = 'superseded'
  where id = v_current.id and workflow_status = 'published';

  insert into public.fact_sources
    (fact_version_id, source_id, source_snapshot_id, page_start, page_end,
     section_label, excerpt, locator, is_primary)
  select v_version_id, fs.source_id, fs.source_snapshot_id, fs.page_start, fs.page_end,
         fs.section_label, fs.excerpt, fs.locator, fs.is_primary
  from public.fact_sources fs
  where fs.fact_version_id = v_current.id;

  update public.race_facts set current_version_id = v_version_id where id = v_wave.fact_id;

  -- Ses coureurs sont prévenus de la nouvelle heure (0082), avant que la vague
  -- ne la porte.
  if p_start_datetime <> v_wave.start_datetime then
    perform private.record_start_change(pr.id, v_wave.name, v_name, v_wave.start_datetime, p_start_datetime)
    from public.participant_races pr
    where pr.start_wave_id = p_wave_id;
  end if;

  -- Un nouveau nom rattache aussi les inscrits qui l'avaient déclaré (0061).
  update public.race_start_waves
  set name = v_name, start_datetime = p_start_datetime
  where id = p_wave_id;

  perform private.record_wave_change_event(
    v_wave.race_id, v_wave.fact_id, 'revised', v_current.id, v_version_id, v_name,
    v_who.actor_user_id,
    case when v_who.authority = 'organization_member' then v_who.organization_id end
  );

  insert into private.fact_publication_acts
    (race_id, fact_id, fact_version_id, action, actor_user_id, authority, actor_role,
     trust_level, original_value, published_value)
  values (
    v_wave.race_id, v_wave.fact_id, v_version_id, 'revise', v_who.actor_user_id, v_who.authority,
    v_who.actor_role, v_trust,
    jsonb_build_object('name', v_wave.name, 'startAt', v_wave.start_datetime),
    jsonb_build_object('valueText', v_text, 'name', v_name, 'startAt', p_start_datetime)
  );

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values (v_who.actor_user_id, v_who.organization_id, 'wave.update', 'race_start_waves', p_wave_id,
          jsonb_build_object('factVersionId', v_version_id));

  return v_version_id;
end;
$$;


-- La suppression de compte (0078) efface aussi ces alertes.
create or replace function private.delete_user_account(p_user uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_detached uuid[];
begin
  if private.account_deletion_blocker(p_user) is not null then
    raise exception 'compte non supprimable : %', private.account_deletion_blocker(p_user)
      using errcode = '55000';
  end if;

  -- La Nutrition d'abord. En cascade, les points du Plan ou de la sortie
  -- partiraient avant ceux de la Nutrition, et la clé qui les relie, remise à
  -- vide, violerait `nutrition_waypoints_origin_link_check`.
  delete from public.nutrition_plans n
  where n.race_plan_id in (
          select p.id from public.race_plans p
          join public.participant_races pr on pr.id = p.participant_race_id
          where pr.user_id = p_user)
     or n.outing_id in (select o.id from public.outings o where o.user_id = p_user);

  -- Une participation venue d'une organisation porte l'adresse de son fichier.
  -- Si une ligne non réclamée existe déjà pour la même adresse, la détacher la
  -- doublerait : celle-là disparaît.
  delete from public.participant_races pr
  where pr.user_id = p_user
    and (
      pr.invite_email is null
      or exists (
        select 1 from public.participant_races other
        where other.race_id = pr.race_id and other.user_id is null
          and other.invite_email = pr.invite_email
      )
    );

  v_detached := array(
    select pr.id from public.participant_races pr where pr.user_id = p_user
  );

  -- La préparation du coureur part. Ce que l'organisation a importé reste :
  -- invitations, lignes d'import, données déclaratives et indices, purgés avec
  -- sa liste (0077).
  delete from public.race_plans where participant_race_id = any(v_detached);
  delete from public.participant_race_settings where participant_race_id = any(v_detached);
  delete from public.participant_change_impacts where participant_race_id = any(v_detached);
  delete from public.tasks where participant_race_id = any(v_detached);
  delete from public.participant_equipment where participant_race_id = any(v_detached);
  delete from public.bags where participant_race_id = any(v_detached);
  delete from public.race_assistants where participant_race_id = any(v_detached);
  delete from public.emergency_contacts where participant_race_id = any(v_detached);
  delete from public.condition_proposals where participant_race_id = any(v_detached);
  delete from public.post_race_reviews where participant_race_id = any(v_detached);
  delete from public.pluka_conversations where participant_race_id = any(v_detached);
  delete from public.repere_estimates where participant_race_id = any(v_detached);
  delete from public.entitlements where participant_race_id = any(v_detached);
  delete from public.beta_access_grants where participant_race_id = any(v_detached);
  delete from private.race_intelligence_run_members where participant_race_id = any(v_detached);
  delete from private.notification_deliveries where participant_race_id = any(v_detached);
  delete from public.participant_start_changes where participant_race_id = any(v_detached);

  update public.participant_races
  set user_id = null, joined_at = null, preparation_state = 'to_prepare', updated_at = now()
  where id = any(v_detached);

  -- Le reste suit les règles des clés : le profil, les sorties, les produits,
  -- les conversations et les droits partent ; les contenus partagés et les
  -- traces d'action (journal, publications, imports) perdent leur auteur.
  -- L'entrée du journal passe avant : écrite après, elle nommerait un acteur
  -- qui n'existe plus.
  perform private.record_audit('account.deleted', 'users', p_user);

  delete from auth.users where id = p_user;
end;
$$;


-- ============================================================
-- 6. Droits, fonction par fonction (0071)
-- ============================================================

revoke all on function private.record_start_change(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.notify_start_wave_change() from public, anon, authenticated;
revoke all on function private.record_wave_change_event(uuid, uuid, text, uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.org_delete_start_wave(uuid) from public, anon;
revoke all on function public.acknowledge_start_changes(uuid) from public, anon;
revoke all on function public.worker_claim_start_change(uuid) from public, anon, authenticated;
revoke all on function public.worker_complete_start_change(uuid) from public, anon, authenticated;
revoke all on function public.worker_fail_start_change(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.org_delete_start_wave(uuid) to authenticated;
grant execute on function public.acknowledge_start_changes(uuid) to authenticated;
grant execute on function public.worker_claim_start_change(uuid) to service_role;
grant execute on function public.worker_complete_start_change(uuid) to service_role;
grant execute on function public.worker_fail_start_change(uuid, text, boolean) to service_role;

commit;
