-- PLUKA V1 — Corriger, retirer et restaurer une information publiée
-- File target: supabase/migrations/0043_fact_correction.sql
-- Référence : docs/engines/SOURCES_EXTRACTION.md §31, §35, §37, §43, §44 ·
--             docs/02_DATA_MODEL.md §7.4, §7.5 · AGENTS §14, §102 · migrations 0012, 0014
--
-- DÉCISION PRODUIT DU 2026-10-07
--
-- « Toutes les informations doivent pouvoir être modifiées, supprimées. »
--
-- Jusqu'ici, une information ne bougeait qu'à travers un candidat : on pouvait
-- publier une proposition, la corriger avant, ou la rejeter — mais rien ne
-- permettait de corriger une information déjà publiée, ni de la retirer.
--
-- CE QUI EST POSÉ, DANS LES RÈGLES EXISTANTES
--
-- - Modifier une information publiée crée la version N+1 (§35) ; la version N
--   reste, en `superseded`, pour l'audit. Les sources de N restent attachées à
--   N+1 : la correction porte sur la lecture, pas sur le document.
-- - « Supprimer » une information publiée est un RETRAIT (§37) : le fact passe
--   en `archived_at`, il disparaît de toutes les lectures publiques (la policy
--   de 0005 le filtre, et les versions suivent par leur jointure), et ses
--   versions restent. Une version publiée n'est jamais effacée (AGENTS §14,
--   §102). Le retrait se défait : restaurer remet le fact en circulation.
-- - Chaque geste est humain, journalisé (`fact_publication_acts`, audit) et
--   signalé : un `race_change_events` et l'événement outbox que l'analyseur
--   d'impact consomme déjà (0014), pour que les Plans qui dépendaient de la
--   valeur soient marqués à revoir — jamais réécrits (§44).
--
-- CE QUE LA MIGRATION AJOUTE
--
--   01. `race_change_events` : un retrait n'a pas de version d'arrivée ;
--       `change_kind` dit la nature du changement ;
--   02. les actions du journal ;
--   03. l'autorité d'un geste sur un fact ;
--   04. corriger, retirer, restaurer ;
--   05. la lecture des informations d'une épreuve et de leur historique.

begin;

-- ============================================================
-- 01. Changements
-- ============================================================

alter table public.race_change_events
  add column change_kind text not null default 'published'
    check (change_kind in ('published', 'revised', 'retired', 'restored')),
  alter column to_version_id drop not null,
  add constraint race_change_events_retired_has_no_target
    check ((change_kind = 'retired') = (to_version_id is null));

comment on column public.race_change_events.change_kind is
  'Nature du changement (0043) : publication, correction d''une information publiée, retrait, restauration. Un retrait n''a pas de version d''arrivée.';

-- ============================================================
-- 02. Journal
-- ============================================================

alter table private.fact_publication_acts
  drop constraint fact_publication_acts_action_check,
  add constraint fact_publication_acts_action_check check (
    action in ('publish', 'edit_and_publish', 'reject', 'mark_duplicate', 'needs_review',
               'revise', 'retire', 'restore')
  );

-- ============================================================
-- 03. Autorité
-- ============================================================

/*
 * Même règle que la publication (0012) : un éditeur de l'organisation de la
 * course, sinon l'administration PLUKA qui écrit. Rend l'autorité et le rôle,
 * ou refuse.
 */
create or replace function private.fact_gesture_authority(p_race_id uuid)
returns table (actor_user_id uuid, authority text, actor_role public.organization_member_role, organization_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_organization_id uuid := private.organization_of_race(p_race_id);
  v_role public.organization_member_role;
begin
  if v_actor is null then
    raise exception 'geste refusé : aucun acte humain (§30)' using errcode = '42501';
  end if;

  select om.role into v_role
  from public.organization_members om
  where om.organization_id = v_organization_id and om.user_id = v_actor;

  if private.user_id_has_org_role(v_actor, v_organization_id, 'editor') then
    return query select v_actor, 'organization_member'::text, v_role, v_organization_id;
  elsif private.user_id_is_pluka_admin(v_actor) then
    return query select v_actor, 'platform_admin'::text, v_role, v_organization_id;
  else
    raise exception 'geste refusé : autorité insuffisante sur cette course (§30)'
      using errcode = '42501';
  end if;
end;
$$;

/* Change event + événement outbox consommé par l'analyseur d'impact (0014). */
create or replace function private.signal_fact_change(
  p_race_id uuid,
  p_fact_id uuid,
  p_fact_key text,
  p_category public.fact_category,
  p_kind text,
  p_from_version_id uuid,
  p_to_version_id uuid,
  p_note text,
  p_actor uuid,
  p_organization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change_id uuid;
  v_severity public.change_severity;
  v_key text;
begin
  v_severity := case when private.fact_change_is_critical(p_category) then 'critical' else 'info' end;

  insert into public.race_change_events
    (race_id, fact_id, from_version_id, to_version_id, severity, title, summary,
     published_by_user_id, published_by_organization_id, change_kind)
  values
    (p_race_id, p_fact_id, p_from_version_id, p_to_version_id, v_severity, p_fact_key, p_note,
     p_actor, p_organization_id, p_kind)
  returning id into v_change_id;

  v_key := 'race.fact.' || p_kind || ':' || v_change_id::text;

  -- Même forme de charge que la publication (0012) : l'analyseur la lit telle
  -- quelle. Le type d'événement dit la nature, la charge reste commune.
  insert into private.outbox_events (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'race.fact.' || p_kind,
    'race_fact',
    p_fact_id,
    jsonb_build_object(
      'raceId', p_race_id,
      'factId', p_fact_id,
      'factKey', p_fact_key,
      'factVersionId', p_to_version_id,
      'previousVersionId', p_from_version_id,
      'severity', v_severity,
      'changeEventId', v_change_id,
      'idempotencyKey', v_key
    ),
    v_key
  );

  return v_change_id;
end;
$$;

-- ============================================================
-- 04. Corriger, retirer, restaurer
-- ============================================================

create or replace function public.revise_race_fact(
  p_fact_id uuid,
  p_value_text text,
  p_value_number numeric,
  p_unit text,
  p_trust_level public.trust_level,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fact public.race_facts;
  v_current public.race_fact_versions;
  v_who record;
  v_version_id uuid;
  v_next integer;
  v_text text := nullif(btrim(coalesce(p_value_text, '')), '');
  v_unit text := nullif(btrim(coalesce(p_unit, '')), '');
begin
  select * into v_fact from public.race_facts f where f.id = p_fact_id for update;
  if v_fact.id is null then
    raise exception 'information introuvable' using errcode = 'P0002';
  end if;

  select * into v_who from private.fact_gesture_authority(v_fact.race_id);

  if v_fact.archived_at is not null then
    raise exception 'information retirée : restaure-la avant de la corriger' using errcode = '55000';
  end if;

  if p_trust_level not in ('official', 'pluka_validated') then
    raise exception 'niveau de confiance non publiable' using errcode = '22023';
  end if;

  if num_nonnulls(v_text, p_value_number) = 0 then
    raise exception 'une version sans valeur ne publie rien' using errcode = '22023';
  end if;

  select * into v_current from public.race_fact_versions v where v.id = v_fact.current_version_id;

  if v_current.id is not null
     and v_current.value_text is not distinct from v_text
     and v_current.value_number is not distinct from p_value_number
     and v_current.unit is not distinct from v_unit
     and v_current.trust_level = p_trust_level then
    raise exception 'aucune modification' using errcode = '55000';
  end if;

  select coalesce(max(v.version_number), 0) + 1 into v_next
  from public.race_fact_versions v where v.fact_id = p_fact_id;

  -- La valeur structurée de la version précédente ne suit pas : elle décrivait
  -- l'ancienne valeur, et la recopier ferait mentir la nouvelle.
  insert into public.race_fact_versions
    (fact_id, version_number, value_text, value_number, unit, value_json,
     trust_level, workflow_status, supersedes_version_id,
     created_by_user_id, published_by_user_id,
     validated_by_user_id, validated_by_organization_id, validated_at, published_at)
  values (
    p_fact_id, v_next, v_text, p_value_number, v_unit, null,
    p_trust_level, 'published', v_current.id,
    v_who.actor_user_id, v_who.actor_user_id, v_who.actor_user_id,
    case when p_trust_level = 'official' then v_who.organization_id else null end,
    now(), now()
  )
  returning id into v_version_id;

  if v_current.id is not null then
    update public.race_fact_versions set workflow_status = 'superseded'
    where id = v_current.id and workflow_status = 'published';

    -- La correction porte sur la lecture, pas sur le document : les preuves
    -- de la version précédente restent celles de la nouvelle.
    insert into public.fact_sources
      (fact_version_id, source_id, source_snapshot_id, page_start, page_end,
       section_label, excerpt, locator, is_primary)
    select v_version_id, fs.source_id, fs.source_snapshot_id, fs.page_start, fs.page_end,
           fs.section_label, fs.excerpt, fs.locator, fs.is_primary
    from public.fact_sources fs
    where fs.fact_version_id = v_current.id;
  end if;

  update public.race_facts set current_version_id = v_version_id where id = p_fact_id;

  perform private.signal_fact_change(
    v_fact.race_id, p_fact_id, v_fact.fact_key, v_fact.category, 'revised',
    v_current.id, v_version_id, p_note, v_who.actor_user_id,
    case when v_who.authority = 'organization_member' then v_who.organization_id else null end
  );

  insert into private.fact_publication_acts
    (race_id, fact_id, fact_version_id, action, actor_user_id, authority, actor_role,
     trust_level, original_value, published_value, note)
  values (
    v_fact.race_id, p_fact_id, v_version_id, 'revise', v_who.actor_user_id, v_who.authority,
    v_who.actor_role, p_trust_level,
    jsonb_build_object('valueText', v_current.value_text, 'valueNumber', v_current.value_number,
                       'unit', v_current.unit, 'trustLevel', v_current.trust_level),
    jsonb_build_object('valueText', v_text, 'valueNumber', p_value_number, 'unit', v_unit),
    p_note
  );

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values (v_who.actor_user_id, v_who.organization_id, 'fact.revise', 'race_fact_versions', v_version_id,
          jsonb_build_object('factKey', v_fact.fact_key, 'trustLevel', p_trust_level));

  return v_version_id;
end;
$$;

create or replace function public.retire_race_fact(p_fact_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fact public.race_facts;
  v_who record;
begin
  select * into v_fact from public.race_facts f where f.id = p_fact_id for update;
  if v_fact.id is null then
    raise exception 'information introuvable' using errcode = 'P0002';
  end if;

  select * into v_who from private.fact_gesture_authority(v_fact.race_id);

  if v_fact.archived_at is not null then
    raise exception 'information déjà retirée' using errcode = '55000';
  end if;

  update public.race_facts set archived_at = now() where id = p_fact_id;

  perform private.signal_fact_change(
    v_fact.race_id, p_fact_id, v_fact.fact_key, v_fact.category, 'retired',
    v_fact.current_version_id, null, p_note, v_who.actor_user_id,
    case when v_who.authority = 'organization_member' then v_who.organization_id else null end
  );

  insert into private.fact_publication_acts
    (race_id, fact_id, fact_version_id, action, actor_user_id, authority, actor_role, note)
  values (v_fact.race_id, p_fact_id, v_fact.current_version_id, 'retire', v_who.actor_user_id,
          v_who.authority, v_who.actor_role, p_note);

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values (v_who.actor_user_id, v_who.organization_id, 'fact.retire', 'race_facts', p_fact_id,
          jsonb_build_object('factKey', v_fact.fact_key));
end;
$$;

create or replace function public.restore_race_fact(p_fact_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fact public.race_facts;
  v_who record;
begin
  select * into v_fact from public.race_facts f where f.id = p_fact_id for update;
  if v_fact.id is null then
    raise exception 'information introuvable' using errcode = 'P0002';
  end if;

  select * into v_who from private.fact_gesture_authority(v_fact.race_id);

  if v_fact.archived_at is null then
    raise exception 'information non retirée' using errcode = '55000';
  end if;
  if v_fact.current_version_id is null then
    raise exception 'aucune version à remettre en circulation' using errcode = '55000';
  end if;

  update public.race_facts set archived_at = null where id = p_fact_id;

  perform private.signal_fact_change(
    v_fact.race_id, p_fact_id, v_fact.fact_key, v_fact.category, 'restored',
    null, v_fact.current_version_id, p_note, v_who.actor_user_id,
    case when v_who.authority = 'organization_member' then v_who.organization_id else null end
  );

  insert into private.fact_publication_acts
    (race_id, fact_id, fact_version_id, action, actor_user_id, authority, actor_role, note)
  values (v_fact.race_id, p_fact_id, v_fact.current_version_id, 'restore', v_who.actor_user_id,
          v_who.authority, v_who.actor_role, p_note);

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values (v_who.actor_user_id, v_who.organization_id, 'fact.restore', 'race_facts', p_fact_id,
          jsonb_build_object('factKey', v_fact.fact_key));
end;
$$;

-- ============================================================
-- 05. Lectures
-- ============================================================

/*
 * Les informations d'une épreuve, publiées et retirées, avec leur version
 * courante et sa preuve principale. Même autorité que les gestes : qui peut
 * corriger peut lire ce qu'il corrige, retirées comprises.
 */
create or replace function public.list_race_facts_for_editing(p_race_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.fact_gesture_authority(p_race_id);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'factId', f.id,
      'category', f.category,
      'factKey', f.fact_key,
      'archivedAt', f.archived_at,
      'versionId', v.id,
      'versionNumber', v.version_number,
      'valueText', v.value_text,
      'valueNumber', v.value_number,
      'unit', v.unit,
      'trustLevel', v.trust_level,
      'publishedAt', v.published_at,
      'source', (
        select jsonb_build_object('title', s.title, 'page', fs.page_start, 'excerpt', fs.excerpt)
        from public.fact_sources fs join public.sources s on s.id = fs.source_id
        where fs.fact_version_id = v.id
        order by fs.is_primary desc, fs.id
        limit 1
      )
    ) order by f.archived_at nulls first, f.category, f.fact_key)
    from public.race_facts f
    join public.race_fact_versions v on v.id = f.current_version_id
    where f.race_id = p_race_id
  ), '[]'::jsonb);
end;
$$;

/* L'historique d'une information : versions et gestes, du plus récent au plus ancien. */
create or replace function public.list_race_fact_history(p_fact_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_race_id uuid;
begin
  select f.race_id into v_race_id from public.race_facts f where f.id = p_fact_id;
  if v_race_id is null then
    raise exception 'information introuvable' using errcode = 'P0002';
  end if;

  perform private.fact_gesture_authority(v_race_id);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'action', a.action,
      'at', a.created_at,
      'actorEmail', u.email,
      'versionNumber', v.version_number,
      'valueText', v.value_text,
      'valueNumber', v.value_number,
      'unit', v.unit,
      'trustLevel', a.trust_level,
      'note', a.note
    ) order by a.created_at desc, a.id)
    from private.fact_publication_acts a
    left join public.race_fact_versions v on v.id = a.fact_version_id
    left join public.users u on u.id = a.actor_user_id
    where a.fact_id = p_fact_id
  ), '[]'::jsonb);
end;
$$;

-- ============================================================
-- Droits
-- ============================================================

revoke all on function private.fact_gesture_authority(uuid) from public, anon, authenticated;
revoke all on function private.signal_fact_change(uuid, uuid, text, public.fact_category, text, uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;

revoke all on function public.revise_race_fact(uuid, text, numeric, text, public.trust_level, text) from public, anon;
revoke all on function public.retire_race_fact(uuid, text) from public, anon;
revoke all on function public.restore_race_fact(uuid, text) from public, anon;
revoke all on function public.list_race_facts_for_editing(uuid) from public, anon;
revoke all on function public.list_race_fact_history(uuid) from public, anon;

grant execute on function public.revise_race_fact(uuid, text, numeric, text, public.trust_level, text) to authenticated;
grant execute on function public.retire_race_fact(uuid, text) to authenticated;
grant execute on function public.restore_race_fact(uuid, text) to authenticated;
grant execute on function public.list_race_facts_for_editing(uuid) to authenticated;
grant execute on function public.list_race_fact_history(uuid) to authenticated;

commit;
