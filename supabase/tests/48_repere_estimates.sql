-- PLUKA — Repère PLUKA : qui lit les estimations
-- Référence : docs/engines/REPERE_PLUKA.md §6 (REP-07) · migration 0070

begin;

create extension if not exists pgtap;

select plan(6);

\ir _personas.psql

insert into auth.users (id, email) values
  ('cccccccc-1111-4111-8111-000000000001', 'repere@example.com');

insert into public.participant_races (id, race_id, user_id, status) values
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000013',
   'cccccccc-1111-4111-8111-000000000001', 'active');

select pg_temp.act_as('cccccccc-1111-4111-8111-000000000001');
select lives_ok(
  $$ insert into public.repere_estimates
       (participant_race_id, config_version, reference_kind, input, outcome,
        low_seconds, central_seconds, high_seconds)
     values ('cccccccc-0000-4000-8000-000000000001', 'repere-v0.1.0', 'effort', '{}',
             'range', 20000, 21600, 23400) $$,
  'REP-07 — le coureur enregistre son repère');
select is(
  (select count(*)::integer from public.repere_estimates
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000001'),
  1, 'REP-07 — et le relit');
select throws_ok(
  $$ update public.repere_estimates set low_seconds = 1 $$,
  '42501', null, 'REP-07 — une estimation ne se réécrit pas');
reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is_empty(
  $$ select id from public.repere_estimates $$,
  'REP-07 — un autre coureur ne la lit pas');
select throws_ok(
  $$ insert into public.repere_estimates
       (participant_race_id, config_version, reference_kind, input, outcome)
     values ('cccccccc-0000-4000-8000-000000000001', 'repere-v0.1.0', 'pace', '{}', 'too_far') $$,
  '42501', null, 'REP-07 — ni n''écrit pour lui');
reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select is_empty(
  $$ select id from public.repere_estimates $$,
  'REP-07 — le propriétaire de l''organisation ne la lit pas');
reset role;

select * from finish();
rollback;
