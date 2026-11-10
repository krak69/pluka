-- PLUKA V1 — Déclarer les vagues de départ
-- File target: supabase/migrations/0081_start_waves.sql
-- Référence : docs/00_PRODUCT_SPEC.md §29 · docs/02_DATA_MODEL.md §6.5 ·
--             docs/engines/PLAN_ENGINE.md §5.2 · AGENTS §13, §14, §15
--
-- DÉCISIONS DU 2026-11-10
--
-- - L'organisation déclare une vague (nom et heure de départ) dans
--   Participants › Vagues. Propriétaire et admin, comme l'import.
-- - Une vague est une information officielle : un `race_fact` de catégorie
--   `start`, versionné, que `race_start_waves.fact_id` relie à la vague (§6.5).
--   Son heure décale le départ de ses coureurs (PLAN_ENGINE §5.2), donc leur
--   Plan : la déclarer ou la changer passe par le circuit des changements
--   officiels. Plans marqués à revoir, e-mail, et le coureur choisit.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- - `org_declare_start_wave` : la vague, son information officielle v1, la
--   source « Saisie de l'organisation », l'événement de changement. Le
--   déclencheur de 0061 y rattache les inscrits qui avaient déclaré ce nom.
-- - `org_update_start_wave` : une version N+1, jamais une réécriture (§14).
-- - Une vague ne se corrige, ne se retire ni ne se restaure par le chemin
--   générique des informations : la vague et son information divergeraient.
-- - L'analyse d'impact d'une vague ne touche que ses coureurs, sans départ
--   personnel, au lieu de toute l'épreuve.
-- - `org_list_start_waves` : les vagues et les noms à déclarer, avec leur
--   nombre d'inscrits. Des comptes, jamais une liste de coureurs.
--
-- HORS PÉRIMÈTRE
--
-- Supprimer une vague, et prévenir un coureur qu'on change de vague à la main
-- ou par un fichier : à décider.

begin;

-- ============================================================
-- 1. Une vague ne passe que par son propre chemin
-- ============================================================

create or replace function private.guard_wave_fact()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_fact_id uuid;
begin
  if tg_table_name = 'race_fact_versions' then
    v_fact_id := new.fact_id;
  else
    v_fact_id := new.id;
  end if;

  if coalesce(current_setting('pluka.wave_gesture', true), '') <> 'on'
     and exists (select 1 from public.race_start_waves w where w.fact_id = v_fact_id) then
    raise exception 'une vague se modifie depuis Participants › Vagues' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger trg_race_fact_versions_wave_guard
  before insert on public.race_fact_versions
  for each row execute function private.guard_wave_fact();

create trigger trg_race_facts_wave_guard
  before update of archived_at on public.race_facts
  for each row execute function private.guard_wave_fact();

-- ============================================================
-- 2. Ce que lit le coureur
-- ============================================================

-- « Élite : départ le 20 juin à 06:00 », dans le fuseau de l'épreuve.
create or replace function private.start_wave_text(p_name text, p_start timestamptz, p_timezone text)
returns text
language sql immutable set search_path = '' as $$
  select p_name || ' : départ le '
    || extract(day from (p_start at time zone p_timezone))::integer::text || ' '
    || (array['janvier','février','mars','avril','mai','juin','juillet','août',
              'septembre','octobre','novembre','décembre'])
         [extract(month from (p_start at time zone p_timezone))::integer]
    || ' à ' || to_char(p_start at time zone p_timezone, 'HH24:MI');
$$;

-- Propriétaire et admin (comme l'import, 0060), ou l'équipe PLUKA.
create or replace function private.assert_wave_authority(p_race_id uuid)
returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null
     or not (
       private.user_id_has_org_role(v_actor, private.organization_of_race(p_race_id), 'admin')
       or private.user_id_is_pluka_admin(v_actor)
     ) then
    raise exception 'un propriétaire ou un administrateur déclare les vagues' using errcode = '42501';
  end if;
end;
$$;

-- ============================================================
-- 3. Déclarer
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
  v_change_id uuid;
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

  v_change_id := private.signal_fact_change(
    p_race_id, v_fact_id, v_fact_key, 'start', 'published',
    null, v_version_id, null, v_who.actor_user_id,
    case when v_who.authority = 'organization_member' then v_who.organization_id end
  );
  -- Le titre part dans l'e-mail du coureur : un libellé, pas une clé technique.
  update public.race_change_events
  set title = 'Vague ' || v_name || ' : heure de départ'
  where id = v_change_id;

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

-- ============================================================
-- 4. Changer : une version de plus
-- ============================================================

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
  v_change_id uuid;
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

  -- Un nouveau nom rattache aussi les inscrits qui l'avaient déclaré (0061).
  update public.race_start_waves
  set name = v_name, start_datetime = p_start_datetime
  where id = p_wave_id;

  v_change_id := private.signal_fact_change(
    v_wave.race_id, v_wave.fact_id, 'start/wave/' || p_wave_id::text, 'start', 'revised',
    v_current.id, v_version_id, null, v_who.actor_user_id,
    case when v_who.authority = 'organization_member' then v_who.organization_id end
  );
  update public.race_change_events
  set title = 'Vague ' || v_name || ' : heure de départ'
  where id = v_change_id;

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

-- ============================================================
-- 5. Ce que l'organisation lit
-- ============================================================

-- Les vagues de l'édition, et les noms venus d'un fichier qui attendent une
-- vague. Des comptes d'inscrits, jamais qui.
create or replace function public.org_list_start_waves(p_edition_id uuid)
returns table (
  race_id uuid,
  wave_id uuid,
  name text,
  start_datetime timestamptz,
  participants integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.user_can_manage_edition(p_edition_id, 'viewer') or private.is_pluka_admin()) then
    raise exception 'lecture réservée à l''organisation' using errcode = '42501';
  end if;

  return query
  select w.race_id, w.id, w.name, w.start_datetime,
         (select count(*)::integer from public.participant_races pr
          where pr.start_wave_id = w.id and pr.status <> 'archived')
  from public.race_start_waves w
  join public.races r on r.id = w.race_id
  where r.edition_id = p_edition_id
  union all
  select pr.race_id, null::uuid, min(pr.declared_wave_name), null::timestamptz, count(*)::integer
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  where r.edition_id = p_edition_id
    and pr.declared_wave_name is not null
    and pr.status <> 'archived'
  group by pr.race_id, lower(pr.declared_wave_name);
end;
$$;

-- ============================================================
-- 6. L'impact d'une vague ne touche que ses coureurs
-- ============================================================

create or replace function private.analyze_change_impact(p_change_event_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_event record;
  v_category public.fact_category;
  v_modules text[];
  v_module text;
  v_dependent_plans boolean;
  v_created integer := 0;
  v_inserted integer;
  v_participant record;
  v_delivery_id uuid;
  v_wave_id uuid;
begin
  select ce.id, ce.race_id, ce.from_version_id, ce.to_version_id, ce.fact_id
  into v_event
  from public.race_change_events ce
  where ce.id = p_change_event_id;

  if not found then
    raise exception 'événement de changement introuvable' using errcode = 'no_data_found';
  end if;

  select f.category into v_category
  from public.race_facts f
  where f.id = v_event.fact_id;

  v_modules := private.impacted_modules(v_category);

  -- 0081 : l'heure d'une vague ne déplace que le départ de ses coureurs, sauf
  -- ceux qui ont un départ personnel (PLAN_ENGINE §5.2).
  select w.id into v_wave_id from public.race_start_waves w where w.fact_id = v_event.fact_id;

  if array_length(v_modules, 1) is null then
    -- Rien à signaler : ce n'est pas un échec, c'est une analyse dont la
    -- conclusion est « personne n'est concerné ».
    return 0;
  end if;

  select exists (
    select 1
    from public.plan_version_dependencies d
    where d.race_fact_version_id = v_event.from_version_id
  ) into v_dependent_plans;

  foreach v_module in array v_modules
  loop
    insert into public.participant_change_impacts
      (change_event_id, participant_race_id, impacted_module)
    select v_event.id, pr.id, v_module
    from public.participant_races pr
    where pr.race_id = v_event.race_id
      and pr.status = 'active'
      and (v_wave_id is null
           or (pr.start_wave_id = v_wave_id and pr.personal_start_datetime is null))
      and case v_module
        when 'plan' then
          case
            when v_dependent_plans then exists (
              select 1
              from public.race_plans rp
              join public.plan_version_dependencies d on d.race_plan_id = rp.id
              where rp.participant_race_id = pr.id
                and rp.status = 'active'
                and d.race_fact_version_id = v_event.from_version_id
            )
            else exists (
              select 1 from public.race_plans rp
              where rp.participant_race_id = pr.id and rp.status = 'active'
            )
          end
        when 'nutrition' then exists (
          select 1
          from public.nutrition_plans np
          join public.race_plans rp on rp.id = np.race_plan_id
          where rp.participant_race_id = pr.id and rp.status = 'active' and np.enabled
        )
        when 'assistance' then exists (
          select 1 from public.race_assistants ra
          where ra.participant_race_id = pr.id and ra.status = 'active'
        )
        when 'conditions' then exists (
          select 1 from public.race_plans rp
          where rp.participant_race_id = pr.id and rp.status = 'active'
        )
        else true
      end
    on conflict (change_event_id, participant_race_id, impacted_module) do nothing;

    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end loop;

  -- ---------------------------------------------------------
  -- §46 — le coureur est informé, s'il le veut bien
  -- ---------------------------------------------------------
  -- Une livraison par coureur concerné, pas par impact. Trois conditions, et
  -- chacune ferme un cas distinct :
  --
  --   `user_id is not null` — un invité jamais activé n'a pas d'adresse ;
  --   `notifications_enabled` — le coureur a choisi le silence ;
  --   `left join` + `coalesce` — la ligne de réglages est facultative, et son
  --   absence vaut « activé », conformément au défaut de la colonne.
  --
  -- L'impact, lui, a déjà été écrit : couper la notification ne coupe pas
  -- l'information.
  for v_participant in
    select distinct i.participant_race_id
    from public.participant_change_impacts i
    join public.participant_races pr on pr.id = i.participant_race_id
    left join public.participant_race_settings s on s.participant_race_id = pr.id
    where i.change_event_id = v_event.id
      and pr.user_id is not null
      and coalesce(s.notifications_enabled, true)
  loop
    insert into private.notification_deliveries
      (kind, participant_race_id, change_event_id, idempotency_key)
    values (
      'race_change_impact',
      v_participant.participant_race_id,
      v_event.id,
      'race_change_impact:' || v_event.id::text || ':' || v_participant.participant_race_id::text
    )
    on conflict (participant_race_id, change_event_id, kind) do nothing
    returning id into v_delivery_id;

    -- Une livraison déjà créée par un tour précédent ne réenfile rien :
    -- rejouer l'analyse ne doit pas produire un second email.
    if v_delivery_id is not null then
      insert into private.outbox_events
        (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
      values (
        'email.send',
        'notification_delivery',
        v_delivery_id,
        jsonb_build_object(
          'deliveryId', v_delivery_id,
          'kind', 'race_change_impact',
          'idempotencyKey', 'email.send:' || v_delivery_id::text
        ),
        'email.send:' || v_delivery_id::text
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end loop;

  return v_created;
end;
$$;


-- ============================================================
-- 7. Droits, fonction par fonction (0071)
-- ============================================================

revoke all on function private.guard_wave_fact() from public, anon, authenticated;
revoke all on function private.start_wave_text(text, timestamptz, text) from public, anon, authenticated;
revoke all on function private.assert_wave_authority(uuid) from public, anon, authenticated;
revoke all on function public.org_declare_start_wave(uuid, text, timestamptz) from public, anon;
revoke all on function public.org_update_start_wave(uuid, text, timestamptz) from public, anon;
revoke all on function public.org_list_start_waves(uuid) from public, anon;
grant execute on function public.org_declare_start_wave(uuid, text, timestamptz) to authenticated;
grant execute on function public.org_update_start_wave(uuid, text, timestamptz) to authenticated;
grant execute on function public.org_list_start_waves(uuid) to authenticated;

commit;
