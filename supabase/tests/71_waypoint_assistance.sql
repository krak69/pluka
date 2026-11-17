-- PLUKA — Assistance autorisée, point par point
-- Référence : migration 0098 · AC-ASST-03 · docs/02_DATA_MODEL.md §6.6
--
-- 1. L'éditeur de l'organisation coche l'assistance sur un point intermédiaire.
-- 2. Jamais au départ ni à l'arrivée, ni par la fonction ni en direct.
-- 3. Un rendez-vous d'assistance ne se pose qu'à un point autorisé de sa course.
-- 4. Un sac d'assistance suit la même règle.

begin;

create extension if not exists pgtap;

select plan(8);

\ir _personas.psql

-- ============================================================
-- 1. L'assistance, sur un point intermédiaire
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select lives_ok(
  $$ select public.set_race_waypoints('aaaaaaaa-0000-4000-8000-000000000013', jsonb_build_array(
       jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000021', 'name', 'Départ',
                          'waypointType', 'start', 'distanceKm', 0),
       jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000022', 'name', 'Col du Test',
                          'waypointType', 'aid_station', 'distanceKm', 40, 'assistanceAllowed', true),
       jsonb_build_object('name', 'Lac', 'waypointType', 'checkpoint', 'distanceKm', 60),
       jsonb_build_object('name', 'Arrivée', 'waypointType', 'finish', 'distanceKm', 80))) $$,
  'l''éditeur autorise l''assistance sur un ravitaillement'
);

select results_eq(
  $$ select name, assistance_allowed from public.race_waypoints
     where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' order by sort_order $$,
  $$ values ('Départ', false), ('Col du Test', true), ('Lac', false), ('Arrivée', false) $$,
  'seul le point coché autorise l''assistance'
);

-- ============================================================
-- 2. Jamais au départ ni à l'arrivée
-- ============================================================

select throws_ok(
  $$ select public.set_race_waypoints('aaaaaaaa-0000-4000-8000-000000000013', jsonb_build_array(
       jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000021', 'name', 'Départ',
                          'waypointType', 'start', 'distanceKm', 0, 'assistanceAllowed', true),
       jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000022', 'name', 'Col du Test',
                          'waypointType', 'aid_station', 'distanceKm', 40, 'assistanceAllowed', true),
       jsonb_build_object('name', 'Arrivée', 'waypointType', 'finish', 'distanceKm', 80))) $$,
  '23514',
  null,
  'la fonction refuse l''assistance au départ'
);

reset role;

select throws_ok(
  $$ update public.race_waypoints set assistance_allowed = true
     where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and waypoint_type = 'finish' $$,
  '23514',
  null,
  'la base refuse l''assistance à l''arrivée, même en écriture directe'
);

-- ============================================================
-- 3. Un rendez-vous, seulement à un point autorisé
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ insert into public.assistance_assignments (assistant_id, race_waypoint_id)
     select 'aaaaaaaa-0000-4000-8000-000000000061', id from public.race_waypoints
     where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and name = 'Lac' $$,
  '23514',
  null,
  'le coureur ne pose pas de rendez-vous là où l''assistance n''est pas autorisée'
);

select throws_ok(
  $$ update public.assistance_assignments
     set race_waypoint_id = 'aaaaaaaa-0000-4000-8000-000000000023'
     where id = 'aaaaaaaa-0000-4000-8000-000000000062' $$,
  '23514',
  null,
  'ni à un point d''une autre course'
);

select lives_ok(
  $$ update public.assistance_assignments set instructions = 'Au parking du haut'
     where id = 'aaaaaaaa-0000-4000-8000-000000000062' $$,
  'le rendez-vous à un point autorisé se modifie'
);

-- ============================================================
-- 4. Un sac d'assistance suit la même règle
-- ============================================================

select throws_ok(
  $$ insert into public.bags (participant_race_id, bag_type, name, race_waypoint_id)
     select 'aaaaaaaa-0000-4000-8000-000000000031', 'assistance', 'Sac du lac', id
     from public.race_waypoints
     where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and name = 'Lac' $$,
  '23514',
  null,
  'pas de sac d''assistance là où l''assistance n''est pas autorisée'
);

select * from finish();

rollback;
