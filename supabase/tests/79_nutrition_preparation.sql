-- PLUKA — « À préparer pour cette course » : réserve et sources par point
-- Référence : migration 0108 · NUTRITION_ENGINE §49 à §56
--
-- 1. Le coureur règle sa réserve ; hors de 0 à 100 %, c'est refusé.
-- 2. Il choisit d'où viennent ses produits à un ravitaillement de sa course :
--    un point ne figure que dans une liste, et nul ramène l'automatique.
-- 3. Une source inconnue, un point d'une autre course, un autre coureur : refusés.

begin;

create extension if not exists pgtap;

select plan(12);

\ir _personas.psql

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.set_nutrition_reserve('aaaaaaaa-0000-4000-8000-000000000031', 10) $$,
  'le coureur règle sa réserve'
);

select is(
  (select reserve_percent from public.nutrition_plans
   where race_plan_id = 'aaaaaaaa-0000-4000-8000-000000000041'),
  10.00::numeric,
  'la réserve est retenue'
);

select throws_ok(
  $$ select public.set_nutrition_reserve('aaaaaaaa-0000-4000-8000-000000000031', 150) $$,
  '23514',
  null,
  'une réserve au-delà de 100 % est refusée'
);

select lives_ok(
  $$ select public.set_nutrition_supply_point('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000022', 'bag') $$,
  'le coureur dit que ses produits viennent du drop bag'
);

select lives_ok(
  $$ select public.set_nutrition_supply_point('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000022', 'assistance') $$,
  'puis de l''Assistance'
);

select is(
  (select (supply_start_waypoint_ids, supply_bag_waypoint_ids, supply_assistance_waypoint_ids)::text
   from public.nutrition_plans
   where race_plan_id = 'aaaaaaaa-0000-4000-8000-000000000041'),
  '({},{},{aaaaaaaa-0000-4000-8000-000000000022})',
  'le point ne figure que dans la dernière liste choisie'
);

select lives_ok(
  $$ select public.set_nutrition_supply_point('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000022', null) $$,
  'nul ramène le choix automatique'
);

select is(
  (select cardinality(supply_start_waypoint_ids) + cardinality(supply_bag_waypoint_ids)
          + cardinality(supply_assistance_waypoint_ids)
   from public.nutrition_plans
   where race_plan_id = 'aaaaaaaa-0000-4000-8000-000000000041'),
  0,
  'plus aucun choix retenu'
);

select throws_ok(
  $$ select public.set_nutrition_supply_point('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000022', 'poche') $$,
  '22023',
  null,
  'une source inconnue est refusée'
);

select throws_ok(
  $$ select public.set_nutrition_supply_point('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000023', 'bag') $$,
  '42501',
  null,
  'un point d''une autre course est refusé'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.set_nutrition_reserve('aaaaaaaa-0000-4000-8000-000000000031', 20) $$,
  '42501',
  null,
  'un autre coureur ne règle pas la réserve'
);

select throws_ok(
  $$ select public.set_nutrition_supply_point('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000022', 'start') $$,
  '42501',
  null,
  'un autre coureur ne choisit pas d''où viennent les produits'
);

select * from finish();

rollback;
