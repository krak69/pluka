-- PLUKA — Le site de l'événement : les documents vus par l'éditeur
-- Référence : migration 0053 · docs/features/EVENT_SITE.md §8
--
-- 1. Tout membre de l'organisation lit la liste, viewer compris.
-- 2. La liste dit qu'un fichier existe, jamais où il se trouve.
-- 3. Ni les archives ni les GPX n'y figurent.
-- 4. Hors de l'organisation : refusé.
-- 5. Le chemin du fichier reste fermé en lecture directe.

begin;

create extension if not exists pgtap;

select plan(10);

\ir _personas.psql

insert into public.sources (id, edition_id, organization_id, source_type, title, storage_path, status)
values
  ('aaaaaaaa-0000-4000-8000-000000000a01', 'aaaaaaaa-0000-4000-8000-000000000012',
   'aaaaaaaa-0000-4000-8000-000000000001', 'pdf', 'Règlement', 'dossier/secret.pdf', 'ready'),
  ('aaaaaaaa-0000-4000-8000-000000000a02', 'aaaaaaaa-0000-4000-8000-000000000012',
   'aaaaaaaa-0000-4000-8000-000000000001', 'pdf', 'Ancien règlement', 'dossier/ancien.pdf', 'archived'),
  ('aaaaaaaa-0000-4000-8000-000000000a03', 'aaaaaaaa-0000-4000-8000-000000000012',
   'aaaaaaaa-0000-4000-8000-000000000001', 'gpx', 'Tracé', 'dossier/trace.gpx', 'ready');

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select is(
  (select has_file from public.event_site_documents('aaaaaaaa-0000-4000-8000-000000000012')
   where id = 'aaaaaaaa-0000-4000-8000-000000000a01'),
  true, 'SITEDOC-01 — viewer : voit le document et sait qu''il a un fichier');
select is(
  (select count(*)::integer from public.event_site_documents('aaaaaaaa-0000-4000-8000-000000000012')
   where id in ('aaaaaaaa-0000-4000-8000-000000000a02', 'aaaaaaaa-0000-4000-8000-000000000a03')),
  0, 'SITEDOC-02 — ni archive ni GPX');
select is(
  (select count(*)::integer
   from public.event_site_documents('aaaaaaaa-0000-4000-8000-000000000012') d
   where to_jsonb(d)::text like '%dossier/secret.pdf%'),
  0, 'SITEDOC-03 — le chemin du fichier ne sort jamais');
select throws_ok(
  $$ select storage_path from public.sources limit 1 $$,
  '42501', null, 'SITEDOC-04 — le chemin reste fermé en lecture directe');
reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select lives_ok(
  $$ select * from public.event_site_documents('aaaaaaaa-0000-4000-8000-000000000012') $$,
  'SITEDOC-05 — owner : lit la liste');
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select lives_ok(
  $$ select * from public.event_site_documents('aaaaaaaa-0000-4000-8000-000000000012') $$,
  'SITEDOC-06 — admin PLUKA : lit la liste');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select * from public.event_site_documents('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'SITEDOC-07 — owner d''une autre organisation : refusé');
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select * from public.event_site_documents('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'SITEDOC-08 — coureur : refusé');
reset role;

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
select throws_ok(
  $$ select * from public.event_site_documents('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'SITEDOC-09 — ancien membre : refusé');
reset role;

select pg_temp.act_as_anon();
select throws_ok(
  $$ select * from public.event_site_documents('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'SITEDOC-10 — anonyme : refusé');
reset role;

select * from finish();
rollback;
