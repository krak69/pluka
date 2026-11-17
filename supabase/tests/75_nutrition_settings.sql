-- PLUKA — Nutrition, tranche 1 : cibles et placement
-- Référence : migration 0102 · NUTRITION_ENGINE §10, §35, §84 · AGENTS §19
--
-- 1. Le coureur enregistre ses cibles sur son Plan actif ; un second
--    enregistrement met à jour la même ligne.
-- 2. Les réglages sont bornés.
-- 3. Un autre coureur n'écrit rien ; l'organisation ne lit rien.

begin;

create extension if not exists pgtap;

select plan(11);

\ir _personas.psql

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.save_nutrition_settings(
       'aaaaaaaa-0000-4000-8000-000000000031', 70, 600, 500, 200, 40, 'frequent', false, 'smart', null,
       'nutrition-1.0.0', 'nutrition-config-1.0.0', repeat('c', 64), '{}'::jsonb) $$,
  'le coureur enregistre ses cibles sur son Plan actif'
);

select results_eq(
  $$ select carbs_target_g_per_hour::int, water_share_percent::int, placement_density, aid_buffer,
            caffeine_target_total_mg
     from public.nutrition_plans where race_plan_id = 'aaaaaaaa-0000-4000-8000-000000000041' $$,
  $$ values (70, 40, 'frequent'::text, false, 200) $$,
  'la ligne du Plan actif porte les nouvelles cibles'
);

select is(
  (select count(*)::int from public.nutrition_plans
   where race_plan_id = 'aaaaaaaa-0000-4000-8000-000000000041'),
  1,
  'une seule stratégie par version du Plan'
);

select throws_ok(
  $$ select public.save_nutrition_settings(
       'aaaaaaaa-0000-4000-8000-000000000031', 70, 600, 500, null, 140, 'auto', true, 'smart', null,
       'nutrition-1.0.0', 'nutrition-config-1.0.0', repeat('c', 64), '{}'::jsonb) $$,
  '23514',
  null,
  'une part d''eau au-delà de 100 % est refusée'
);

select throws_ok(
  $$ select public.save_nutrition_settings(
       'aaaaaaaa-0000-4000-8000-000000000031', 70, 600, 500, null, 50, 'toutes-les-5-min', true, 'smart', null,
       'nutrition-1.0.0', 'nutrition-config-1.0.0', repeat('c', 64), '{}'::jsonb) $$,
  '23514',
  null,
  'une densité inconnue est refusée'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.save_nutrition_settings(
       'aaaaaaaa-0000-4000-8000-000000000031', 10, 10, 10, null, 50, 'auto', true, 'smart', null,
       'nutrition-1.0.0', 'nutrition-config-1.0.0', repeat('c', 64), '{}'::jsonb) $$,
  '42501',
  null,
  'un autre coureur n''écrit pas la stratégie'
);

select is_empty(
  $$ select id from public.nutrition_plans $$,
  'un autre coureur ne lit aucune stratégie'
);

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is_empty(
  $$ select id from public.nutrition_plans $$,
  'l''owner de l''organisation ne lit pas la Nutrition (AGENTS §19)'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.disable_nutrition('aaaaaaaa-0000-4000-8000-000000000031') $$,
  '42501',
  null,
  'un autre coureur ne désactive pas la Nutrition'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.disable_nutrition('aaaaaaaa-0000-4000-8000-000000000031') $$,
  'le coureur désactive sa Nutrition'
);

select is(
  (select bool_or(enabled) from public.nutrition_plans
   where race_plan_id = 'aaaaaaaa-0000-4000-8000-000000000041'),
  false,
  'désactivée, ses réglages restent'
);

select * from finish();

rollback;
