-- PLUKA — Repère PLUKA : couples de calibrage et échantillons anonymes
-- Référence : docs/engines/REPERE_PLUKA.md §5, §6 · migration 0074

begin;

create extension if not exists pgtap;

select plan(8);

\ir _personas.psql

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ insert into public.repere_calibration_pairs
       (user_id, reference_distance_km, reference_elevation_gain_m, reference_duration_seconds,
        reference_date, course_distance_km, course_elevation_gain_m, course_duration_seconds,
        course_date)
     values ('11111111-1111-4111-8111-111111111111', 20, 800, 9000, '2026-03-01',
             42, 1800, 21000, '2026-05-15') $$,
  'CAL-01 — le coureur donne un couple');
select throws_ok(
  $$ insert into public.repere_calibration_pairs
       (user_id, reference_distance_km, reference_elevation_gain_m, reference_duration_seconds,
        reference_date, course_distance_km, course_elevation_gain_m, course_duration_seconds,
        course_date)
     values ('22222222-2222-4222-8222-222222222222', 20, 800, 9000, '2026-03-01',
             42, 1800, 21000, '2026-05-15') $$,
  '42501', null, 'CAL-02 — pas au nom d''un autre');
select throws_ok(
  $$ insert into public.repere_calibration_pairs
       (user_id, reference_distance_km, reference_elevation_gain_m, reference_duration_seconds,
        reference_date, course_distance_km, course_elevation_gain_m, course_duration_seconds,
        course_date)
     values ('11111111-1111-4111-8111-111111111111', 20, 800, 9000, '2026-06-01',
             42, 1800, 21000, '2026-05-15') $$,
  '23514', null, 'CAL-03 — la référence précède la course');
reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is_empty($$ select id from public.repere_calibration_pairs $$,
  'CAL-04 — un autre coureur ne lit pas les couples');
reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ select * from public.admin_repere_calibration_samples() $$,
  '42501', null, 'CAL-05 — une organisation ne lit pas les échantillons');
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select is(
  (select count(*)::integer from public.admin_repere_calibration_samples() where source = 'declared'),
  1, 'CAL-06 — PLUKA lit les échantillons');
select is(
  (select months_before from public.admin_repere_calibration_samples() where source = 'declared'),
  2, 'CAL-07 — l''écart en mois remplace les dates');
select hasnt_column('public', 'repere_calibration_pairs', 'race_id',
  'CAL-08 — un couple ne nomme aucune course');
reset role;

select * from finish();
rollback;
