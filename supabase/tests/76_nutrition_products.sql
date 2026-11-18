-- PLUKA — « Mes produits » et produits d'une stratégie
-- Référence : migration 0104 · NUTRITION_ENGINE §26, §27, §84
--
-- 1. Un produit personnel a un type ; un produit du catalogue s'ajoute tel quel.
-- 2. Une stratégie ne retient que des produits du coureur.
-- 3. Un autre coureur ne voit ni ne choisit rien.

begin;

create extension if not exists pgtap;

select plan(7);

\ir _personas.psql

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ insert into public.user_nutrition_products (user_id, custom_name, custom_carbs_g)
     values ('11111111-1111-4111-8111-111111111111', 'Sans type', 20) $$,
  '23514',
  null,
  'un produit personnel sans type est refusé'
);

select lives_ok(
  $$ insert into public.user_nutrition_products
       (id, user_id, custom_name, custom_category, custom_carbs_g)
     values ('bbbbbbbb-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
             'Purée maison', 'puree', 20) $$,
  'le coureur crée un produit personnel typé'
);

select lives_ok(
  $$ select public.set_nutrition_products('aaaaaaaa-0000-4000-8000-000000000031',
       array['bbbbbbbb-0000-4000-8000-0000000000a1']::uuid[]) $$,
  'le coureur choisit ses produits pour sa stratégie'
);

select is(
  (select selected_user_product_ids from public.nutrition_plans
   where race_plan_id = 'aaaaaaaa-0000-4000-8000-000000000041'),
  array['bbbbbbbb-0000-4000-8000-0000000000a1']::uuid[],
  'la stratégie retient la sélection'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is_empty(
  $$ select id from public.user_nutrition_products $$,
  'un autre coureur ne voit pas « Mes produits »'
);

select throws_ok(
  $$ select public.set_nutrition_products('aaaaaaaa-0000-4000-8000-000000000031',
       array['bbbbbbbb-0000-4000-8000-0000000000a1']::uuid[]) $$,
  '42501',
  null,
  'un autre coureur ne touche pas à la sélection'
);

reset role;
insert into public.user_nutrition_products (id, user_id, custom_name, custom_category)
values ('bbbbbbbb-0000-4000-8000-0000000000b2', '22222222-2222-4222-8222-222222222222',
        'Gel de B', 'gel');

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.set_nutrition_products('aaaaaaaa-0000-4000-8000-000000000031',
       array['bbbbbbbb-0000-4000-8000-0000000000b2']::uuid[]) $$,
  '42501',
  null,
  'le produit d''un autre coureur ne se choisit pas'
);

select * from finish();

rollback;
