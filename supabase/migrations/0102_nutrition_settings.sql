-- ============================================================
-- 0102 — Nutrition, tranche 1 : cibles et placement des prises
-- ============================================================
--
-- NUTRITION_ENGINE §10, §35, §37, §79, §82 ; décisions du 2026-11-17.
--
-- Le coureur fixe ses cibles horaires ; PLUKA les répartit sur son Plan.
-- La tranche 1 enregistre les cibles et les réglages de placement ; les prises
-- et les sections se recalculent à la lecture, par le moteur pur, depuis le
-- Plan actif (aucune n'est encore personnalisable). Les produits, la
-- personnalisation et le diff viendront avec `nutrition_waypoints` et
-- `nutrition_recalculations` (tranches 2 et 5).
--
-- Écriture : par une fonction, comme le Plan (0020) — `nutrition_plans` n'a
-- qu'une policy de lecture (0005). Propriété vérifiée ici ; le droit
-- commercial (`nutrition.edit`, Race Pass) l'est dans le domaine.

alter table public.nutrition_plans
  add column water_share_percent numeric(5,2) not null default 50
    check (water_share_percent >= 0 and water_share_percent <= 100),
  add column placement_density text not null default 'auto'
    check (placement_density in ('frequent', 'auto', 'sparse')),
  add column aid_buffer boolean not null default true;

comment on column public.nutrition_plans.water_share_percent is
  'Part de l''hydratation en eau pure ; le reste en boisson d''effort (0102).';
comment on column public.nutrition_plans.placement_density is
  'Densité des prises en mode Smart — réglage d''ergonomie, pas une recommandation (NUTRITION_ENGINE §35).';
comment on column public.nutrition_plans.aid_buffer is
  'Pas de prise juste avant un ravitaillement (§35.7).';

/*
 * Enregistre les cibles et le placement sur le Plan actif de la participation.
 * Une ligne par version de Plan (`ux_nutrition_plan_race_plan`, 0001).
 */
create or replace function public.save_nutrition_settings(
  p_participant_race_id uuid,
  p_carbs_g_per_hour numeric,
  p_hydration_ml_per_hour integer,
  p_sodium_mg_per_hour integer,
  p_caffeine_total_mg integer,
  p_water_share_percent numeric,
  p_placement_density text,
  p_aid_buffer boolean,
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
    placement_density, aid_buffer, engine_version, engine_config_version,
    input_hash, input_snapshot, generated_at, confirmed_at, last_recalculated_at
  )
  values (
    v_race_plan_id, p_carbs_g_per_hour, p_hydration_ml_per_hour,
    p_sodium_mg_per_hour, p_caffeine_total_mg, p_water_share_percent,
    p_placement_density, p_aid_buffer, p_engine_version, p_engine_config_version,
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

revoke all on function public.save_nutrition_settings(
  uuid, numeric, integer, integer, integer, numeric, text, boolean, text, text, text, jsonb
) from public, anon;
grant execute on function public.save_nutrition_settings(
  uuid, numeric, integer, integer, integer, numeric, text, boolean, text, text, text, jsonb
) to authenticated;
