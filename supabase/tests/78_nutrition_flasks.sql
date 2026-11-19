-- PLUKA — Contenants portés et points de remplissage
-- Référence : migration 0107 · NUTRITION_ENGINE §33, §34
--
-- 1. Le coureur règle ses contenants ; des bornes absurdes sont refusées.
-- 2. « Je ne remplis pas ici » vaut pour un point de sa course, pas d'une autre.
-- 3. Un autre coureur ne touche à rien.

begin;

create extension if not exists pgtap;

select plan(8);

\ir _personas.psql

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.set_nutrition_containers('aaaaaaaa-0000-4000-8000-000000000031', 1, 600, 1500) $$,
  'le coureur règle ses contenants'
);

select is(
  (select (flask_count, flask_capacity_ml, bladder_ml)::text from public.nutrition_plans
   where race_plan_id = 'aaaaaaaa-0000-4000-8000-000000000041'),
  '(1,600,1500)',
  'les contenants sont retenus'
);

select throws_ok(
  $$ select public.set_nutrition_containers('aaaaaaaa-0000-4000-8000-000000000031', 9, 500, null) $$,
  '23514',
  null,
  'un nombre de flasques absurde est refusé'
);

select lives_ok(
  $$ select public.set_nutrition_refill_point('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000022', false) $$,
  'le coureur dit qu''il ne remplit pas à un ravito de sa course'
);

select is(
  (select no_refill_waypoint_ids from public.nutrition_plans
   where race_plan_id = 'aaaaaaaa-0000-4000-8000-000000000041'),
  array['aaaaaaaa-0000-4000-8000-000000000022']::uuid[],
  'le ravito est retenu, une seule fois'
);

select throws_ok(
  $$ select public.set_nutrition_refill_point('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000023', false) $$,
  '42501',
  null,
  'un point d''une autre course est refusé'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.set_nutrition_containers('aaaaaaaa-0000-4000-8000-000000000031', 2, 500, null) $$,
  '42501',
  null,
  'un autre coureur ne règle pas les contenants'
);

select throws_ok(
  $$ select public.set_nutrition_refill_point('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000022', true) $$,
  '42501',
  null,
  'un autre coureur ne touche pas aux points de remplissage'
);

select * from finish();

rollback;
