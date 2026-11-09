-- PLUKA — Pas d'invitation avant 15 ans
-- Référence : migration 0076

begin;

create extension if not exists pgtap;

select plan(3);

\ir _personas.psql

update public.races set start_datetime = now() + interval '60 days'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

insert into public.participant_races (id, race_id, invite_email, status, registration_source) values
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000013',
   'jeune@example.com', 'active', 'organizer_import'),
  ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000013',
   'adulte@example.com', 'active', 'organizer_import'),
  ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000013',
   'sans-date@example.com', 'active', 'organizer_import');

insert into private.participant_demographics (participant_race_id, birth_date) values
  ('cccccccc-0000-4000-8000-000000000001', (current_date - interval '14 years')::date),
  ('cccccccc-0000-4000-8000-000000000002', (current_date - interval '30 years')::date);

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012');
reset role;

select is_empty(
  $$ select id from public.participant_invitations
     where participant_race_id = 'cccccccc-0000-4000-8000-000000000001' $$,
  'AGE-01 — un inscrit de moins de 15 ans n''est pas invité');
select isnt_empty(
  $$ select id from public.participant_invitations
     where participant_race_id = 'cccccccc-0000-4000-8000-000000000002' $$,
  'AGE-02 — un adulte l''est');
select isnt_empty(
  $$ select id from public.participant_invitations
     where participant_race_id = 'cccccccc-0000-4000-8000-000000000003' $$,
  'AGE-03 — sans date de naissance, rien n''est supposé');

select * from finish();
rollback;
