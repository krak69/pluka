-- PLUKA — Le site de l'événement : les liens d'inscription
-- Référence : migration 0050 · docs/features/EVENT_SITE.md §5
--
-- 1. Le lien de l'édition et celui d'une épreuve s'enregistrent avec le site.
-- 2. Sans édition désignée, les liens ne bougent pas.
-- 3. Une épreuve d'une autre édition, une adresse qui n'est pas https : refusées.
-- 4. Les mêmes rôles que pour le site.

begin;

create extension if not exists pgtap;

select plan(9);

\ir _personas.psql

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select lives_ok(
  $$ select public.save_event_site(
       'aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       'aaaaaaaa-0000-4000-8000-000000000012', 'https://inscriptions.example/2026',
       '[{"raceId": "aaaaaaaa-0000-4000-8000-000000000013", "url": "https://inscriptions.example/80k"}]') $$,
  'INSCR-01 — éditeur : enregistre le lien de l''édition et celui d''une épreuve');
reset role;

select is(
  (select registration_url from public.editions where id = 'aaaaaaaa-0000-4000-8000-000000000012'),
  'https://inscriptions.example/2026', 'INSCR-02 — le lien de l''édition est posé');
select is(
  (select registration_url from public.races where id = 'aaaaaaaa-0000-4000-8000-000000000013'),
  'https://inscriptions.example/80k', 'INSCR-03 — le lien propre de l''épreuve est posé');

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select lives_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]') $$,
  'INSCR-04 — l''appel de 0049 garde son sens');
reset role;

select is(
  (select registration_url from public.editions where id = 'aaaaaaaa-0000-4000-8000-000000000012'),
  'https://inscriptions.example/2026', 'INSCR-05 — sans édition désignée, les liens ne bougent pas');

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.save_event_site(
       'aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       'aaaaaaaa-0000-4000-8000-000000000012', 'http://inscriptions.example/2026', null) $$,
  '23514', null, 'INSCR-06 — une adresse qui n''est pas https est refusée');
select throws_ok(
  $$ select public.save_event_site(
       'aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       'aaaaaaaa-0000-4000-8000-000000000012', null,
       '[{"raceId": "bbbbbbbb-0000-4000-8000-000000000013", "url": "https://autre.example"}]') $$,
  '22023', null, 'INSCR-07 — une épreuve d''une autre édition est refusée');
select throws_ok(
  $$ select public.save_event_site(
       'aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       'bbbbbbbb-0000-4000-8000-000000000012', null, null) $$,
  '22023', null, 'INSCR-08 — une édition d''un autre événement est refusée');
reset role;

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.save_event_site(
       'aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       'aaaaaaaa-0000-4000-8000-000000000012', null, null) $$,
  '42501', null, 'INSCR-09 — lecteur : refusé');
reset role;

select * from finish();
rollback;
