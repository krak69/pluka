-- PLUKA — Valider sa stratégie Nutrition sur un nouveau Plan
-- Référence : migration 0111 · NUTRITION_ENGINE §61 à §66, N25 à N28 ·
-- AC-NUT-07, AC-NUT-08
--
-- 1. Le Plan change : la stratégie reste sur l'ancienne version, rien ne s'y
--    écrit tant que le coureur ne l'a pas validée.
-- 2. Valider recopie tout : réglages, prises modifiées (à leur nouvelle
--    heure), prises sans place avec leurs produits ; l'ancienne reste intacte,
--    le diff est gardé, un nouvel essai ne double rien.
-- 3. Placer une prise sans place : ses produits passent sur une prise du Plan
--    actif, une seule fois.
-- 4. Un autre coureur ne valide ni ne place rien.
-- 5. Chaque colonne des tables recopiées est classée : une colonne ajoutée
--    sans décider de son report fait échouer ce test.

begin;

create extension if not exists pgtap;

select plan(20);

\ir _personas.psql

-- La stratégie de la version 1 du Plan, avec ses réglages et deux prises
-- modifiées : l'une garde sa place, l'autre n'en a plus.
update public.nutrition_plans
set reserve_percent = 10,
    flask_count = 3,
    aid_drink_waypoint_ids = array['aaaaaaaa-0000-4000-8000-000000000022']::uuid[],
    selected_user_product_ids = array['aaaaaaaa-0000-4000-8000-000000000053']::uuid[],
    generated_at = now() - interval '1 day'
where id = 'aaaaaaaa-0000-4000-8000-000000000051';

insert into public.user_nutrition_products
  (id, user_id, custom_name, custom_category, custom_carbs_g, custom_sodium_mg)
values ('cccccccc-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111',
        'Gel 25', 'gel', 25, 50);

insert into public.nutrition_waypoints
  (id, nutrition_plan_id, label, elapsed_seconds, distance_km, sort_order, origin,
   stable_key, is_customized)
values
  ('cccccccc-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000051',
   'Prise', 1800, 5.2, 2, 'generated_checkpoint', 'intake:depart:1', true),
  ('cccccccc-0000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000051',
   'Prise', 3600, 9.8, 3, 'generated_checkpoint', 'intake:depart:9', true);

insert into public.nutrition_waypoint_items
  (nutrition_waypoint_id, user_nutrition_product_id, generic_label, action, quantity,
   carbs_g, sodium_mg, is_customized)
values
  ('cccccccc-0000-4000-8000-000000000011', 'cccccccc-0000-4000-8000-0000000000c1',
   'Gel 25', 'consume', 1, 25, 50, true),
  ('cccccccc-0000-4000-8000-000000000012', 'cccccccc-0000-4000-8000-0000000000c1',
   'Gel 25', 'consume', 2, 25, 50, true);

-- Le coureur confirme une version 2 de son Plan (comme `persist_race_plan`, 0020).
update public.race_plans set status = 'superseded'
where id = 'aaaaaaaa-0000-4000-8000-000000000041';

insert into public.race_plans
  (id, participant_race_id, version, engine_version,
   initial_target_duration_seconds, target_duration_seconds)
values
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000031',
   2, 'plan-1.0.0', 43200, 46800);

-- ------------------------------------------------------------
-- 1. Avant validation
-- ------------------------------------------------------------

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.set_nutrition_milestone_items(
       'aaaaaaaa-0000-4000-8000-000000000031', 'intake:depart:1', 'Prise', 2400, 7.1,
       '{}'::uuid[], '{}'::integer[]) $$,
  'P0002',
  null,
  'avant validation, rien ne s''écrit : la stratégie est sur l''ancienne version'
);

select throws_ok(
  $$ select public.apply_nutrition_to_active_plan(
       'aaaaaaaa-0000-4000-8000-000000000031', 'cccccccc-0000-4000-8000-000000000099',
       'nutrition-1.1.0', 'nutrition-config-1.0.0', repeat('a', 64), '{}'::jsonb,
       '{}'::jsonb, '{}'::jsonb) $$,
  '22023',
  null,
  'une stratégie qui n''est pas la plus récente ne se reporte pas'
);

-- Des plages Chaud / Froid / Nuit ne sont pas encore reportées : refus, pas de perte.
reset role;
insert into public.nutrition_conditions (id, nutrition_plan_id, condition_type)
values ('cccccccc-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000051', 'hot');
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.apply_nutrition_to_active_plan(
       'aaaaaaaa-0000-4000-8000-000000000031', 'aaaaaaaa-0000-4000-8000-000000000051',
       'nutrition-1.1.0', 'nutrition-config-1.0.0', repeat('a', 64), '{}'::jsonb,
       '{}'::jsonb, '{}'::jsonb) $$,
  '0A000',
  null,
  'des conditions Nutrition empêchent le report plutôt que de se perdre'
);

reset role;
delete from public.nutrition_conditions where id = 'cccccccc-0000-4000-8000-000000000021';

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.apply_nutrition_to_active_plan(
       'aaaaaaaa-0000-4000-8000-000000000031', 'aaaaaaaa-0000-4000-8000-000000000051',
       'nutrition-1.1.0', 'nutrition-config-1.0.0', repeat('a', 64), '{}'::jsonb,
       '{}'::jsonb, '{}'::jsonb) $$,
  '42501',
  null,
  'un autre coureur ne valide pas la stratégie'
);

-- ------------------------------------------------------------
-- 2. Valider
-- ------------------------------------------------------------

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.apply_nutrition_to_active_plan(
       'aaaaaaaa-0000-4000-8000-000000000031', 'aaaaaaaa-0000-4000-8000-000000000051',
       'nutrition-1.1.0', 'nutrition-config-1.0.0', repeat('a', 64),
       '{"race_plan_id": "cccccccc-0000-4000-8000-000000000001"}'::jsonb,
       '{"intake:depart:1": {"elapsed_seconds": 2400, "distance_km": 7.1, "label": "Prise"}}'::jsonb,
       '{"kept": [{"stable_key": "intake:depart:1", "before_elapsed_seconds": 1800,
                   "after_elapsed_seconds": 2400}],
         "orphaned": ["intake:depart:9"]}'::jsonb) $$,
  'le coureur valide sa stratégie sur le nouveau Plan'
);

select is(
  (select (n.reserve_percent, n.flask_count, n.aid_drink_waypoint_ids,
           n.selected_user_product_ids, n.carbs_target_g_per_hour, n.enabled)::text
   from public.nutrition_plans n
   where n.race_plan_id = 'cccccccc-0000-4000-8000-000000000001'),
  '(10.00,3,{aaaaaaaa-0000-4000-8000-000000000022},{aaaaaaaa-0000-4000-8000-000000000053},60.00,t)',
  'réserve, flasques, boisson du ravito, produits et cibles sont reportés tels quels'
);

select is(
  (select (w.elapsed_seconds, w.distance_km, w.is_customized)::text
   from public.nutrition_waypoints w
   join public.nutrition_plans n on n.id = w.nutrition_plan_id
   where n.race_plan_id = 'cccccccc-0000-4000-8000-000000000001'
     and w.stable_key = 'intake:depart:1'),
  '(2400,7.100,t)',
  'la prise qui garde sa place prend sa nouvelle heure'
);

select is(
  (select (w.elapsed_seconds, sum(i.quantity))::text
   from public.nutrition_waypoints w
   join public.nutrition_plans n on n.id = w.nutrition_plan_id
   join public.nutrition_waypoint_items i on i.nutrition_waypoint_id = w.id
   where n.race_plan_id = 'cccccccc-0000-4000-8000-000000000001'
     and w.stable_key = 'intake:depart:9'
   group by w.elapsed_seconds),
  '(3600,2.00)',
  'N27 : la prise sans place garde ses 2 gels, là où le coureur l''avait'
);

select is(
  (select string_agg(w.stable_key || '@' || w.elapsed_seconds, ' ' order by w.stable_key)
   from public.nutrition_waypoints w
   where w.nutrition_plan_id = 'aaaaaaaa-0000-4000-8000-000000000051' and w.is_customized),
  'intake:depart:1@1800 intake:depart:9@3600',
  'la stratégie de l''ancienne version reste intacte'
);

select is(
  (select r.status || ':' || r.trigger_reason || ':' || (r.diff_payload -> 'orphaned')::text
   from public.nutrition_recalculations r
   join public.nutrition_plans n on n.id = r.nutrition_plan_id
   where n.race_plan_id = 'cccccccc-0000-4000-8000-000000000001'),
  'applied:plan_changed:["intake:depart:9"]',
  'le diff validé est gardé'
);

select is(
  public.apply_nutrition_to_active_plan(
    'aaaaaaaa-0000-4000-8000-000000000031', 'aaaaaaaa-0000-4000-8000-000000000051',
    'nutrition-1.1.0', 'nutrition-config-1.0.0', repeat('a', 64), '{}'::jsonb,
    '{}'::jsonb, '{}'::jsonb),
  (select n.id from public.nutrition_plans n
   where n.race_plan_id = 'cccccccc-0000-4000-8000-000000000001'),
  'un nouvel essai rend la stratégie déjà validée'
);

select is(
  (select count(*)::int from public.nutrition_plans n
   where n.race_plan_id = 'cccccccc-0000-4000-8000-000000000001')
  + (select count(*)::int from public.nutrition_recalculations),
  2,
  'sans rien doubler : une stratégie, un diff'
);

-- ------------------------------------------------------------
-- 3. Placer la prise sans place
-- ------------------------------------------------------------

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.place_nutrition_orphan(
       'aaaaaaaa-0000-4000-8000-000000000031', 'intake:depart:9', 'intake:depart:2',
       'Prise', 3000, 8.0, array['cccccccc-0000-4000-8000-0000000000c1']::uuid[], array[2]) $$,
  '42501',
  null,
  'un autre coureur ne place pas la prise'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.place_nutrition_orphan(
       'aaaaaaaa-0000-4000-8000-000000000031', 'intake:depart:9', 'intake:depart:9',
       'Prise', 3000, 8.0, '{}'::uuid[], '{}'::integer[]) $$,
  '22023',
  null,
  'une prise ne se place pas sur elle-même'
);

select lives_ok(
  $$ select public.place_nutrition_orphan(
       'aaaaaaaa-0000-4000-8000-000000000031', 'intake:depart:9', 'intake:depart:2',
       'Prise', 3000, 8.0, array['cccccccc-0000-4000-8000-0000000000c1']::uuid[], array[2]) $$,
  'le coureur place les gels sur une prise du nouveau Plan'
);

select is(
  (select string_agg(w.stable_key || '=' || coalesce((
             select sum(i.quantity)::text from public.nutrition_waypoint_items i
             where i.nutrition_waypoint_id = w.id), '0'), ' ' order by w.stable_key)
   from public.nutrition_waypoints w
   join public.nutrition_plans n on n.id = w.nutrition_plan_id
   where n.race_plan_id = 'cccccccc-0000-4000-8000-000000000001'),
  'intake:depart:1=1.00 intake:depart:2=2.00',
  'les gels sont sur la prise choisie, la prise sans place a disparu'
);

select throws_ok(
  $$ select public.place_nutrition_orphan(
       'aaaaaaaa-0000-4000-8000-000000000031', 'intake:depart:9', 'intake:depart:2',
       'Prise', 3000, 8.0, array['cccccccc-0000-4000-8000-0000000000c1']::uuid[], array[2]) $$,
  'P0002',
  null,
  'un second clic ne double rien'
);

-- ------------------------------------------------------------
-- 4. Chaque colonne recopiée est classée (0111)
-- ------------------------------------------------------------

reset role;

select is(
  (select array_agg(c.column_name::text order by c.column_name::text collate "C")
   from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'nutrition_plans'),
  array[
    'aid_buffer', 'aid_drink_waypoint_ids', 'bladder_ml', 'caffeine_target_total_mg',
    'carbs_target_g_per_hour', 'confirmed_at', 'created_at', 'enabled',
    'engine_config_version', 'engine_version', 'flask_capacity_ml', 'flask_count',
    'generated_at', 'hydration_target_ml_per_hour', 'id', 'input_hash', 'input_snapshot',
    'last_recalculated_at', 'no_refill_waypoint_ids', 'outing_id', 'placement_density',
    'placement_interval_minutes', 'placement_mode', 'race_plan_id', 'reserve_percent',
    'selected_user_product_ids', 'sodium_target_mg_per_hour',
    'supply_assistance_waypoint_ids', 'supply_bag_waypoint_ids', 'supply_start_waypoint_ids',
    'updated_at', 'water_share_percent'
  ],
  'nutrition_plans : une colonne nouvelle doit être reportée par apply_nutrition_to_active_plan, ou écartée exprès'
);

select is(
  (select array_agg(c.column_name::text order by c.column_name::text collate "C")
   from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'nutrition_waypoints'),
  array[
    'created_at', 'distance_km', 'elapsed_seconds', 'id', 'is_customized', 'is_locked',
    'label', 'latitude', 'longitude', 'nutrition_plan_id', 'origin', 'outing_waypoint_id',
    'plan_waypoint_id', 'planned_at', 'route_altitude_m', 'sort_order', 'stable_key'
  ],
  'nutrition_waypoints : une colonne nouvelle doit être reportée, ou écartée exprès'
);

select is(
  (select array_agg(c.column_name::text order by c.column_name::text collate "C")
   from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'nutrition_waypoint_items'),
  array[
    'action', 'caffeine_mg', 'carbs_g', 'created_at', 'estimated', 'generic_label',
    'hydration_ml', 'id', 'is_customized', 'nutrition_waypoint_id', 'product_label_snapshot',
    'product_snapshot', 'quantity', 'sodium_mg', 'unit', 'user_nutrition_product_id'
  ],
  'nutrition_waypoint_items : une colonne nouvelle doit être reportée, ou écartée exprès'
);

select * from finish();

rollback;
