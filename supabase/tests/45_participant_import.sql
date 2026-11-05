-- PLUKA — Participants : l'import d'une liste
-- Référence : migration 0060 · docs/03_PRIVACY_RLS.md §28, §58 à §62 · AC-B2B-PART
--
-- 1. Un owner ou un admin importe ; editor, viewer, autre organisation, non.
-- 2. Une reprise du fichier ne crée pas de doublon, un import ne se rejoue pas.
-- 3. Une ligne ne vise que les épreuves de l'édition.
-- 4. Les données sensibles vont dans `private`, et rien ne reste dans les lignes.
-- 5. La liste n'expose ni compte, ni préparation, ni signal ; l'e-mail à l'admin seul.

begin;

create extension if not exists pgtap;

select plan(18);

\ir _personas.psql

create function pg_temp.mapped_rows() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('rowNumber', 1, 'status', 'valid', 'mapped', jsonb_build_object(
      'raceId', 'aaaaaaaa-0000-4000-8000-000000000013', 'email', 'anna@test.pluka',
      'firstName', 'Anna', 'lastName', 'Martin', 'bib', '12',
      'sex', 'female', 'birthDate', '1990-05-01', 'nationality', 'FRA',
      'itraIndex', 610, 'utmbIndex', 590)),
    jsonb_build_object('rowNumber', 2, 'status', 'error', 'error', 'Adresse e-mail invalide.')
  )
$$;

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.create_participant_import('aaaaaaaa-0000-4000-8000-000000000012', 'liste.csv',
  '["Email"]', '[{"Email": "anna@test.pluka"}, {"Email": "pas-une-adresse"}]') as import_id \gset
select ok(:'import_id'::uuid is not null, 'IMPORT-01 — admin : crée un import');
select lives_ok(
  format($$ select public.validate_participant_import(%L, '{"email": "Email"}', pg_temp.mapped_rows()) $$, :'import_id'),
  'IMPORT-02 — admin : enregistre le verdict des lignes');
select is(
  public.commit_participant_import(:'import_id') ->> 'created', '1',
  'IMPORT-03 — une ligne valide devient un participant');
select throws_ok(
  format($$ select public.commit_participant_import(%L) $$, :'import_id'),
  '55000', null, 'IMPORT-04 — un import terminé ne se rejoue pas');
reset role;

select is(
  (select count(*)::integer from public.participant_import_rows
   where import_id = :'import_id' and (raw_data <> '{}' or mapped_data <> '{}')),
  0, 'IMPORT-05 — rien ne reste dans les lignes de travail');
select is(
  (select registration_source::text from public.participant_races where invite_email = 'anna@test.pluka'),
  'organizer_import', 'IMPORT-06 — la participation dit son origine');
select is(
  (select nationality from private.participant_demographics d
   join public.participant_races pr on pr.id = d.participant_race_id
   where pr.invite_email = 'anna@test.pluka'),
  'FRA', 'IMPORT-07 — les données déclaratives vont dans private');
select is(
  (select count(distinct provider)::integer from private.participant_performance_signals s
   join public.participant_races pr on pr.id = s.participant_race_id
   where pr.invite_email = 'anna@test.pluka'),
  2, 'IMPORT-08 — ITRA et UTMB restent deux signaux distincts');

-- Le même fichier, repris.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.create_participant_import('aaaaaaaa-0000-4000-8000-000000000012', 'liste.csv',
  '["Email"]', '[{"Email": "anna@test.pluka"}]') as second_id \gset
select public.validate_participant_import(:'second_id', '{}', jsonb_build_array(
  jsonb_build_object('rowNumber', 1, 'status', 'valid', 'mapped', jsonb_build_object(
    'raceId', 'aaaaaaaa-0000-4000-8000-000000000013', 'email', 'ANNA@test.pluka',
    'firstName', 'Anna', 'lastName', 'Martin'))));
select is(
  public.commit_participant_import(:'second_id') ->> 'skipped', '1',
  'IMPORT-09 — un participant déjà là ne se double pas, même en majuscules');

select public.create_participant_import('aaaaaaaa-0000-4000-8000-000000000012', 'liste.csv',
  '["Email"]', '[{"Email": "x@test.pluka"}]') as third_id \gset
select public.validate_participant_import(:'third_id', '{}', jsonb_build_array(
  jsonb_build_object('rowNumber', 1, 'status', 'valid', 'mapped', jsonb_build_object(
    'raceId', 'bbbbbbbb-0000-4000-8000-000000000013', 'email', 'x@test.pluka',
    'firstName', 'X', 'lastName', 'Y'))));
select throws_ok(
  format($$ select public.commit_participant_import(%L) $$, :'third_id'),
  '22023', null, 'IMPORT-10 — une épreuve hors de l''édition est refusée');
select lives_ok(
  format($$ select public.discard_participant_import(%L) $$, :'third_id'),
  'IMPORT-11 — un import s''abandonne');
reset role;

select is(
  (select count(*)::integer from public.participant_import_rows where import_id = :'third_id'),
  0, 'IMPORT-12 — abandonné, rien n''est gardé du fichier');

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.create_participant_import('aaaaaaaa-0000-4000-8000-000000000012', 'a.csv', '[]', '[]') $$,
  '42501', null, 'IMPORT-13 — editor : refusé (§59)');
select is(
  public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') #>> '{participants,0,email}',
  null, 'IMPORT-14 — editor : la liste sans e-mail');
reset role;

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.create_participant_import('aaaaaaaa-0000-4000-8000-000000000012', 'a.csv', '[]', '[]') $$,
  '42501', null, 'IMPORT-15 — viewer : refusé');
reset role;

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is(
  (public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') -> 'participants' -> 0) ?& array['preparationState', 'userId', 'sex'],
  false, 'IMPORT-16 — ni compte, ni préparation, ni donnée sensible dans la liste');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'IMPORT-17 — une autre organisation ne lit pas la liste');
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'IMPORT-18 — coureur : refusé');
reset role;

select * from finish();
rollback;
