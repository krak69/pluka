-- ============================================================
-- 0111 — Nutrition : valider sa stratégie sur un nouveau Plan
-- ============================================================
--
-- NUTRITION_ENGINE §61 à §66, N25 à N28 ; AC-NUT-07, AC-NUT-08 ; décisions
-- du 2026-11-23.
--
-- Chaque confirmation du Plan crée une nouvelle version (`race_plans`, 0020).
-- La stratégie Nutrition restait sur l'ancienne : lisible, plus modifiable
-- (les fonctions 0104 à 0110 visent le Plan actif), et réenregistrer ses
-- objectifs en créait une neuve qui perdait sans le dire la réserve, les
-- sources, les remplissages, la boisson du ravito et les prises modifiées.
--
-- Désormais le coureur voit ce qui change, puis valide (« Appliquer au
-- nouveau Plan ») :
--
-- * `apply_nutrition_to_active_plan` recopie la stratégie sur la version
--   active, en une transaction. L'ancienne reste telle quelle : c'est
--   l'historique de la version précédente du Plan. Le diff validé est gardé
--   dans `nutrition_recalculations` (02 §15.6), au statut `applied` ; il ne
--   cite que des clés et des heures, déjà présentes dans les deux stratégies
--   que l'export du compte contient (0110).
-- * Les prises modifiées sont toutes recopiées. Celles qui gardent leur place
--   prennent leur heure sur le nouveau Plan ; celles qui n'en ont plus gardent
--   leurs produits, à replacer par le coureur (N27 : jamais supprimées sans
--   lui).
-- * `place_nutrition_orphan` porte les produits d'une prise à replacer sur une
--   prise du Plan actif, en une transaction : un nouvel essai ne double rien.

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

  -- La stratégie à reporter est la plus récente de la participation : un écran
  -- resté ouvert sur une autre ne la remplace pas.
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

  -- Les plages Chaud / Froid / Nuit n'ont encore ni écran ni écriture
  -- (tranche 4). Le jour où elles existeront, refuser vaut mieux que les
  -- perdre en silence : ce report devra les recopier.
  if exists (
    select 1 from public.nutrition_conditions c where c.nutrition_plan_id = v_from.id
  ) then
    raise exception 'conditions Nutrition non reportées' using errcode = '0A000';
  end if;

  -- Toutes les colonnes de réglage, telles quelles. Le test pgTAP 82 échoue
  -- si une colonne est ajoutée à `nutrition_plans` sans être classée ici.
  insert into public.nutrition_plans (
    race_plan_id,
    carbs_target_g_per_hour, hydration_target_ml_per_hour, sodium_target_mg_per_hour,
    caffeine_target_total_mg, reserve_percent, enabled, water_share_percent,
    placement_density, aid_buffer, placement_mode, placement_interval_minutes,
    selected_user_product_ids, flask_count, flask_capacity_ml, bladder_ml,
    no_refill_waypoint_ids, supply_start_waypoint_ids, supply_bag_waypoint_ids,
    supply_assistance_waypoint_ids, aid_drink_waypoint_ids,
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
    v_from.aid_drink_waypoint_ids,
    p_engine_version, p_engine_config_version, p_input_hash,
    coalesce(p_input_snapshot, '{}'::jsonb),
    now(), now(), now()
  )
  returning id into v_id;

  -- Les prises modifiées seulement : les autres se recalculent à la lecture.
  for v_waypoint in
    select w.*
    from public.nutrition_waypoints w
    where w.nutrition_plan_id = v_from.id and w.is_customized
    order by w.elapsed_seconds, w.stable_key
  loop
    v_order := v_order + 1;
    -- Présente dans `p_kept` : la prise garde sa place, à sa nouvelle heure.
    -- Absente : elle n'a plus de place, et reste où le coureur l'avait.
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
      -- Le lien vers un point de l'ancienne version ne vaut plus (0106).
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

revoke all on function public.apply_nutrition_to_active_plan(
  uuid, uuid, text, text, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.apply_nutrition_to_active_plan(
  uuid, uuid, text, text, text, jsonb, jsonb, jsonb
) to authenticated;

/*
 * Place les produits d'une prise qui n'a plus de place sur une prise du Plan
 * actif. Le domaine calcule la liste complète de la prise visée (ce qu'elle
 * avait, plus ce qui arrive) ; les valeurs sont recopiées depuis « Mes
 * produits » par `set_nutrition_milestone_items` (0106).
 */
create or replace function public.place_nutrition_orphan(
  p_participant_race_id uuid,
  p_orphan_key text,
  p_target_key text,
  p_label text,
  p_elapsed_seconds integer,
  p_distance_km numeric,
  p_user_product_ids uuid[],
  p_quantities integer[]
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_removed integer;
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;
  if p_orphan_key is null or p_target_key is null or p_orphan_key = p_target_key then
    raise exception 'prise invalide' using errcode = '22023';
  end if;

  -- D'abord retirer la prise à replacer : déjà placée (un second clic), elle
  -- n'existe plus, et rien n'est ajouté nulle part.
  delete from public.nutrition_waypoints w
  using public.nutrition_plans n, public.race_plans rp
  where w.nutrition_plan_id = n.id
    and n.race_plan_id = rp.id
    and rp.participant_race_id = p_participant_race_id
    and rp.status = 'active'
    and w.stable_key = p_orphan_key
    and w.is_customized;
  get diagnostics v_removed = row_count;
  if v_removed = 0 then
    raise exception 'prise à replacer introuvable' using errcode = 'P0002';
  end if;

  perform public.set_nutrition_milestone_items(
    p_participant_race_id, p_target_key, p_label, p_elapsed_seconds, p_distance_km,
    p_user_product_ids, p_quantities
  );
end;
$$;

revoke all on function public.place_nutrition_orphan(
  uuid, text, text, text, integer, numeric, uuid[], integer[]
) from public, anon;
grant execute on function public.place_nutrition_orphan(
  uuid, text, text, text, integer, numeric, uuid[], integer[]
) to authenticated;
