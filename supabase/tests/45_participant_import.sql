-- PLUKA — Participants : l'import d'une liste
-- Référence : migration 0060 · docs/03_PRIVACY_RLS.md §28, §58 à §62 · AC-B2B-PART
--
-- 1. Un owner ou un admin importe ; editor, viewer, autre organisation, non.
-- 2. Une reprise du fichier ne crée pas de doublon, un import ne se rejoue pas.
-- 3. Une ligne ne vise que les épreuves de l'édition.
-- 4. Les données sensibles vont dans `private`, et rien ne reste dans les lignes.
-- 5. La liste n'expose ni compte, ni préparation, ni signal ; l'e-mail à l'admin seul.
-- 6. Une vague inconnue se dit avant l'import, reste gardée, et se rattache une fois déclarée.
-- 7. La liste dit ce qui reste à vérifier, en tête, sans confondre deux épreuves.
-- 8. Un fichier repris complète sans doubler, n'efface rien, n'écrase pas une correction.
-- 9. Corriger et retirer : owner et admin ; un retiré garde sa ligne, un compte n'est pas retiré.

begin;

create extension if not exists pgtap;

select plan(50);

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

-- Une vague que l'épreuve ne connaît pas encore.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.create_participant_import('aaaaaaaa-0000-4000-8000-000000000012', 'vagues.csv',
  '["Email"]', '[{"Email": "bea@test.pluka"}, {"Email": "carl@test.pluka"}]') as wave_import \gset
select public.validate_participant_import(:'wave_import', '{}', jsonb_build_array(
  jsonb_build_object('rowNumber', 1, 'status', 'valid', 'mapped', jsonb_build_object(
    'raceId', 'aaaaaaaa-0000-4000-8000-000000000013', 'email', 'bea@test.pluka',
    'firstName', 'Béa', 'lastName', 'Roux', 'wave', 'Sas Élite')),
  jsonb_build_object('rowNumber', 2, 'status', 'valid', 'mapped', jsonb_build_object(
    'raceId', 'aaaaaaaa-0000-4000-8000-000000000013', 'email', 'carl@test.pluka',
    'firstName', 'Carl', 'lastName', 'Roux', 'wave', 'sas élite'))));
select is(
  public.get_participant_import(:'wave_import') -> 'unknownWaves' ->> 'rows', '2',
  'IMPORT-19 — une vague inconnue se dit avant l''import');
select is(
  public.get_participant_import(:'wave_import') -> 'unknownWaves' ->> 'groups', '1',
  'IMPORT-20 — la casse ne fait pas deux vagues');
select is(
  public.commit_participant_import(:'wave_import') ->> 'created', '2',
  'IMPORT-21 — une vague inconnue ne bloque pas la ligne');
select is(
  (public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') -> 'participants')
    @> '[{"lastName": "Roux", "declaredWaveName": "sas élite", "waveName": null}]'::jsonb,
  true, 'IMPORT-22 — la liste montre la vague en attente');
reset role;

select is(
  has_column_privilege('authenticated', 'public.participant_races', 'declared_wave_name', 'select'),
  false, 'IMPORT-23 — la colonne ne se lit pas en direct');

insert into public.race_start_waves (race_id, name, start_datetime, sort_order)
values ('aaaaaaaa-0000-4000-8000-000000000013', 'SAS ÉLITE', '2026-08-01 05:00:00+00', 90);
select is(
  (select count(*)::integer from public.participant_races pr
   join public.race_start_waves w on w.id = pr.start_wave_id
   where pr.last_name_snapshot = 'Roux' and w.name = 'SAS ÉLITE' and pr.declared_wave_name is null),
  2, 'IMPORT-24 — la vague déclarée se rattache, et le nom gardé disparaît');

-- Une vague connue n'est plus signalée.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.create_participant_import('aaaaaaaa-0000-4000-8000-000000000012', 'connue.csv',
  '["Email"]', '[{"Email": "dia@test.pluka"}]') as known_import \gset
select public.validate_participant_import(:'known_import', '{}', jsonb_build_array(
  jsonb_build_object('rowNumber', 1, 'status', 'valid', 'mapped', jsonb_build_object(
    'raceId', 'aaaaaaaa-0000-4000-8000-000000000013', 'email', 'dia@test.pluka',
    'firstName', 'Dia', 'lastName', 'Sow', 'wave', 'Sas élite'))));
select is(
  public.get_participant_import(:'known_import') -> 'unknownWaves' ->> 'rows', '0',
  'IMPORT-25 — une vague déclarée n''est pas signalée');
reset role;

-- Ce qui reste à vérifier dans la liste.
insert into public.participant_races (race_id, invite_email, last_name_snapshot, registration_source, bib_number, declared_wave_name)
values
  ('aaaaaaaa-0000-4000-8000-000000000013', 'eve@test.pluka', 'Zola', 'organizer_import', '12', null),
  ('aaaaaaaa-0000-4000-8000-000000000014', 'fay@test.pluka', 'Yann', 'organizer_import', '12', null),
  ('aaaaaaaa-0000-4000-8000-000000000013', 'gus@test.pluka', 'Xeno', 'organizer_import', null, 'Sas 9');

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is(
  public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') -> 'toCheck',
  '{"bibs": 2}'::jsonb,
  'IMPORT-26 — la liste compte ce qui reste à vérifier');
select is(
  (public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') -> 'participants')
    @> '[{"lastName": "Yann", "bibConflict": false}]'::jsonb,
  true, 'IMPORT-27 — un même dossard sur deux épreuves n''est pas un conflit');
select is(
  (public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') -> 'participants')
    @> '[{"lastName": "Zola", "bibConflict": true}]'::jsonb,
  true, 'IMPORT-28 — un même dossard sur une épreuve est signalé');
select is(
  public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012', 2) #>> '{participants,1,lastName}',
  'Zola', 'IMPORT-29 — ce qui reste à vérifier passe avant la limite de la liste');
reset role;

-- Dans un fichier repris, une ligne refusée reste visible.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.create_participant_import('aaaaaaaa-0000-4000-8000-000000000012', 'repris.csv',
  '["Email"]', '[{"Email": "x"}]') as busy_import \gset
reset role;
insert into public.participant_import_rows (import_id, row_number, raw_data, status, error_message)
select :'busy_import', n, '{}', 'skipped', 'Déjà dans la liste.' from generate_series(2, 150) n;
update public.participant_import_rows set row_number = 200, status = 'error', error_message = 'Adresse e-mail invalide.'
where import_id = :'busy_import' and row_number = 1;
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is(
  (public.get_participant_import(:'busy_import') -> 'exceptions') @> '[{"status": "error", "rowNumber": 200}]'::jsonb,
  true, 'IMPORT-30 — une ligne refusée passe avant les doublons');
reset role;

-- Un fichier repris : le dossard arrive au dernier moment.
create function pg_temp.reimport(p_rows jsonb) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  v_id := public.create_participant_import('aaaaaaaa-0000-4000-8000-000000000012', 'repris.csv', '["Email"]', '[{"Email": "x"}]');
  perform public.validate_participant_import(v_id, '{}', jsonb_build_array(jsonb_build_object(
    'rowNumber', 1, 'status', 'valid', 'mapped', p_rows)));
  return v_id;
end $$;
insert into public.participant_races (id, race_id, invite_email, first_name_snapshot, last_name_snapshot, registration_source)
values ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000013', 'late@test.pluka', 'Lou', 'Late', 'organizer_import');

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select pg_temp.reimport(jsonb_build_object('raceId', 'aaaaaaaa-0000-4000-8000-000000000013',
  'email', 'LATE@test.pluka', 'firstName', 'Autre', 'lastName', 'Nom', 'bib', '501', 'wave', 'Sas 2')) as late_import \gset
select is(
  public.get_participant_import(:'late_import') -> 'effects',
  '{"created": 0, "updated": 1, "unchanged": 0, "kept": 0, "withdrawn": 0}'::jsonb,
  'IMPORT-31 — la vérification annonce la mise à jour');
select is(
  public.commit_participant_import(:'late_import') ->> 'updated', '1',
  'IMPORT-32 — le fichier complète dossard et vague');
reset role;
select is(
  (select count(*)::integer from public.participant_races where lower(invite_email::text) = 'late@test.pluka'),
  1, 'IMPORT-33 — un fichier repris ne double personne');
select is(
  (select bib_number || '|' || declared_wave_name || '|' || first_name_snapshot from public.participant_races
   where id = 'cccccccc-0000-4000-8000-000000000001'),
  '501|Sas 2|Lou', 'IMPORT-34 — dossard et vague changent, le nom non');

-- Une case vide n'efface rien.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select pg_temp.reimport(jsonb_build_object('raceId', 'aaaaaaaa-0000-4000-8000-000000000013',
  'email', 'late@test.pluka', 'firstName', 'Lou', 'lastName', 'Late')) as empty_import \gset
select is(
  public.commit_participant_import(:'empty_import') ->> 'skipped', '1',
  'IMPORT-35 — sans dossard ni vague, la ligne ne change rien');
reset role;
select is(
  (select bib_number || '|' || declared_wave_name from public.participant_races where id = 'cccccccc-0000-4000-8000-000000000001'),
  '501|Sas 2', 'IMPORT-36 — une case vide n''efface rien');

-- La correction à la main gagne sur le fichier.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select lives_ok(
  $$ select public.correct_participant_registration('cccccccc-0000-4000-8000-000000000001', ' 777 ', 'Sas 9') $$,
  'IMPORT-37 — admin : corrige dossard et vague');
select pg_temp.reimport(jsonb_build_object('raceId', 'aaaaaaaa-0000-4000-8000-000000000013',
  'email', 'late@test.pluka', 'firstName', 'Lou', 'lastName', 'Late', 'bib', '501', 'wave', 'Sas 2')) as manual_import \gset
select is(
  public.get_participant_import(:'manual_import') -> 'effects' ->> 'kept', '1',
  'IMPORT-38 — la vérification annonce la correction gardée');
select is(
  public.commit_participant_import(:'manual_import') ->> 'kept', '1',
  'IMPORT-39 — l''import la compte');
reset role;
select is(
  (select bib_number || '|' || declared_wave_name from public.participant_races where id = 'cccccccc-0000-4000-8000-000000000001'),
  '777|Sas 9', 'IMPORT-40 — un fichier n''écrase pas une correction à la main');

-- Vidé à la main, le champ repart au fichier.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.correct_participant_registration('cccccccc-0000-4000-8000-000000000001', '', 'Sas 9');
select pg_temp.reimport(jsonb_build_object('raceId', 'aaaaaaaa-0000-4000-8000-000000000013',
  'email', 'late@test.pluka', 'firstName', 'Lou', 'lastName', 'Late', 'bib', '888')) as refill_import \gset
select public.commit_participant_import(:'refill_import');
reset role;
select is(
  (select bib_number from public.participant_races where id = 'cccccccc-0000-4000-8000-000000000001'),
  '888', 'IMPORT-41 — un champ vidé à la main se complète au prochain fichier');

-- Les droits de correction.
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.correct_participant_registration('cccccccc-0000-4000-8000-000000000001', '1', '') $$,
  '42501', null, 'IMPORT-42 — editor : ne corrige pas');
select throws_ok(
  $$ select public.set_participant_withdrawn('cccccccc-0000-4000-8000-000000000001', true) $$,
  '42501', null, 'IMPORT-43 — editor : ne retire pas');
reset role;
select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.correct_participant_registration('cccccccc-0000-4000-8000-000000000001', '1', '') $$,
  '42501', null, 'IMPORT-44 — une autre organisation ne corrige pas');
reset role;

-- Le retrait garde la trace, et un fichier ne l'annule pas.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.set_participant_withdrawn('cccccccc-0000-4000-8000-000000000001', true);
select is(
  (public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') -> 'withdrawn')
    @> '[{"lastName": "Late"}]'::jsonb
  and not (public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') -> 'participants')
    @> '[{"lastName": "Late"}]'::jsonb,
  true, 'IMPORT-45 — un retiré quitte la liste et reste une ligne');
select pg_temp.reimport(jsonb_build_object('raceId', 'aaaaaaaa-0000-4000-8000-000000000013',
  'email', 'late@test.pluka', 'firstName', 'Lou', 'lastName', 'Late', 'bib', '999')) as back_import \gset
select is(
  public.commit_participant_import(:'back_import') ->> 'withdrawn', '1',
  'IMPORT-46 — un fichier ne rétablit pas un retiré');
select public.set_participant_withdrawn('cccccccc-0000-4000-8000-000000000001', false);
select is(
  (public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') -> 'participants')
    @> '[{"lastName": "Late", "bib": "888"}]'::jsonb,
  true, 'IMPORT-47 — rétabli, il revient tel qu''il était');
reset role;

-- Un compte n'est pas retiré par l'organisation.
update public.participant_races set user_id = '33333333-3333-4333-8333-333333333333'
where id = 'cccccccc-0000-4000-8000-000000000001';
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select throws_ok(
  $$ select public.set_participant_withdrawn('cccccccc-0000-4000-8000-000000000001', true) $$,
  '55000', null, 'IMPORT-48 — un participant rattaché à un compte ne se retire pas');
reset role;

-- La vague se choisit : elle ne s'invente pas.
select id as gus_id from public.participant_races where invite_email = 'gus@test.pluka' \gset
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select throws_ok(
  format($$ select public.correct_participant_registration(%L, '', 'Sas 12') $$, :'gus_id'),
  '22023', null, 'IMPORT-49 — une vague inconnue de l''épreuve est refusée');
select is(
  (public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') -> 'waveOptions')
    @> '[{"name": "Sas 9", "official": false}, {"name": "SAS ÉLITE", "official": true}]'::jsonb,
  true, 'IMPORT-50 — la liste propose les vagues officielles et celles des fichiers');
reset role;

select * from finish();
rollback;
