-- PLUKA — Ma course : qui lit les informations, qui les change
-- Référence : migration 0057 · docs/00_PRODUCT_SPEC.md §28.1
--
-- 1. Tout membre de l'organisation lit, viewer compris.
-- 2. Un viewer ne corrige rien.
-- 3. Hors de l'organisation : refusé.

begin;

create extension if not exists pgtap;

select plan(6);

\ir _personas.psql

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select lives_ok(
  $$ select public.list_race_facts_for_editing('aaaaaaaa-0000-4000-8000-000000000013') $$,
  'COURSE-01 — viewer : lit les informations de sa course');
select throws_ok(
  $$ select public.retire_race_fact(
       (select id from public.race_facts where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' limit 1), null) $$,
  '42501', null, 'COURSE-02 — viewer : ne retire rien');
reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select lives_ok(
  $$ select public.list_race_facts_for_editing('aaaaaaaa-0000-4000-8000-000000000013') $$,
  'COURSE-03 — éditeur : lit');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.list_race_facts_for_editing('aaaaaaaa-0000-4000-8000-000000000013') $$,
  '42501', null, 'COURSE-04 — owner d''une autre organisation : refusé');
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.list_race_facts_for_editing('aaaaaaaa-0000-4000-8000-000000000013') $$,
  '42501', null, 'COURSE-05 — coureur : refusé');
reset role;

select pg_temp.act_as_anon();
select throws_ok(
  $$ select public.list_race_facts_for_editing('aaaaaaaa-0000-4000-8000-000000000013') $$,
  '42501', null, 'COURSE-06 — anonyme : refusé');
reset role;

select * from finish();
rollback;
