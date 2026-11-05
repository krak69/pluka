-- PLUKA — Ma course : préparer l'édition suivante
-- Référence : migration 0059 · docs/05_ROUTES_FLOWS.md §12.1
--
-- 1. Un éditeur duplique : mêmes épreuves, en brouillon, aux mêmes heures locales.
-- 2. Aucune information publiée ne suit : elle est à revalider.
-- 3. Une année déjà prise est refusée.
-- 4. Viewer, autre organisation et coureur : refusés.

begin;

create extension if not exists pgtap;

select plan(10);

\ir _personas.psql

-- Un départ en heure d'été, pour une édition suivante en heure d'hiver.
update public.races
set start_datetime = '2026-06-20 04:00:00+00', timezone = 'Europe/Paris', cutoff_datetime = null
where id = 'aaaaaaaa-0000-4000-8000-000000000013';
update public.editions set start_date = '2026-06-20', end_date = null
where id = 'aaaaaaaa-0000-4000-8000-000000000012';

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select lives_ok(
  $$ select public.duplicate_edition('aaaaaaaa-0000-4000-8000-000000000012', 2027, '2027-01-16') $$,
  'DUP-01 — éditeur : prépare l''édition suivante');
reset role;

select is(
  (select status::text from public.editions
   where event_id = 'aaaaaaaa-0000-4000-8000-000000000011' and year = 2027),
  'draft', 'DUP-02 — l''édition naît en brouillon');
select is(
  (select r.status::text from public.races r join public.editions ed on ed.id = r.edition_id
   where ed.event_id = 'aaaaaaaa-0000-4000-8000-000000000011' and ed.year = 2027 limit 1),
  'draft', 'DUP-03 — ses épreuves aussi');
select is(
  (select to_char(r.start_datetime at time zone r.timezone, 'YYYY-MM-DD HH24:MI')
   from public.races r join public.editions ed on ed.id = r.edition_id
   where ed.event_id = 'aaaaaaaa-0000-4000-8000-000000000011' and ed.year = 2027
     and r.slug = (select slug from public.races where id = 'aaaaaaaa-0000-4000-8000-000000000013')),
  '2027-01-16 06:00', 'DUP-04 — un départ à 6 h reste à 6 h, heure locale');
select is(
  (select count(*)::integer from public.race_facts f
   join public.races r on r.id = f.race_id join public.editions ed on ed.id = r.edition_id
   where ed.event_id = 'aaaaaaaa-0000-4000-8000-000000000011' and ed.year = 2027),
  0, 'DUP-05 — aucune information publiée ne suit');
select is(
  (select r.registration_url from public.races r join public.editions ed on ed.id = r.edition_id
   where ed.event_id = 'aaaaaaaa-0000-4000-8000-000000000011' and ed.year = 2027 limit 1),
  null, 'DUP-06 — le lien d''inscription ne suit pas');

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.duplicate_edition('aaaaaaaa-0000-4000-8000-000000000012', 2027, '2027-06-20') $$,
  '23505', 'EDITION_ALREADY_EXISTS', 'DUP-07 — une année déjà prise est refusée');
reset role;

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.duplicate_edition('aaaaaaaa-0000-4000-8000-000000000012', 2028, '2028-06-20') $$,
  '42501', null, 'DUP-08 — viewer : refusé');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.duplicate_edition('aaaaaaaa-0000-4000-8000-000000000012', 2028, '2028-06-20') $$,
  '42501', null, 'DUP-09 — une autre organisation : refusée');
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.duplicate_edition('aaaaaaaa-0000-4000-8000-000000000012', 2028, '2028-06-20') $$,
  '42501', null, 'DUP-10 — coureur : refusé');
reset role;

select * from finish();
rollback;
