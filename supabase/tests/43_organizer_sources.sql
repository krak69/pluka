-- PLUKA — Ma course : l'organisation fournit ses documents
-- Référence : migration 0058 · docs/00_PRODUCT_SPEC.md §28.2
--
-- 1. Un éditeur ajoute un document ; un membre lit la liste.
-- 2. Un viewer n'ajoute rien, une autre organisation et un coureur ne voient rien.
-- 3. Un fichier ne se dépose que dans le dossier d'une édition de l'organisation.
-- 4. Rien n'est publié d'ici.

begin;

create extension if not exists pgtap;

select plan(14);

\ir _personas.psql

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is(
  public.add_edition_documents('aaaaaaaa-0000-4000-8000-000000000012',
    '[{"url": "https://organisation.example/reglement", "title": "Règlement", "kind": "page"}]'),
  1, 'DOCS-01 — éditeur : ajoute une page');
select is(
  public.add_edition_documents('aaaaaaaa-0000-4000-8000-000000000012',
    '[{"url": "https://organisation.example/reglement", "title": "Règlement", "kind": "page"}]'),
  0, 'DOCS-02 — la même adresse ne s''ajoute pas deux fois');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('race-sources', 'editions/aaaaaaaa-0000-4000-8000-000000000012/documents/' || repeat('a', 64) || '.pdf') $$,
  'DOCS-03 — éditeur : dépose dans le dossier de son édition');
reset role;

select is(
  (select count(*)::integer from public.race_fact_versions v
   join public.race_facts f on f.id = v.fact_id
   where f.race_id = 'aaaaaaaa-0000-4000-8000-000000000013'
     and v.value_text = 'https://organisation.example/reglement'),
  0, 'DOCS-04 — ajouter un document ne publie rien');

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select ok(
  jsonb_array_length(public.list_edition_documents('aaaaaaaa-0000-4000-8000-000000000012') -> 'documents') >= 1,
  'DOCS-05 — viewer : lit la liste');
select throws_ok(
  $$ select public.add_edition_documents('aaaaaaaa-0000-4000-8000-000000000012',
       '[{"url": "https://organisation.example/autre", "title": "Autre", "kind": "page"}]') $$,
  '42501', null, 'DOCS-06 — viewer : n''ajoute rien');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('race-sources', 'editions/aaaaaaaa-0000-4000-8000-000000000012/documents/' || repeat('b', 64) || '.pdf') $$,
  '42501', null, 'DOCS-07 — viewer : ne dépose rien');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.list_edition_documents('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'DOCS-08 — une autre organisation ne lit pas la liste');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('race-sources', 'editions/aaaaaaaa-0000-4000-8000-000000000012/documents/' || repeat('c', 64) || '.pdf') $$,
  '42501', null, 'DOCS-09 — une autre organisation ne dépose rien');
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.add_edition_documents('aaaaaaaa-0000-4000-8000-000000000012',
       '[{"url": "https://organisation.example/autre", "title": "Autre", "kind": "page"}]') $$,
  '42501', null, 'DOCS-10 — coureur : refusé');
reset role;

select pg_temp.act_as_anon();
select throws_ok(
  $$ select public.list_edition_documents('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'DOCS-11 — anonyme : refusé');
reset role;

-- Un même contenu, sous un autre nom.
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is(
  public.add_edition_file('aaaaaaaa-0000-4000-8000-000000000012', 'Règlement',
    'editions/aaaaaaaa-0000-4000-8000-000000000012/documents/' || repeat('d', 64) || '.pdf',
    repeat('d', 64), 2048) ->> 'created',
  'true', 'DOCS-12 — un fichier nouveau devient une source');
select is(
  public.add_edition_file('aaaaaaaa-0000-4000-8000-000000000012', 'Autre nom',
    'editions/aaaaaaaa-0000-4000-8000-000000000012/documents/' || repeat('d', 64) || '.pdf',
    repeat('d', 64), 2048) ->> 'created',
  'false', 'DOCS-13 — le même contenu se dit déjà déposé');
reset role;
select is(
  (select count(*)::integer from public.sources
   where storage_path like '%/documents/' || repeat('d', 64) || '.pdf'),
  1, 'DOCS-14 — le même contenu ne crée pas une seconde source');

select * from finish();
rollback;
