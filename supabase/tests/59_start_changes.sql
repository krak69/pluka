-- PLUKA — Prévenir le coureur dont l'heure de départ change
-- Référence : migration 0082

begin;

create extension if not exists pgtap;

select plan(18);

\ir _personas.psql

-- Runner A court le 80K (personas : activé, Plan actif). Runner B aussi, avec
-- un départ personnel. Une ligne importée non activée a déclaré « Vague 2 ».
insert into public.participant_races (id, race_id, user_id, status, personal_start_datetime) values
  ('ffffffff-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000013',
   '22222222-2222-4222-8222-222222222222', 'active', '2026-06-20T03:00:00Z');
insert into public.participant_races
  (id, race_id, invite_email, status, registration_source, declared_wave_name) values
  ('ffffffff-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000013',
   'importe@example.com', 'active', 'organizer_import', 'Vague 2');

create temporary table t_wave (name text, id uuid) on commit drop;
grant all on t_wave to authenticated;

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
insert into t_wave select 'Élite', public.org_declare_start_wave(
  'aaaaaaaa-0000-4000-8000-000000000013', 'Élite', '2026-06-20T04:30:00Z');
insert into t_wave select 'Vague 2', public.org_declare_start_wave(
  'aaaaaaaa-0000-4000-8000-000000000013', 'Vague 2', '2026-06-20T05:30:00Z');
reset role;

select is_empty(
  $$ select id from public.participant_start_changes $$,
  'SC-01 — une vague déclarée sans coureur activé ne prévient personne');
select is(
  (select start_wave_id from public.participant_races where id = 'ffffffff-0000-4000-8000-000000000003'),
  (select id from t_wave where name = 'Vague 2'),
  'SC-02 — la ligne importée rejoint sa vague, sans personne à prévenir');

-- L'admin met Runner A dans l'Élite.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.correct_participant_registration('aaaaaaaa-0000-4000-8000-000000000031', '101', 'Élite');
reset role;

select results_eq(
  $$ select previous_wave_name, new_wave_name, previous_start_at, new_start_at
     from public.participant_start_changes
     where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031' $$,
  $$ values (null::text, 'Élite'::text, '2026-06-20T04:00:00Z'::timestamptz,
             '2026-06-20T04:30:00Z'::timestamptz) $$,
  'SC-03 — changer un coureur de vague le prévient, avant et après');
select isnt_empty(
  $$ select o.id from private.outbox_events o
     join public.participant_start_changes c on c.id = (o.payload ->> 'startChangeId')::uuid
     where o.event_type = 'email.start_changed'
       and c.participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031' $$,
  'SC-04 — l''e-mail part dans la même transaction');

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select isnt_empty($$ select id from public.participant_start_changes $$,
  'SC-05 — le coureur lit son alerte');
reset role;
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select is_empty($$ select id from public.participant_start_changes $$,
  'SC-06 — le propriétaire de l''organisation ne la lit pas');
reset role;
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is_empty($$ select id from public.participant_start_changes $$,
  'SC-07 — un autre coureur non plus');
select throws_ok(
  $$ select public.acknowledge_start_changes('aaaaaaaa-0000-4000-8000-000000000031') $$,
  'P0002', null, 'SC-08 — ni ne la referme');
reset role;

-- Un départ personnel ne dépend pas de la vague.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.correct_participant_registration('ffffffff-0000-4000-8000-000000000002', '', 'Élite');
reset role;
select is_empty(
  $$ select id from public.participant_start_changes
     where participant_race_id = 'ffffffff-0000-4000-8000-000000000002' $$,
  'SC-09 — un coureur au départ personnel n''est pas prévenu');

-- L'heure de l'Élite change, puis son nom seul.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.org_update_start_wave((select id from t_wave where name = 'Élite'), 'Élite', '2026-06-20T05:00:00Z');
select public.org_update_start_wave((select id from t_wave where name = 'Élite'), 'Élite A', '2026-06-20T05:00:00Z');
reset role;

select results_eq(
  $$ select previous_start_at, new_start_at from public.participant_start_changes
     where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'
     order by created_at, previous_start_at offset 1 $$,
  $$ values ('2026-06-20T04:30:00Z'::timestamptz, '2026-06-20T05:00:00Z'::timestamptz) $$,
  'SC-10 — l''heure de sa vague change : il est prévenu, et un renommage seul ne le prévient pas');

select is_empty(
  $$ select o.id from private.outbox_events o
     where o.event_type like 'race.fact.%'
       and (o.payload ->> 'factKey') in (select 'start/wave/' || id::text from t_wave) $$,
  'SC-11 — aucune analyse générique : pas de second e-mail');

-- Le worker envoie le premier.
select results_eq(
  $$ select sendable, recipient_email, has_plan, attempt
     from public.worker_claim_start_change(
       (select id from public.participant_start_changes
        where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'
        order by created_at, previous_start_at limit 1)) $$,
  $$ values (true, 'runner-a@test.pluka'::text, true, 1) $$,
  'SC-12 — le worker réclame l''envoi, et sait que le coureur a un Plan');

-- Supprimer l'Élite : Runner A repart à l'heure de l'épreuve.
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.org_delete_start_wave((select id from t_wave where name = 'Élite')) $$,
  '42501', null, 'SC-13 — un éditeur ne supprime pas de vague');
reset role;

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.org_delete_start_wave((select id from t_wave where name = 'Élite'));
reset role;

select results_eq(
  $$ select previous_wave_name, new_wave_name, new_start_at from public.participant_start_changes
     where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'
       and new_wave_name is null $$,
  $$ values ('Élite A'::text, null::text, '2026-06-20T04:00:00Z'::timestamptz) $$,
  'SC-14 — sa vague supprimée, il est prévenu de repartir à l''heure de l''épreuve');
select is_empty(
  $$ select id from public.race_start_waves where name = 'Élite A' $$,
  'SC-15 — la vague a disparu');
select isnt_empty(
  $$ select f.id from public.race_facts f
     where f.fact_key = 'start/wave/' || (select id from t_wave where name = 'Élite')::text
       and f.archived_at is not null $$,
  'SC-16 — son information officielle est retirée, son historique gardé');

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(public.acknowledge_start_changes('aaaaaaaa-0000-4000-8000-000000000031'), 3,
  'SC-17 — le coureur referme ses trois alertes');
select is_empty($$ select id from public.participant_start_changes where seen_at is null $$,
  'SC-18 — plus rien à lire');
reset role;

select * from finish();
rollback;
