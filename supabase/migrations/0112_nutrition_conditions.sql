-- ============================================================
-- 0112 — Nutrition : temps chaud, temps froid, nuit
-- ============================================================
--
-- NUTRITION_ENGINE §13 à §19, §24, §25, §14 bis ; décisions du 2026-11-24.
--
-- Le coureur pose des plages Chaud, Froid ou Nuit sur son Plan, en temps
-- écoulé depuis le départ. Sur une plage chaude ou froide, des cibles propres
-- remplacent les siennes ; la Nuit ne change aucune cible et sert à répartir
-- la caféine. Les tables existent depuis 0001 (`nutrition_conditions`,
-- `nutrition_condition_ranges`) ; il leur manquait :
--
-- * les cibles du profil, sur la condition elle-même : nulles, le moteur
--   applique la proposition PLUKA, recalculée sur les cibles de base ; fixées,
--   ce sont celles du coureur (§14 bis) ;
-- * la répartition de la caféine, sur la stratégie (`auto`, `late`, `night`,
--   `manual`, décision du 2026-11-24, prototype) ;
-- * une écriture : `save_nutrition_conditions`, qui remplace le tout en une
--   transaction et refuse chaud et froid en même temps (§17, HOT_COLD_OVERLAP).
--
-- `apply_nutrition_to_active_plan` (0111) refusait une stratégie qui avait des
-- conditions plutôt que de les perdre : elle les recopie désormais. L'export
-- du compte les contient.

alter table public.nutrition_conditions
  add column carbs_g_per_hour numeric(6,2)
    constraint nutrition_conditions_carbs_bounds
      check (carbs_g_per_hour is null or carbs_g_per_hour between 0 and 400),
  add column hydration_ml_per_hour integer
    constraint nutrition_conditions_hydration_bounds
      check (hydration_ml_per_hour is null or hydration_ml_per_hour between 0 and 5000),
  add column sodium_mg_per_hour integer
    constraint nutrition_conditions_sodium_bounds
      check (sodium_mg_per_hour is null or sodium_mg_per_hour between 0 and 10000),
  -- §16 : la Nuit n'a pas de cibles.
  add constraint nutrition_conditions_night_without_targets
    check (condition_type <> 'night'
           or (carbs_g_per_hour is null and hydration_ml_per_hour is null
               and sodium_mg_per_hour is null));

comment on column public.nutrition_conditions.hydration_ml_per_hour is
  'Cible fixée par le coureur sur ce type de plage ; nulle, la proposition PLUKA (NUTRITION_ENGINE §14 bis) s''applique.';

create unique index ux_nutrition_conditions_plan_type
  on public.nutrition_conditions(nutrition_plan_id, condition_type);

create index ix_nutrition_condition_ranges_condition
  on public.nutrition_condition_ranges(nutrition_condition_id, start_elapsed_seconds);

alter table public.nutrition_plans
  add column caffeine_spread text not null default 'auto'
    constraint nutrition_plans_caffeine_spread
      check (caffeine_spread in ('auto', 'late', 'night', 'manual'));

-- ------------------------------------------------------------
-- 1. Enregistrer les conditions de la stratégie du Plan actif
-- ------------------------------------------------------------

/*
 * `p_conditions` : [{ "type": "hot", "enabled": true, "carbs": null,
 * "hydration": 650, "sodium": null, "ranges": [{ "start": 15000, "end": 38400 }] }].
 * Tout est vérifié avant d'écrire ; puis les conditions sont remplacées.
 */
create or replace function public.save_nutrition_conditions(
  p_participant_race_id uuid,
  p_conditions jsonb,
  p_caffeine_spread text
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_plan uuid;
  v_condition jsonb;
  v_id uuid;
  v_conditions jsonb := coalesce(p_conditions, '[]'::jsonb);
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;

  if p_caffeine_spread is null or p_caffeine_spread not in ('auto', 'late', 'night', 'manual')
     or jsonb_typeof(v_conditions) <> 'array'
     or jsonb_array_length(v_conditions) > 3
     or pg_column_size(v_conditions) > 65536 then
    raise exception 'conditions invalides' using errcode = '22023';
  end if;

  -- Un type au plus une fois, parmi chaud, froid, nuit ; pas de cible pour la nuit.
  if exists (
    select 1 from jsonb_array_elements(v_conditions) c
    where jsonb_typeof(c) <> 'object'
       or coalesce(c ->> 'type', '') not in ('hot', 'cold', 'night')
       or (c ->> 'type' = 'night'
           and (c ->> 'carbs' is not null or c ->> 'hydration' is not null
                or c ->> 'sodium' is not null))
       or jsonb_typeof(coalesce(c -> 'ranges', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(c -> 'ranges', '[]'::jsonb)) > 12
  ) or (
    select count(*) <> count(distinct c ->> 'type') from jsonb_array_elements(v_conditions) c
  ) then
    raise exception 'conditions invalides' using errcode = '22023';
  end if;

  -- Des plages bornées : un début, une fin après lui, dans les 30 jours d'une course.
  if exists (
    select 1
    from jsonb_array_elements(v_conditions) c,
         jsonb_array_elements(coalesce(c -> 'ranges', '[]'::jsonb)) r
    where (r ->> 'start')::integer < 0
       or (r ->> 'end')::integer <= (r ->> 'start')::integer
       or (r ->> 'end')::integer > 30 * 24 * 3600
  ) then
    raise exception 'plage invalide' using errcode = '22023';
  end if;

  -- §17 : chaud et froid sur le même intervalle n'ont pas de sens ; deux plages
  -- d'un même type ne se recouvrent pas non plus.
  if exists (
    with ranges as (
      select c ->> 'type' as kind,
             coalesce((c ->> 'enabled')::boolean, true) as enabled,
             (r.value ->> 'start')::integer as starts,
             (r.value ->> 'end')::integer as ends,
             r.ordinality as position
      from jsonb_array_elements(v_conditions) c,
           jsonb_array_elements(coalesce(c -> 'ranges', '[]'::jsonb)) with ordinality r
    )
    select 1 from ranges a join ranges b
      on a.starts < b.ends and b.starts < a.ends
     and ((a.kind = b.kind and a.position < b.position)
          or (a.kind = 'hot' and b.kind = 'cold' and a.enabled and b.enabled))
  ) then
    raise exception 'HOT_COLD_OVERLAP' using errcode = '22023';
  end if;

  select n.id into v_plan
  from public.nutrition_plans n
  join public.race_plans rp on rp.id = n.race_plan_id
  where rp.participant_race_id = p_participant_race_id and rp.status = 'active';
  if v_plan is null then
    raise exception 'aucune stratégie Nutrition sur le Plan actif' using errcode = 'P0002';
  end if;

  delete from public.nutrition_conditions where nutrition_plan_id = v_plan;

  for v_condition in select value from jsonb_array_elements(v_conditions) loop
    insert into public.nutrition_conditions
      (nutrition_plan_id, condition_type, enabled, carbs_g_per_hour, hydration_ml_per_hour,
       sodium_mg_per_hour)
    values
      (v_plan, (v_condition ->> 'type')::public.nutrition_condition_type,
       coalesce((v_condition ->> 'enabled')::boolean, true),
       (v_condition ->> 'carbs')::numeric, (v_condition ->> 'hydration')::integer,
       (v_condition ->> 'sodium')::integer)
    returning id into v_id;

    insert into public.nutrition_condition_ranges
      (nutrition_condition_id, source, start_elapsed_seconds, end_elapsed_seconds)
    select v_id, 'manual', (r ->> 'start')::integer, (r ->> 'end')::integer
    from jsonb_array_elements(coalesce(v_condition -> 'ranges', '[]'::jsonb)) r
    order by (r ->> 'start')::integer;
  end loop;

  update public.nutrition_plans
  set caffeine_spread = p_caffeine_spread, updated_at = now()
  where id = v_plan;
end;
$$;

revoke all on function public.save_nutrition_conditions(uuid, jsonb, text) from public, anon;
grant execute on function public.save_nutrition_conditions(uuid, jsonb, text) to authenticated;

-- ------------------------------------------------------------
-- 2. Le report sur un nouveau Plan recopie aussi les conditions
-- ------------------------------------------------------------
-- Même contrat que 0111. Les plages restent en temps écoulé : le départ de la
-- course ne bouge pas avec le Plan, leur heure à l'horloge non plus ; le
-- moteur ramène à la course une plage qui la dépasse (§19).

create or replace function public.apply_nutrition_to_active_plan(
  p_participant_race_id uuid,
  p_from_nutrition_plan_id uuid,
  p_engine_version text,
  p_engine_config_version text,
  p_input_hash text,
  p_input_snapshot jsonb,
  p_kept jsonb,
  p_diff jsonb
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_active uuid;
  v_latest uuid;
  v_from public.nutrition_plans%rowtype;
  v_id uuid;
  v_waypoint record;
  v_new_waypoint uuid;
  v_condition record;
  v_new_condition uuid;
  v_kept jsonb;
  v_order smallint := 0;
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;

  if p_engine_version is null or btrim(p_engine_version) = ''
     or jsonb_typeof(coalesce(p_kept, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_diff, '{}'::jsonb)) <> 'object'
     or pg_column_size(p_kept) > 65536 or pg_column_size(p_diff) > 65536 then
    raise exception 'validation invalide' using errcode = '22023';
  end if;

  select rp.id into v_active
  from public.race_plans rp
  where rp.participant_race_id = p_participant_race_id and rp.status = 'active';
  if v_active is null then
    raise exception 'aucun Plan actif' using errcode = 'P0002';
  end if;

  -- Déjà validée (un nouvel essai, un second onglet) : rien à refaire.
  select n.id into v_id from public.nutrition_plans n where n.race_plan_id = v_active;
  if v_id is not null then
    return v_id;
  end if;

  select n.id into v_latest
  from public.nutrition_plans n
  join public.race_plans rp on rp.id = n.race_plan_id
  where rp.participant_race_id = p_participant_race_id
  order by n.generated_at desc, n.created_at desc
  limit 1;
  if v_latest is null or v_latest <> p_from_nutrition_plan_id then
    raise exception 'stratégie périmée' using errcode = '22023';
  end if;

  select * into v_from from public.nutrition_plans where id = p_from_nutrition_plan_id;

  -- Toutes les colonnes de réglage, telles quelles. Le test pgTAP 82 échoue
  -- si une colonne est ajoutée à `nutrition_plans` sans être classée ici.
  insert into public.nutrition_plans (
    race_plan_id,
    carbs_target_g_per_hour, hydration_target_ml_per_hour, sodium_target_mg_per_hour,
    caffeine_target_total_mg, reserve_percent, enabled, water_share_percent,
    placement_density, aid_buffer, placement_mode, placement_interval_minutes,
    selected_user_product_ids, flask_count, flask_capacity_ml, bladder_ml,
    no_refill_waypoint_ids, supply_start_waypoint_ids, supply_bag_waypoint_ids,
    supply_assistance_waypoint_ids, aid_drink_waypoint_ids, caffeine_spread,
    engine_version, engine_config_version, input_hash, input_snapshot,
    generated_at, confirmed_at, last_recalculated_at
  )
  values (
    v_active,
    v_from.carbs_target_g_per_hour, v_from.hydration_target_ml_per_hour,
    v_from.sodium_target_mg_per_hour, v_from.caffeine_target_total_mg,
    v_from.reserve_percent, v_from.enabled, v_from.water_share_percent,
    v_from.placement_density, v_from.aid_buffer, v_from.placement_mode,
    v_from.placement_interval_minutes, v_from.selected_user_product_ids,
    v_from.flask_count, v_from.flask_capacity_ml, v_from.bladder_ml,
    v_from.no_refill_waypoint_ids, v_from.supply_start_waypoint_ids,
    v_from.supply_bag_waypoint_ids, v_from.supply_assistance_waypoint_ids,
    v_from.aid_drink_waypoint_ids, v_from.caffeine_spread,
    p_engine_version, p_engine_config_version, p_input_hash,
    coalesce(p_input_snapshot, '{}'::jsonb),
    now(), now(), now()
  )
  returning id into v_id;

  -- Les conditions et leurs plages, telles quelles.
  for v_condition in
    select c.* from public.nutrition_conditions c
    where c.nutrition_plan_id = v_from.id
    order by c.condition_type
  loop
    insert into public.nutrition_conditions (
      nutrition_plan_id, condition_type, label, enabled, created_at,
      carbs_g_per_hour, hydration_ml_per_hour, sodium_mg_per_hour
    )
    values (
      v_id, v_condition.condition_type, v_condition.label, v_condition.enabled,
      v_condition.created_at, v_condition.carbs_g_per_hour, v_condition.hydration_ml_per_hour,
      v_condition.sodium_mg_per_hour
    )
    returning id into v_new_condition;

    insert into public.nutrition_condition_ranges (
      nutrition_condition_id, source, source_condition_period_id, start_elapsed_seconds,
      end_elapsed_seconds, carbs_target_g_per_hour, hydration_target_ml_per_hour,
      sodium_target_mg_per_hour, caffeine_distribution_weight, created_at
    )
    select
      v_new_condition, r.source, r.source_condition_period_id, r.start_elapsed_seconds,
      r.end_elapsed_seconds, r.carbs_target_g_per_hour, r.hydration_target_ml_per_hour,
      r.sodium_target_mg_per_hour, r.caffeine_distribution_weight, r.created_at
    from public.nutrition_condition_ranges r
    where r.nutrition_condition_id = v_condition.id;
  end loop;

  -- Les prises modifiées seulement : les autres se recalculent à la lecture.
  for v_waypoint in
    select w.*
    from public.nutrition_waypoints w
    where w.nutrition_plan_id = v_from.id and w.is_customized
    order by w.elapsed_seconds, w.stable_key
  loop
    v_order := v_order + 1;
    v_kept := p_kept -> v_waypoint.stable_key;

    insert into public.nutrition_waypoints (
      nutrition_plan_id, label, elapsed_seconds, distance_km, sort_order, origin,
      stable_key, is_customized, is_locked, latitude, longitude, route_altitude_m
    )
    values (
      v_id,
      coalesce(left(nullif(btrim(v_kept ->> 'label'), ''), 120), v_waypoint.label),
      coalesce((v_kept ->> 'elapsed_seconds')::integer, v_waypoint.elapsed_seconds),
      case when v_kept is null then v_waypoint.distance_km
           else (v_kept ->> 'distance_km')::numeric end,
      v_order,
      case when v_waypoint.origin in ('plan_waypoint', 'outing_waypoint')
           then 'generated_checkpoint'::public.nutrition_waypoint_origin
           else v_waypoint.origin end,
      v_waypoint.stable_key, true, v_waypoint.is_locked,
      case when v_kept is null then v_waypoint.latitude end,
      case when v_kept is null then v_waypoint.longitude end,
      case when v_kept is null then v_waypoint.route_altitude_m end
    )
    returning id into v_new_waypoint;

    insert into public.nutrition_waypoint_items (
      nutrition_waypoint_id, user_nutrition_product_id, generic_label, action, quantity,
      unit, carbs_g, sodium_mg, caffeine_mg, hydration_ml, estimated, created_at,
      product_label_snapshot, product_snapshot, is_customized
    )
    select
      v_new_waypoint, i.user_nutrition_product_id, i.generic_label, i.action, i.quantity,
      i.unit, i.carbs_g, i.sodium_mg, i.caffeine_mg, i.hydration_ml, i.estimated, i.created_at,
      i.product_label_snapshot, i.product_snapshot, i.is_customized
    from public.nutrition_waypoint_items i
    where i.nutrition_waypoint_id = v_waypoint.id;
  end loop;

  insert into public.nutrition_recalculations (
    nutrition_plan_id, status, trigger_reason, engine_version, engine_config_version,
    input_hash, before_snapshot, proposed_snapshot, diff_payload, decided_at, applied_at
  )
  values (
    v_id, 'applied', 'plan_changed', p_engine_version, p_engine_config_version, p_input_hash,
    jsonb_build_object('nutrition_plan_id', v_from.id, 'race_plan_id', v_from.race_plan_id),
    jsonb_build_object('nutrition_plan_id', v_id, 'race_plan_id', v_active),
    coalesce(p_diff, '{}'::jsonb), now(), now()
  );

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 3. export_my_data : les conditions rejoignent la stratégie
-- ------------------------------------------------------------

create or replace function public.export_my_data()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_races uuid[];
begin
  if v_user is null then
    raise exception 'session requise' using errcode = '42501';
  end if;

  v_races := array(select id from public.participant_races where user_id = v_user);

  return jsonb_build_object(
    'exportedAt', now(),
    'account', (select to_jsonb(u) from public.users u where u.id = v_user),
    'trailProfile', (select to_jsonb(t) from public.trail_profiles t where t.user_id = v_user),
    'participations', coalesce((
      select jsonb_agg(
        to_jsonb(pr) || jsonb_build_object(
          'race', (select jsonb_build_object('id', r.id, 'name', r.name) from public.races r where r.id = pr.race_id),
          'settings', (select jsonb_agg(to_jsonb(s)) from public.participant_race_settings s where s.participant_race_id = pr.id),
          'plans', (
            select jsonb_agg(
              (to_jsonb(p) - 'input_hash') || jsonb_build_object(
                'waypoints', (select jsonb_agg(to_jsonb(w) order by w.sort_order) from public.plan_waypoints w where w.race_plan_id = p.id),
                'segments', (select jsonb_agg(to_jsonb(sg)) from public.plan_segments sg where sg.race_plan_id = p.id),
                'nutrition', (
                  select jsonb_agg(
                    (to_jsonb(n) - 'input_hash') || jsonb_build_object(
                      'waypoints', (
                        select jsonb_agg(
                          to_jsonb(nw) || jsonb_build_object(
                            'items', (select jsonb_agg(to_jsonb(ni)) from public.nutrition_waypoint_items ni where ni.nutrition_waypoint_id = nw.id)
                          ) order by nw.sort_order)
                        from public.nutrition_waypoints nw where nw.nutrition_plan_id = n.id
                      ),
                      'conditions', (
                        select jsonb_agg(
                          to_jsonb(nc) || jsonb_build_object(
                            'ranges', (select jsonb_agg(to_jsonb(ncr) order by ncr.start_elapsed_seconds) from public.nutrition_condition_ranges ncr where ncr.nutrition_condition_id = nc.id)
                          ) order by nc.condition_type)
                        from public.nutrition_conditions nc where nc.nutrition_plan_id = n.id
                      )
                    ))
                  from public.nutrition_plans n where n.race_plan_id = p.id
                )
              ) order by p.version)
            from public.race_plans p where p.participant_race_id = pr.id
          ),
          'equipment', (select jsonb_agg(to_jsonb(e)) from public.participant_equipment e where e.participant_race_id = pr.id),
          'bags', (
            select jsonb_agg(to_jsonb(b) || jsonb_build_object(
              'items', (select jsonb_agg(to_jsonb(bi)) from public.bag_items bi where bi.bag_id = b.id)))
            from public.bags b where b.participant_race_id = pr.id
          ),
          'bag_suggestions_dismissed', (
            select jsonb_agg(d.suggestion_key order by d.created_at)
            from public.bag_suggestion_dismissals d where d.participant_race_id = pr.id
          ),
          'tasks', (select jsonb_agg(to_jsonb(tk)) from public.tasks tk where tk.participant_race_id = pr.id),
          'assistants', (
            select jsonb_agg(to_jsonb(a) || jsonb_build_object(
              'assignments', (
                select jsonb_agg(to_jsonb(aa) || jsonb_build_object(
                  'items', (select jsonb_agg(to_jsonb(ai)) from public.assistance_items ai where ai.assistance_assignment_id = aa.id)))
                from public.assistance_assignments aa where aa.assistant_id = a.id)))
            from public.race_assistants a where a.participant_race_id = pr.id
          ),
          'emergencyContacts', (select jsonb_agg(to_jsonb(ec)) from public.emergency_contacts ec where ec.participant_race_id = pr.id),
          'aidNotes', (select jsonb_agg(to_jsonb(an)) from public.participant_aid_notes an where an.participant_race_id = pr.id),
          'postRaceReviews', (select jsonb_agg(to_jsonb(rv)) from public.post_race_reviews rv where rv.participant_race_id = pr.id),
          'repereEstimates', (select jsonb_agg(to_jsonb(re)) from public.repere_estimates re where re.participant_race_id = pr.id),
          'importedByOrganizer', jsonb_build_object(
            'demographics', (select to_jsonb(d) from private.participant_demographics d where d.participant_race_id = pr.id),
            'performanceSignals', (select jsonb_agg(to_jsonb(ps)) from private.participant_performance_signals ps where ps.participant_race_id = pr.id)
          )
        ) order by pr.created_at)
      from public.participant_races pr where pr.id = any(v_races)
    ), '[]'::jsonb),
    'outings', coalesce((
      select jsonb_agg(to_jsonb(o) || jsonb_build_object(
        'waypoints', (select jsonb_agg(to_jsonb(ow)) from public.outing_waypoints ow where ow.outing_id = o.id),
        'equipment', (select jsonb_agg(to_jsonb(oe)) from public.outing_equipment oe where oe.outing_id = o.id),
        'feedback', (select jsonb_agg(to_jsonb(ofb)) from public.outing_feedback ofb where ofb.outing_id = o.id)
      ) order by o.created_at)
      from public.outings o where o.user_id = v_user
    ), '[]'::jsonb),
    'nutritionProducts', (select jsonb_agg(to_jsonb(np)) from public.user_nutrition_products np where np.user_id = v_user),
    'libraryTemplates', (select jsonb_agg(to_jsonb(lt)) from public.library_templates lt where lt.user_id = v_user),
    'equipmentLibrary', (select jsonb_agg(to_jsonb(ei) order by ei.label) from public.user_equipment_items ei where ei.user_id = v_user),
    'conversations', (
      select jsonb_agg(to_jsonb(c) || jsonb_build_object(
        'messages', (select jsonb_agg(to_jsonb(m) order by m.created_at) from public.pluka_messages m where m.conversation_id = c.id)))
      from public.pluka_conversations c where c.user_id = v_user
    ),
    'community', jsonb_build_object(
      'threads', (select jsonb_agg(to_jsonb(th)) from public.community_threads th where th.author_user_id = v_user),
      'posts', (select jsonb_agg(to_jsonb(po)) from public.community_posts po where po.author_user_id = v_user),
      'reactions', (select jsonb_agg(to_jsonb(cr)) from public.community_reactions cr where cr.user_id = v_user),
      'reports', (select jsonb_agg(to_jsonb(rp)) from public.community_reports rp where rp.reporter_user_id = v_user)
    ),
    'access', jsonb_build_object(
      'entitlements', (select jsonb_agg(to_jsonb(en)) from public.entitlements en where en.user_id = v_user),
      'betaAccess', (select jsonb_agg(to_jsonb(bg)) from public.beta_access_grants bg where bg.user_id = v_user),
      'purchases', (select jsonb_agg(to_jsonb(pu)) from public.purchases pu where pu.user_id = v_user),
      'usage', (select jsonb_agg(to_jsonb(us)) from public.entitlement_usage us where us.user_id = v_user)
    ),
    'repereCalibration', (select jsonb_agg(to_jsonb(rc)) from public.repere_calibration_pairs rc where rc.user_id = v_user),
    'organizations', (
      select jsonb_agg(jsonb_build_object('organizationId', m.organization_id, 'name', o.name, 'role', m.role, 'since', m.created_at))
      from public.organization_members m join public.organizations o on o.id = m.organization_id
      where m.user_id = v_user
    )
  );
end;
$$;
