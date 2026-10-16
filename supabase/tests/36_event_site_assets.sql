-- PLUKA — Le site de l'événement : le dépôt des images
-- Référence : migration 0051 · AGENTS §91, §92
--
-- Un éditeur dépose dans le dossier de son événement, et nulle part ailleurs ;
-- un lecteur, une autre organisation, un visiteur ne déposent rien.

begin;

create extension if not exists pgtap;

select plan(7);

\ir _personas.psql

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('event-site-assets', 'aaaaaaaa-0000-4000-8000-000000000011/logo-1.webp') $$,
  'ASSET-01 — éditeur : dépose dans le dossier de son événement');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('event-site-assets', 'bbbbbbbb-0000-4000-8000-000000000011/logo-1.webp') $$,
  '42501', null, 'ASSET-02 — éditeur : pas dans le dossier d''un autre événement');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('event-site-assets', 'logo.webp') $$,
  '42501', null, 'ASSET-03 — pas hors d''un dossier d''événement');
-- Le retrait passe par l'API de stockage, qui lit l'objet avant de le
-- supprimer : la policy de lecture est celle qui l'autorise.
select is(
  (select count(*)::integer from storage.objects
   where bucket_id = 'event-site-assets'
     and name = 'aaaaaaaa-0000-4000-8000-000000000011/logo-1.webp'),
  1, 'ASSET-04 — éditeur : voit l''image de son événement, donc peut la retirer');
reset role;

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('event-site-assets', 'aaaaaaaa-0000-4000-8000-000000000011/logo-2.webp') $$,
  '42501', null, 'ASSET-05 — lecteur : refusé');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('event-site-assets', 'aaaaaaaa-0000-4000-8000-000000000011/logo-3.webp') $$,
  '42501', null, 'ASSET-06 — owner d''une autre organisation : refusé');
reset role;

select pg_temp.act_as_anon();
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('event-site-assets', 'aaaaaaaa-0000-4000-8000-000000000011/logo-4.webp') $$,
  '42501', null, 'ASSET-07 — visiteur : refusé');
reset role;

select * from finish();
rollback;
