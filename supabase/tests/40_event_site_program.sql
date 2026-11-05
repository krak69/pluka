-- PLUKA — Le site de l'événement : le programme
-- Référence : migration 0055 · docs/features/EVENT_SITE.md §3.9
--
-- 1. Un jour et une heure civils deviennent un instant, dans le fuseau des épreuves.
-- 2. Sans programme transmis, il ne bouge pas.
-- 3. Le programme appartient à l'édition ; quarante lignes au plus.
-- 4. La charge publique le porte.
-- 5. Mêmes rôles que pour le site.

begin;

create extension if not exists pgtap;

select plan(10);

\ir _personas.psql

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select lives_ok(
  $$ select public.save_event_site(
       'aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       'aaaaaaaa-0000-4000-8000-000000000012', null, null, null,
       '[{"day": "2026-06-20", "time": "00:30", "title": " Veillée ", "location": ""},
         {"day": "2026-06-19", "time": "18:00", "title": "Briefing", "location": "Salle"}]') $$,
  'PROGRAMME-01 — éditeur : enregistre le programme avec le site');
reset role;

select is(
  (select to_char(starts_at at time zone timezone, 'YYYY-MM-DD HH24:MI')
   from public.event_site_program_items where title = 'Veillée'),
  '2026-06-20 00:30', 'PROGRAMME-02 — l''heure saisie reste celle du fuseau, passé minuit');
select ok(
  (select starts_at = '2026-06-19 22:30:00+00'::timestamptz
   from public.event_site_program_items where title = 'Veillée'),
  'PROGRAMME-03 — l''instant stocké est le bon');
select is(
  (select location from public.event_site_program_items where title = 'Veillée'),
  null, 'PROGRAMME-04 — un lieu vide n''existe pas');

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select lives_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]') $$,
  'PROGRAMME-05 — sans programme transmis, l''enregistrement passe');
reset role;

select is(
  (select count(*)::integer from public.event_site_program_items
   where edition_id = 'aaaaaaaa-0000-4000-8000-000000000012'),
  2, 'PROGRAMME-06 — sans programme transmis, il reste');

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       null, null, null, null, '[]') $$,
  '22023', null, 'PROGRAMME-07 — un programme sans édition est refusé');
reset role;

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       'aaaaaaaa-0000-4000-8000-000000000012', null, null, null, '[]') $$,
  '42501', null, 'PROGRAMME-08 — viewer : refusé');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select is(
  (select count(*)::integer from public.event_site_program_items
   where edition_id = 'aaaaaaaa-0000-4000-8000-000000000012'),
  0, 'PROGRAMME-09 — une autre organisation ne lit pas le programme d''un site hors ligne');
reset role;

update public.event_sites set status = 'published', published_at = now()
where event_id = 'aaaaaaaa-0000-4000-8000-000000000011';

select pg_temp.act_as_anon();
select is(
  jsonb_array_length(public.event_site_public('trail-de-test') -> 'program'),
  2, 'PROGRAMME-10 — la charge publique porte le programme');
reset role;

select * from finish();
rollback;
