-- PLUKA — Produits d'une prise choisis par le coureur
-- Référence : migration 0106 · NUTRITION_ENGINE §57, §58
--
-- 1. Le coureur fixe les produits d'une prise : valeurs recopiées par la base.
-- 2. Un autre coureur ne lit ni n'écrit rien ; un produit d'autrui est refusé.
-- 3. Revenir à la proposition PLUKA efface la prise personnalisée.

begin;

create extension if not exists pgtap;

select plan(9);

\ir _personas.psql

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

insert into public.user_nutrition_products
  (id, user_id, custom_name, custom_category, custom_carbs_g, custom_sodium_mg)
values ('bbbbbbbb-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111',
        'Gel maison', 'gel', 30, 120);

select lives_ok(
  $$ select public.set_nutrition_milestone_items(
       'aaaaaaaa-0000-4000-8000-000000000031', 'intake:depart:1', 'Prise', 1800, 5.2,
       array['bbbbbbbb-0000-4000-8000-0000000000c1']::uuid[], array[2]) $$,
  'le coureur fixe les produits d''une prise'
);

select is(
  (select (i.quantity, i.carbs_g, i.sodium_mg, i.is_customized)::text
   from public.nutrition_waypoint_items i
   join public.nutrition_waypoints w on w.id = i.nutrition_waypoint_id
   where w.stable_key = 'intake:depart:1'),
  '(2.00,30.00,120,t)',
  'quantité gardée, valeurs par portion recopiées depuis « Mes produits »'
);

select lives_ok(
  $$ select public.set_nutrition_milestone_items(
       'aaaaaaaa-0000-4000-8000-000000000031', 'intake:depart:1', 'Prise', 1800, 5.2,
       '{}'::uuid[], '{}'::integer[]) $$,
  'une liste vide : rien à cette prise, et elle reste personnalisée'
);

select is(
  (select count(*)::int from public.nutrition_waypoint_items i
   join public.nutrition_waypoints w on w.id = i.nutrition_waypoint_id
   where w.stable_key = 'intake:depart:1'),
  0,
  'les anciens produits de la prise sont remplacés'
);

select throws_ok(
  $$ select public.set_nutrition_milestone_items(
       'aaaaaaaa-0000-4000-8000-000000000031', 'intake:depart:1', 'Prise', 1800, 5.2,
       array['bbbbbbbb-0000-4000-8000-0000000000c1']::uuid[], array[9]) $$,
  '22023',
  null,
  'une quantité hors bornes est refusée'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is_empty(
  $$ select id from public.nutrition_waypoints where stable_key = 'intake:depart:1' $$,
  'un autre coureur ne voit pas la prise personnalisée'
);

select throws_ok(
  $$ select public.set_nutrition_milestone_items(
       'aaaaaaaa-0000-4000-8000-000000000031', 'intake:depart:1', 'Prise', 1800, 5.2,
       '{}'::uuid[], '{}'::integer[]) $$,
  '42501',
  null,
  'un autre coureur ne modifie pas la prise'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.reset_nutrition_milestone('aaaaaaaa-0000-4000-8000-000000000031',
                                             'intake:depart:1') $$,
  'le coureur revient à la proposition PLUKA'
);

select is_empty(
  $$ select id from public.nutrition_waypoints where stable_key = 'intake:depart:1' $$,
  'la prise personnalisée est effacée'
);

select * from finish();

rollback;
