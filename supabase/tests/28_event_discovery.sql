-- PLUKA — Création classique d'un événement, inventaire du site, documents
-- Référence : docs/engines/SOURCES_EXTRACTION.md §11.1 · docs/02_DATA_MODEL.md §7.10 ·
--             migrations 0040, 0041, 0042
--
-- 1. Seule l'administration qui écrit crée un événement ; Support et coureurs
--    sont refusés, la table privée reste fermée.
-- 2. La création écrit événement, édition et épreuves en une transaction,
--    calcule l'instant de départ depuis l'heure locale, et pose le statut de
--    gestion (décision du 2026-10-07).
-- 3. Un site officiel lance son inventaire dans la même transaction ; le
--    worker ne refait pas un inventaire terminé.
-- 4. Les documents deviennent des sources ordinaires, sans doublon ; un PDF
--    déposé naît avec son snapshot.

begin;

create extension if not exists pgtap;

select plan(22);

\ir _personas.psql

delete from private.audit_logs;
delete from private.outbox_events;

update public.users set platform_role = 'pluka_admin', staff_role = 'support'
where id = '99999999-9999-4999-8999-999999999999';

-- ============================================================
-- 1. Qui crée
-- ============================================================

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
select throws_ok(
  $$ select public.admin_create_event('{"event":{"name":"X","slug":"x"},"edition":{"year":2027,"slug":"2027","startDate":"2027-06-12"}}') $$,
  '42501', null, 'DISC-01 — support : creer un evenement est refuse');
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.admin_create_event('{"event":{"name":"X","slug":"x"},"edition":{"year":2027,"slug":"2027","startDate":"2027-06-12"}}') $$,
  '42501', null, 'DISC-02 — coureur : refuse');
select throws_ok(
  $$ select count(*) from private.event_discoveries $$,
  '42501', null, 'DISC-03 — la table privee reste fermee');
reset role;

-- ============================================================
-- 2. Création
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select throws_ok(
  $$ select public.admin_create_event('{
       "event":{"name":"Course A","slug":"course-a-classique"},
       "edition":{"year":2027,"slug":"2027","startDate":"2027-06-12"},
       "races":[{"name":"Grand","slug":"grand","distanceKm":82,"startDate":"2027-06-12","startTime":"05:00","timezone":"Mars/Olympus"}]}') $$,
  '22023', null, 'DISC-04 — un fuseau inconnu est refuse, rien n''est cree');

create temp table created (id uuid) on commit drop;
grant all on created to authenticated;
insert into created select public.admin_create_event('{
  "event":{"name":"Course A","slug":"course-a-classique","city":"Gérardmer","officialWebsiteUrl":"https://www.trail-a.example/"},
  "edition":{"year":2027,"slug":"2027","startDate":"2027-06-12","endDate":"2027-06-13"},
  "races":[
    {"name":"Grand","slug":"grand","distanceKm":82,"elevationGainM":4200,"startDate":"2027-06-12","startTime":"05:00","timezone":"Europe/Paris"},
    {"name":"Nuit","slug":"nuit","distanceKm":30,"startDate":"2027-06-12","startTime":"23:30","timezone":"Europe/Paris"}]}');

select throws_ok(
  $$ select public.admin_create_event('{"event":{"name":"Bis","slug":"course-a-classique"},"edition":{"year":2027,"slug":"2027","startDate":"2027-06-12"}}') $$,
  '23505', null, 'DISC-05 — un slug deja pris est refuse');
reset role;

select results_eq(
  $$ select e.status::text, e.management_status::text, ed.year::integer, count(r.id)::integer
     from public.events e join public.editions ed on ed.event_id = e.id
     left join public.races r on r.edition_id = ed.id
     where e.id = (select id from created) group by e.status, e.management_status, ed.year $$,
  $$ values ('draft'::text, 'pluka_managed'::text, 2027, 2) $$,
  'DISC-06 — evenement, edition et deux epreuves en brouillon ; sans organisation, maintenu par PLUKA');

select is(
  (select start_datetime from public.races r join public.editions ed on ed.id = r.edition_id
   where ed.event_id = (select id from created) and r.slug = 'grand'),
  '2027-06-12 03:00:00+00'::timestamptz,
  'DISC-07 — 05:00 a Paris en juin vaut 03:00 UTC : l''instant est calcule par la base');

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
create temp table created_org (id uuid) on commit drop;
grant all on created_org to authenticated;
insert into created_org select public.admin_create_event(jsonb_build_object(
  'event', jsonb_build_object('name', 'Course B', 'slug', 'course-b-partenaire',
    'organizationId', 'aaaaaaaa-0000-4000-8000-000000000001'),
  'edition', jsonb_build_object('year', 2027, 'slug', '2027', 'startDate', '2027-07-01'),
  'races', '[]'::jsonb));
reset role;

select is(
  (select management_status::text from public.events where id = (select id from created_org)),
  'organizer_managed', 'DISC-08 — avec une organisation : partenaire (decision du 2026-10-07)');

-- ============================================================
-- 3. Inventaire du site
-- ============================================================

create temp table disc (id uuid) on commit drop;
insert into disc select id from private.event_discoveries where event_id = (select id from created);

select is(
  (select count(*)::integer from private.outbox_events
   where event_type = 'source.discover' and aggregate_id = (select id from disc)),
  1, 'DISC-09 — un site officiel enfile son inventaire avec la creation');

select is(
  (select count(*)::integer from private.event_discoveries where event_id = (select id from created_org)),
  0, 'DISC-10 — sans site, pas d''inventaire');

select is(
  public.worker_begin_event_discovery((select id from disc)),
  'https://www.trail-a.example/', 'DISC-11 — le worker recoit l''URL a lire');

select lives_ok(
  $$ select public.worker_complete_event_discovery(
       (select id from disc), 'https://www.trail-a.example/',
       '{"pages":[{"url":"https://www.trail-a.example/","title":"A","suggested":true}],"documents":[]}',
       3::smallint, 'discovery-2.0.0') $$,
  'DISC-12 — le worker depose l''inventaire');

select is(
  public.worker_begin_event_discovery((select id from disc)),
  null, 'DISC-13 — un inventaire termine ne se refait pas');

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select results_eq(
  $$ select (r ->> 'status'), (r ->> 'pagesRead')::integer, jsonb_array_length(r -> 'inventory' -> 'pages')
     from public.admin_get_event_discovery((select id from created)) r $$,
  $$ values ('ready'::text, 3, 1) $$,
  'DISC-14 — la lecture rend le dernier inventaire de l''evenement');

select throws_ok(
  $$ select public.admin_refresh_event_discovery((select id from created_org)) $$,
  '55000', null, 'DISC-15 — un evenement sans site n''a rien a relancer');
reset role;

-- ============================================================
-- 4. Documents
-- ============================================================

create temp table edition_ref (id uuid) on commit drop;
grant all on edition_ref to authenticated;
insert into edition_ref select ed.id from public.editions ed where ed.event_id = (select id from created);

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select is(
  public.admin_add_edition_documents((select id from edition_ref), '[
    {"url":"https://www.trail-a.example/reglement.pdf","title":"Règlement","kind":"pdf"},
    {"url":"https://www.trail-a.example/","title":"Site officiel","kind":"page"}]'),
  2, 'DISC-16 — deux documents declares');
select is(
  public.admin_add_edition_documents((select id from edition_ref), '[
    {"url":"https://www.trail-a.example/reglement.pdf","title":"Règlement","kind":"pdf"}]'),
  0, 'DISC-17 — relancer ne redeclare pas la meme URL');
select throws_ok(
  $$ select public.admin_add_edition_documents((select id from edition_ref), jsonb_build_array(jsonb_build_object(
       'url','https://x.example/a.pdf','kind','pdf','raceId','33333333-3333-4333-8333-333333333333'))) $$,
  '22023', null, 'DISC-18 — une epreuve d''une autre edition est refusee');
select throws_ok(
  $$ select public.admin_add_edition_file((select id from edition_ref), 'Guide', 'races/x/gpx/y.pdf',
       repeat('a', 64), 1000) $$,
  '22023', null, 'DISC-19 — un chemin de depot hors forme est refuse');
select lives_ok(
  $$ select public.admin_add_edition_file((select id from edition_ref), 'Guide coureur',
       'editions/' || (select id from edition_ref) || '/documents/' || repeat('b', 64) || '.pdf',
       repeat('b', 64), 2048) $$,
  'DISC-20 — un PDF depose devient une source avec son snapshot');
reset role;

select is(
  (select count(*)::integer from private.outbox_events o
   join public.source_snapshots sn on sn.id = o.aggregate_id
   join public.sources s on s.id = sn.source_id
   where o.event_type = 'source.parse' and s.title = 'Guide coureur'),
  1, 'DISC-21 — le PDF depose part directement au parsing');

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select results_eq(
  $$ select d ->> 'title', d ->> 'state'
     from public.admin_list_edition_documents((select id from edition_ref)) r,
          jsonb_array_elements(r -> 'documents') d
     order by 1 $$,
  $$ values ('Guide coureur'::text, 'reading'::text), ('Règlement', 'queued'), ('Site officiel', 'queued') $$,
  'DISC-22 — etat de chaque document : en file avant capture, en lecture une fois capture');
reset role;

select * from finish();

rollback;
