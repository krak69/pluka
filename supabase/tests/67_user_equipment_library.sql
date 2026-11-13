-- PLUKA — Bibliothèque : « Mon matériel »
-- Référence : migration 0092 · docs/00_PRODUCT_SPEC.md §20 · docs/03_PRIVACY_RLS.md §37
--
-- 1. Une pièce n'existe qu'une fois par coureur, à la casse près, et porte un nom.
-- 2. Elle n'appartient qu'à son coureur : ni un autre coureur, ni une organisation.
-- 3. L'export du compte la contient.

begin;

create extension if not exists pgtap;

select plan(14);

\ir _personas.psql

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

-- ============================================================
-- 1. Contenu
-- ============================================================

select lives_ok(
  $$ insert into public.user_equipment_items (id, user_id, label)
     values ('eeeeeeee-0000-4000-8000-000000000c01', '11111111-1111-4111-8111-111111111111',
             'Lunettes catégorie 3') $$,
  'le coureur ajoute une pièce à son matériel'
);

select throws_ok(
  $$ insert into public.user_equipment_items (user_id, label)
     values ('11111111-1111-4111-8111-111111111111', '  lunettes CATÉGORIE 3 ') $$,
  '23505', null, 'la même pièce, à la casse près, est refusée'
);

select throws_ok(
  $$ insert into public.user_equipment_items (user_id, label)
     values ('11111111-1111-4111-8111-111111111111', '   ') $$,
  '23514', null, 'une pièce sans nom est refusée'
);

select lives_ok(
  $$ delete from public.user_equipment_items where id = 'eeeeeeee-0000-4000-8000-000000000c01' $$,
  'le coureur retire une pièce'
);

insert into public.user_equipment_items (id, user_id, label)
values ('eeeeeeee-0000-4000-8000-000000000c02', '11111111-1111-4111-8111-111111111111', 'Bâtons');

-- ============================================================
-- Catégorie et tags (0093)
-- ============================================================

select is(
  (select category::text from public.user_equipment_items where id = 'eeeeeeee-0000-4000-8000-000000000c02'),
  'other',
  'une pièce sans catégorie est « Divers »'
);

select lives_ok(
  $$ update public.user_equipment_items set category = 'carrying', tags = array['ultra', 'hiver']
     where id = 'eeeeeeee-0000-4000-8000-000000000c02' $$,
  'le coureur classe et tague une pièce'
);

select throws_ok(
  $$ update public.user_equipment_items set tags = array['Hiver']
     where id = 'eeeeeeee-0000-4000-8000-000000000c02' $$,
  '23514', null, 'un tag hors minuscules est refusé'
);

select throws_ok(
  $$ update public.user_equipment_items set tags = array['nuit', 'nuit']
     where id = 'eeeeeeee-0000-4000-8000-000000000c02' $$,
  '23514', null, 'un tag en double est refusé'
);

select throws_ok(
  $$ update public.user_equipment_items
     set tags = array['a','b','c','d','e','f','g','h','i','j','k']
     where id = 'eeeeeeee-0000-4000-8000-000000000c02' $$,
  '23514', null, 'plus de 10 tags sont refusés'
);

-- ============================================================
-- 3. Export
-- ============================================================

select is(
  (select jsonb_array_length(public.export_my_data() -> 'equipmentLibrary')),
  1,
  'l''export du compte contient son matériel'
);

reset role;

-- ============================================================
-- 2. Propriétaire seulement
-- ============================================================

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::int from public.user_equipment_items
   where id = 'eeeeeeee-0000-4000-8000-000000000c02'),
  0,
  'un autre coureur ne voit pas son matériel'
);
select throws_ok(
  $$ insert into public.user_equipment_items (user_id, label)
     values ('11111111-1111-4111-8111-111111111111', 'Intrus') $$,
  '42501', null, 'un autre coureur ne crée rien au nom de Runner A'
);
select is(
  (select coalesce(jsonb_array_length(nullif(public.export_my_data() -> 'equipmentLibrary', 'null'::jsonb)), 0)),
  0,
  'l''export d''un autre coureur ne contient pas le matériel de Runner A'
);
reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::int from public.user_equipment_items
   where id = 'eeeeeeee-0000-4000-8000-000000000c02'),
  0,
  'le propriétaire d''une organisation ne voit pas le matériel d''un coureur'
);
reset role;

select * from finish();
rollback;
