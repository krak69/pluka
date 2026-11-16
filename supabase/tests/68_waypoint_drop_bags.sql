-- PLUKA — Drop bag autorisé, point par point
-- Référence : migration 0094 · docs/00_PRODUCT_SPEC.md §14.4 · docs/02_DATA_MODEL.md §6.6
--
-- 1. L'éditeur de l'organisation coche un drop bag sur un point intermédiaire.
-- 2. Réécrire la chaîne sans la clé le retire : la réécriture porte tout.
-- 3. Jamais au départ ni à l'arrivée, ni par la fonction ni en direct.
-- 4. Une autre organisation ne peut pas l'écrire ; le coureur le lit.

begin;

create extension if not exists pgtap;

select plan(8);

\ir _personas.psql

-- ============================================================
-- 1. Un drop bag sur un point intermédiaire
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select lives_ok(
  $$ select public.set_race_waypoints('aaaaaaaa-0000-4000-8000-000000000013', jsonb_build_array(
       jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000021', 'name', 'Départ',
                          'waypointType', 'start', 'distanceKm', 0),
       jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000022', 'name', 'Col du Test',
                          'waypointType', 'aid_station', 'distanceKm', 40, 'dropBagAllowed', true),
       jsonb_build_object('name', 'Arrivée', 'waypointType', 'finish', 'distanceKm', 80))) $$,
  'l''éditeur coche un drop bag sur un ravitaillement'
);

select results_eq(
  $$ select name, drop_bag_allowed from public.race_waypoints
     where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' order by sort_order $$,
  $$ values ('Départ', false), ('Col du Test', true), ('Arrivée', false) $$,
  'seul le point coché accepte un drop bag'
);

-- ============================================================
-- 4. Le coureur le lit, avec le reste du parcours public
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select is(
  (select drop_bag_allowed from public.race_waypoints
   where id = 'aaaaaaaa-0000-4000-8000-000000000022'),
  true,
  'le coureur voit le drop bag d''une épreuve publiée'
);

-- ============================================================
-- 2. La réécriture porte toute la chaîne
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select public.set_race_waypoints('aaaaaaaa-0000-4000-8000-000000000013', jsonb_build_array(
  jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000021', 'name', 'Départ',
                     'waypointType', 'start', 'distanceKm', 0),
  jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000022', 'name', 'Col du Test',
                     'waypointType', 'aid_station', 'distanceKm', 40),
  jsonb_build_object('name', 'Arrivée', 'waypointType', 'finish', 'distanceKm', 80)));

select is(
  (select drop_bag_allowed from public.race_waypoints
   where id = 'aaaaaaaa-0000-4000-8000-000000000022'),
  false,
  'sans la clé, le point n''accepte plus de drop bag'
);

-- ============================================================
-- 3. Jamais au départ ni à l'arrivée
-- ============================================================

select throws_ok(
  $$ select public.set_race_waypoints('aaaaaaaa-0000-4000-8000-000000000013', jsonb_build_array(
       jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000021', 'name', 'Départ',
                          'waypointType', 'start', 'distanceKm', 0, 'dropBagAllowed', true),
       jsonb_build_object('name', 'Arrivée', 'waypointType', 'finish', 'distanceKm', 80))) $$,
  '23514',
  null,
  'la fonction refuse un drop bag au départ'
);

reset role;

select throws_ok(
  $$ update public.race_waypoints set drop_bag_allowed = true
     where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and waypoint_type = 'finish' $$,
  '23514',
  null,
  'la base refuse un drop bag à l''arrivée, même en écriture directe'
);

-- ============================================================
-- 4. Une autre organisation n'écrit rien
-- ============================================================

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');

select throws_ok(
  $$ select public.set_race_waypoints('aaaaaaaa-0000-4000-8000-000000000013', jsonb_build_array(
       jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000021', 'name', 'Départ',
                          'waypointType', 'start', 'distanceKm', 0),
       jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000022', 'name', 'Col du Test',
                          'waypointType', 'aid_station', 'distanceKm', 40, 'dropBagAllowed', true),
       jsonb_build_object('name', 'Arrivée', 'waypointType', 'finish', 'distanceKm', 80))) $$,
  '42501',
  null,
  'l''owner d''une autre organisation ne coche pas de drop bag'
);

reset role;

select is(
  (select drop_bag_allowed from public.race_waypoints
   where id = 'aaaaaaaa-0000-4000-8000-000000000022'),
  false,
  'le refus n''a rien écrit'
);

select * from finish();

rollback;
