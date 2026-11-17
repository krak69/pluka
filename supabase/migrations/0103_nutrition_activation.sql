-- ============================================================
-- 0103 — Nutrition : activation choisie, et rythme imposé
-- ============================================================
--
-- Décisions du 2026-11-17, prototype (`activateNut`, `nutStepConfig`) :
--
-- - La Nutrition n'est pas activée par défaut : elle n'intéresse pas tous les
--   coureurs. On l'active depuis le Plan, en réglant ses objectifs ; on peut
--   la désactiver, les réglages restent pour une réactivation. C'est la
--   stratégie Nutrition complète, au Race Pass (04 §44, vérifié dans le domaine).
-- - Le placement est « Intelligent » par défaut ; en option avancée, un
--   « rythme imposé » d'une prise toutes les N minutes (NUTRITION_ENGINE §36).
--
-- `enabled` existe depuis 0001 : `save_nutrition_settings` le remet à vrai,
-- `disable_nutrition` le passe à faux.

alter table public.nutrition_plans
  add column placement_mode text not null default 'smart'
    check (placement_mode in ('smart', 'interval')),
  add column placement_interval_minutes integer
    check (placement_interval_minutes is null or placement_interval_minutes between 10 and 120),
  add constraint nutrition_plans_interval_needs_minutes
    check (placement_mode <> 'interval' or placement_interval_minutes is not null);

drop function public.save_nutrition_settings(
  uuid, numeric, integer, integer, integer, numeric, text, boolean, text, text, text, jsonb
);

create or replace function public.save_nutrition_settings(
  p_participant_race_id uuid,
  p_carbs_g_per_hour numeric,
  p_hydration_ml_per_hour integer,
  p_sodium_mg_per_hour integer,
  p_caffeine_total_mg integer,
  p_water_share_percent numeric,
  p_placement_density text,
  p_aid_buffer boolean,
  p_placement_mode text,
  p_placement_interval_minutes integer,
  p_engine_version text,
  p_engine_config_version text,
  p_input_hash text,
  p_input_snapshot jsonb
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_race_plan_id uuid;
  v_id uuid;
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;

  select rp.id into v_race_plan_id
  from public.race_plans rp
  where rp.participant_race_id = p_participant_race_id and rp.status = 'active';

  if v_race_plan_id is null then
    raise exception 'aucun Plan actif : construire le Plan d''abord' using errcode = 'P0002';
  end if;

  insert into public.nutrition_plans (
    race_plan_id, carbs_target_g_per_hour, hydration_target_ml_per_hour,
    sodium_target_mg_per_hour, caffeine_target_total_mg, water_share_percent,
    placement_density, aid_buffer, placement_mode, placement_interval_minutes,
    engine_version, engine_config_version, enabled,
    input_hash, input_snapshot, generated_at, confirmed_at, last_recalculated_at
  )
  values (
    v_race_plan_id, p_carbs_g_per_hour, p_hydration_ml_per_hour,
    p_sodium_mg_per_hour, p_caffeine_total_mg, p_water_share_percent,
    p_placement_density, p_aid_buffer, p_placement_mode, p_placement_interval_minutes,
    p_engine_version, p_engine_config_version, true,
    p_input_hash, coalesce(p_input_snapshot, '{}'::jsonb), now(), now(), now()
  )
  on conflict (race_plan_id) where race_plan_id is not null
  do update set
    carbs_target_g_per_hour = excluded.carbs_target_g_per_hour,
    hydration_target_ml_per_hour = excluded.hydration_target_ml_per_hour,
    sodium_target_mg_per_hour = excluded.sodium_target_mg_per_hour,
    caffeine_target_total_mg = excluded.caffeine_target_total_mg,
    water_share_percent = excluded.water_share_percent,
    placement_density = excluded.placement_density,
    aid_buffer = excluded.aid_buffer,
    placement_mode = excluded.placement_mode,
    placement_interval_minutes = excluded.placement_interval_minutes,
    enabled = true,
    engine_version = excluded.engine_version,
    engine_config_version = excluded.engine_config_version,
    input_hash = excluded.input_hash,
    input_snapshot = excluded.input_snapshot,
    generated_at = now(),
    confirmed_at = now(),
    last_recalculated_at = now(),
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

/* Désactive la Nutrition de la participation ; les réglages restent pour une réactivation. */
create or replace function public.disable_nutrition(p_participant_race_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;

  update public.nutrition_plans n
  set enabled = false, updated_at = now()
  from public.race_plans rp
  where n.race_plan_id = rp.id and rp.participant_race_id = p_participant_race_id;
end;
$$;

revoke all on function public.save_nutrition_settings(
  uuid, numeric, integer, integer, integer, numeric, text, boolean, text, integer, text, text, text, jsonb
) from public, anon;
grant execute on function public.save_nutrition_settings(
  uuid, numeric, integer, integer, integer, numeric, text, boolean, text, integer, text, text, text, jsonb
) to authenticated;
revoke all on function public.disable_nutrition(uuid) from public, anon;
grant execute on function public.disable_nutrition(uuid) to authenticated;
