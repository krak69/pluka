-- PLUKA — Ligne d'adoption de l'organisation
-- Référence : migration 0080, 03_PRIVACY_RLS §70

begin;

create extension if not exists pgtap;

select plan(8);

\ir _personas.psql

-- Sur l'épreuve 80K : Runner A, activé, avec Plan, Nutrition et assistant
-- (personas) ; deux lignes importées non activées, dont une retirée.
insert into public.participant_races (race_id, invite_email, status, registration_source) values
  ('aaaaaaaa-0000-4000-8000-000000000013', 'importe@example.com', 'active', 'organizer_import'),
  ('aaaaaaaa-0000-4000-8000-000000000013', 'retire@example.com', 'archived', 'organizer_import');

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select results_eq(
  $$ select registered, activated, with_plan, with_nutrition, with_assistance
     from public.org_race_adoption('aaaaaaaa-0000-4000-8000-000000000012')
     where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' $$,
  $$ values (2, 1, null::integer, null::integer, null::integer) $$,
  'ADOPT-01 — sous 10 activés, aucun chiffre de préparation ; le retiré n''est pas compté');
select results_eq(
  $$ select registered, activated from public.org_race_adoption('aaaaaaaa-0000-4000-8000-000000000012')
     where race_id = 'aaaaaaaa-0000-4000-8000-000000000014' $$,
  $$ values (0, 0) $$,
  'ADOPT-02 — une épreuve sans inscrit apparaît, à zéro');
reset role;

-- Neuf coureurs de plus s'activent, sans rien préparer : 10 activés.
insert into auth.users (id, email)
select ('dddddddd-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'adopt' || n || '@example.com'
from generate_series(1, 9) n;
insert into public.participant_races (race_id, user_id, status)
select 'aaaaaaaa-0000-4000-8000-000000000013',
       ('dddddddd-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'active'
from generate_series(1, 9) n;

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select results_eq(
  $$ select activated, with_plan, with_nutrition, with_assistance
     from public.org_race_adoption('aaaaaaaa-0000-4000-8000-000000000012')
     where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' $$,
  $$ values (10, 1, 1, 1) $$,
  'ADOPT-03 — à 10 activés, les chiffres apparaissent');
select is(
  (select count(*)::integer from public.org_race_adoption('aaaaaaaa-0000-4000-8000-000000000012')),
  2,
  'ADOPT-04 — une ligne par épreuve, aucune par coureur');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select * from public.org_race_adoption('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'ADOPT-05 — une autre organisation est refusée');
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select * from public.org_race_adoption('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'ADOPT-06 — un coureur est refusé');
reset role;

select pg_temp.act_as_anon();
select throws_ok(
  $$ select * from public.org_race_adoption('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'ADOPT-07 — sans session, rien');
reset role;

select function_returns('public', 'org_race_adoption', array['uuid'], 'setof record',
  'ADOPT-08 — la fonction ne rend que des compteurs');

select * from finish();
rollback;
