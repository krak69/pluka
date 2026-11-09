-- PLUKA — Durées de conservation : la purge
-- Référence : migration 0077

begin;

create extension if not exists pgtap;

select plan(7);

\ir _personas.psql

-- L'édition des personas a lieu le 2026-06-20 : la purge du 2027-07-01 la
-- trouve finie depuis plus de 12 mois, celle du 2027-06-01 non.
insert into public.participant_races (id, race_id, invite_email, status, registration_source)
values ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000013',
        'jamais-active@example.com', 'active', 'organizer_import');
insert into public.participant_races (id, race_id, user_id, invite_email, status, registration_source)
values ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000013',
        '22222222-2222-4222-8222-222222222222', 'b@example.com', 'active', 'organizer_import')
on conflict do nothing;

insert into private.participant_demographics (participant_race_id, nationality) values
  ('cccccccc-0000-4000-8000-000000000001', 'FRA');

insert into private.audit_logs (action, entity_table, created_at)
values ('test.ancien', 'editions', '2026-01-01T00:00:00Z'),
       ('test.recent', 'editions', '2027-05-01T00:00:00Z');

select is(
  (private.purge_expired_data('2027-06-01T00:00:00Z') ->> 'participantRows')::integer,
  0, 'PURGE-01 — moins de 12 mois après l''édition, rien n''est purgé');

select ok(
  (private.purge_expired_data('2027-07-01T00:00:00Z') ->> 'participantRows')::integer >= 1,
  'PURGE-02 — 12 mois après, les lignes jamais activées sont purgées');
select is_empty(
  $$ select id from public.participant_races where id = 'cccccccc-0000-4000-8000-000000000001' $$,
  'PURGE-03 — la ligne importée jamais activée a disparu');
select is_empty(
  $$ select participant_race_id from private.participant_demographics
     where participant_race_id = 'cccccccc-0000-4000-8000-000000000001' $$,
  'PURGE-04 — ses données déclaratives aussi');
select isnt_empty(
  $$ select id from public.participant_races
     where user_id = '22222222-2222-4222-8222-222222222222'
       and race_id = 'aaaaaaaa-0000-4000-8000-000000000013' $$,
  'PURGE-05 — une participation activée reste au coureur');
select is_empty(
  $$ select id from private.audit_logs where action = 'test.ancien' $$,
  'PURGE-06 — le journal de plus d''un an est purgé');
select isnt_empty(
  $$ select id from private.audit_logs where action = 'test.recent' $$,
  'PURGE-07 — le journal récent reste');

select * from finish();
rollback;
