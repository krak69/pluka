-- PLUKA — Le site de l'événement : la galerie et la vidéo
-- Référence : migration 0056 · docs/features/EVENT_SITE.md §3.10
--
-- 1. Un éditeur ajoute et retire une photo de son événement.
-- 2. Douze photos au plus ; un chemin hors du dossier de l'événement est refusé.
-- 3. Une vidéo s'enregistre sous forme d'un fournisseur et d'un identifiant.
-- 4. La charge publique porte les photos et la vidéo.
-- 5. Mêmes rôles que pour le site.

begin;

create extension if not exists pgtap;

select plan(12);

\ir _personas.psql

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select lives_ok(
  $$ select public.add_event_site_gallery_photo(
       'aaaaaaaa-0000-4000-8000-000000000011',
       'aaaaaaaa-0000-4000-8000-000000000011/gallery-1.webp', ' Le départ ') $$,
  'GALERIE-01 — éditeur : ajoute une photo');
select throws_ok(
  $$ select public.add_event_site_gallery_photo(
       'aaaaaaaa-0000-4000-8000-000000000011',
       'bbbbbbbb-0000-4000-8000-000000000011/gallery.webp', null) $$,
  '22023', 'INVALID_ASSET_PATH', 'GALERIE-02 — un chemin d''un autre événement est refusé');
reset role;

select is(
  (select alt from public.event_site_gallery where event_id = 'aaaaaaaa-0000-4000-8000-000000000011'),
  'Le départ', 'GALERIE-03 — le texte de remplacement est nettoyé');

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.add_event_site_gallery_photo(
       'aaaaaaaa-0000-4000-8000-000000000011',
       'aaaaaaaa-0000-4000-8000-000000000011/gallery-2.webp', null) $$,
  '42501', null, 'GALERIE-04 — viewer : refusé');
reset role;

select id as photo_id from public.event_site_gallery
where event_id = 'aaaaaaaa-0000-4000-8000-000000000011' \gset

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  format($$ select public.remove_event_site_gallery_photo(%L) $$, :'photo_id'),
  '42501', null, 'GALERIE-05 — une autre organisation ne retire pas la photo');
select is(
  (select count(*)::integer from public.event_site_gallery
   where event_id = 'aaaaaaaa-0000-4000-8000-000000000011'),
  0, 'GALERIE-06 — une autre organisation ne lit pas la galerie');
reset role;

insert into public.event_site_gallery (event_id, path, sort_order)
select 'aaaaaaaa-0000-4000-8000-000000000011',
       'aaaaaaaa-0000-4000-8000-000000000011/rempli-' || n || '.webp', n
from generate_series(1, 11) as n;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.add_event_site_gallery_photo(
       'aaaaaaaa-0000-4000-8000-000000000011',
       'aaaaaaaa-0000-4000-8000-000000000011/treizieme.webp', null) $$,
  '22023', 'TOO_MANY_PHOTOS', 'GALERIE-07 — pas de treizième photo');
select lives_ok(
  format($$ select public.remove_event_site_gallery_photo(%L) $$, :'photo_id'),
  'GALERIE-08 — éditeur : retire une photo');
select lives_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       null, null, null,
       '{"figures": [], "links": {}, "videoProvider": "youtube", "videoId": "dQw4w9WgXcQ"}') $$,
  'GALERIE-09 — la vidéo s''enregistre avec le site');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       null, null, null,
       '{"figures": [], "links": {}, "videoProvider": "youtube", "videoId": "\"><script>"}') $$,
  '23514', null, 'GALERIE-10 — un identifiant de vidéo inattendu est refusé');
reset role;

update public.event_sites set status = 'published', published_at = now()
where event_id = 'aaaaaaaa-0000-4000-8000-000000000011';

select pg_temp.act_as_anon();
select is(
  jsonb_array_length(public.event_site_public('trail-de-test') -> 'gallery'),
  11, 'GALERIE-11 — la charge publique porte les photos');
select is(
  public.event_site_public('trail-de-test') -> 'video' ->> 'id',
  'dQw4w9WgXcQ', 'GALERIE-12 — la charge publique porte la vidéo');
reset role;

select * from finish();
rollback;
