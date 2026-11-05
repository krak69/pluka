-- PLUKA — Le site de l'événement : un contenu complet
-- Référence : migration 0054 · docs/features/EVENT_SITE.md §3.3, §3.8, §3.11
--
-- 1. Rubriques, présentation, chiffres et liens s'enregistrent avec le site.
-- 2. Sans contenu transmis, ils ne bougent pas.
-- 3. Une rubrique proposée ne s'écrit qu'une fois ; un lien est en https ;
--    quatre chiffres au plus.
-- 4. La charge publique les porte, jamais l'adresse de contact.
-- 5. Mêmes rôles que pour le site.

begin;

create extension if not exists pgtap;

select plan(14);

\ir _personas.psql

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select lives_ok(
  $$ select public.save_event_site(
       'aaaaaaaa-0000-4000-8000-000000000011', null, null, 'orga@test.pluka',
       '[{"title": "Douches", "body": "Au gymnase.", "moment": "after", "topicKey": "showers"},
         {"title": "Garderie", "body": "Pour les enfants.", "moment": "during"}]',
       null, null, null,
       '{"presentation": " Une course de village. ", "venue": "Salle des fêtes",
         "figures": [{"value": "300", "label": "coureurs"}],
         "links": {"results": "https://chrono.example/2026", "live": ""}}') $$,
  'CONTENU-01 — éditeur : enregistre rubriques, présentation, chiffres et liens');
reset role;

select is(
  (select moment::text from public.event_site_sections
   where event_id = 'aaaaaaaa-0000-4000-8000-000000000011' and topic_key = 'showers'),
  'after', 'CONTENU-02 — une rubrique garde son moment et sa clé');
select is(
  (select moment::text from public.event_site_sections
   where event_id = 'aaaaaaaa-0000-4000-8000-000000000011' and title = 'Garderie'),
  'during', 'CONTENU-03 — une rubrique ajoutée n''a pas de clé, et garde son moment');
select is(
  (select presentation from public.event_sites where event_id = 'aaaaaaaa-0000-4000-8000-000000000011'),
  'Une course de village.', 'CONTENU-04 — la présentation est nettoyée');
select is(
  (select live_url from public.event_sites where event_id = 'aaaaaaaa-0000-4000-8000-000000000011'),
  null, 'CONTENU-05 — un lien vide n''existe pas');

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select lives_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, 'orga@test.pluka', '[]') $$,
  'CONTENU-06 — sans contenu transmis, l''enregistrement passe');
reset role;

select is(
  (select count(*)::integer from public.event_site_figures
   where event_id = 'aaaaaaaa-0000-4000-8000-000000000011'),
  1, 'CONTENU-07 — sans contenu transmis, les chiffres restent');

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null,
       '[{"title": "A", "body": "a", "topicKey": "food"}, {"title": "B", "body": "b", "topicKey": "food"}]') $$,
  '23505', null, 'CONTENU-08 — une rubrique proposée ne s''écrit qu''une fois');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       null, null, null, '{"figures": [], "links": {"facebook": "http://facebook.example/x"}}') $$,
  '23514', null, 'CONTENU-09 — un lien qui n''est pas https est refusé');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       null, null, null,
       '{"figures": [{"value":"1","label":"a"},{"value":"2","label":"b"},{"value":"3","label":"c"},
                     {"value":"4","label":"d"},{"value":"5","label":"e"}], "links": {}}') $$,
  '22023', 'TOO_MANY_FIGURES', 'CONTENU-10 — pas de cinquième chiffre');
reset role;

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]',
       null, null, null, '{"figures": [], "links": {}}') $$,
  '42501', null, 'CONTENU-11 — viewer : refusé');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select is(
  (select count(*)::integer from public.event_site_figures
   where event_id = 'aaaaaaaa-0000-4000-8000-000000000011'),
  0, 'CONTENU-12 — une autre organisation ne lit pas les chiffres');
reset role;

update public.event_sites set status = 'published', published_at = now()
where event_id = 'aaaaaaaa-0000-4000-8000-000000000011';

select pg_temp.act_as_anon();
select is(
  public.event_site_public('trail-de-test') -> 'links' ->> 'results',
  'https://chrono.example/2026', 'CONTENU-13 — la charge publique porte les liens');
select ok(
  public.event_site_public('trail-de-test')::text not like '%orga@test.pluka%',
  'CONTENU-14 — jamais l''adresse de contact');
reset role;

select * from finish();
rollback;
