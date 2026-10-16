-- PLUKA — Le site de l'événement : formulaire de contact et documents diffusés
-- Référence : migration 0052 · docs/features/EVENT_SITE.md §3.4, §6 · AGENTS §91
--
-- 1. Un visiteur envoie un message à un site en ligne qui a une adresse de
--    contact, et à aucun autre ; l'IP n'est gardée qu'en empreinte salée.
-- 2. La limite de débit : par empreinte, puis par événement.
-- 3. Le worker seul lit le message ; il l'efface une fois envoyé ou abandonné,
--    et un message rejoué s'arrête.
-- 4. Un document diffusé d'un site en ligne se lit par tous ; aucun autre.

begin;

create extension if not exists pgtap;

select plan(22);

\ir _personas.psql

-- ============================================================
-- 1. Pas de site, pas de message
-- ============================================================

select pg_temp.act_as_anon();
select throws_ok(
  $$ select public.submit_event_site_contact('trail-de-test', '203.0.113.7', 'Alex', 'alex@test.pluka', null, 'Bonjour') $$,
  'P0002', null, 'CONTACT-01 — pas de site : rien à envoyer, sans dire pourquoi');
reset role;

insert into public.event_sites (event_id, status, published_at)
values ('aaaaaaaa-0000-4000-8000-000000000011', 'published', now());

select pg_temp.act_as_anon();
select throws_ok(
  $$ select public.submit_event_site_contact('trail-de-test', '203.0.113.7', 'Alex', 'alex@test.pluka', null, 'Bonjour') $$,
  'P0002', null, 'CONTACT-02 — site en ligne sans adresse de contact : rien à envoyer');
reset role;

update public.event_sites set contact_email = 'courses@trail-de-test.test'
where event_id = 'aaaaaaaa-0000-4000-8000-000000000011';

-- ============================================================
-- 2. Un message part en file
-- ============================================================

select pg_temp.act_as_anon();
select is(
  public.submit_event_site_contact('trail-de-test', '203.0.113.7', 'Alex', 'alex@test.pluka', 'test-prive', 'Bonjour, une question sur le 80K.'),
  'sent', 'CONTACT-03 — visiteur : le message part en file');
select throws_ok(
  $$ select count(*) from private.event_site_contact_messages $$,
  '42501', null, 'CONTACT-04 — visiteur : ne lit pas la file');
select throws_ok(
  $$ select * from public.worker_claim_event_site_contact(gen_random_uuid()) $$,
  '42501', null, 'CONTACT-05 — visiteur : ne joue pas le worker');
select throws_ok(
  $$ select public.submit_event_site_contact('trail-de-test', '203.0.113.7', 'Alex', 'pas-une-adresse', null, 'Bonjour') $$,
  '23514', null, 'CONTACT-06 — une adresse qui n''en est pas une est refusée');
reset role;

select is(
  (select race_id from private.event_site_contact_messages limit 1), null,
  'CONTACT-07 — une épreuve privée ne se désigne pas depuis le site');
select ok(
  (select ip_hash <> '203.0.113.7' and char_length(ip_hash) = 64
   from private.event_site_contact_attempts limit 1),
  'CONTACT-08 — l''IP n''est gardée qu''en empreinte');
select is(
  (select count(*)::integer from private.outbox_events where event_type = 'email.event_site_contact'),
  1, 'CONTACT-09 — l''envoi est confié au worker par l''outbox');

-- ============================================================
-- 3. La limite de débit
-- ============================================================

select pg_temp.act_as_anon();
select is(
  array[
    public.submit_event_site_contact('trail-de-test', '203.0.113.7', 'Alex', 'alex@test.pluka', null, 'Deux'),
    public.submit_event_site_contact('trail-de-test', '203.0.113.7', 'Alex', 'alex@test.pluka', null, 'Trois'),
    public.submit_event_site_contact('trail-de-test', '203.0.113.7', 'Alex', 'alex@test.pluka', null, 'Quatre'),
    public.submit_event_site_contact('trail-de-test', '203.0.113.7', 'Alex', 'alex@test.pluka', null, 'Cinq'),
    public.submit_event_site_contact('trail-de-test', '203.0.113.7', 'Alex', 'alex@test.pluka', null, 'Six'),
    public.submit_event_site_contact('trail-de-test', '198.51.100.4', 'Sam', 'sam@test.pluka', '80k', 'Autre adresse')
  ],
  array['sent', 'sent', 'sent', 'sent', 'limited', 'sent'],
  'CONTACT-10 — cinq messages par heure et par empreinte ; une autre empreinte passe');
reset role;

select is(
  (select count(*)::integer from private.event_site_contact_messages), 6,
  'CONTACT-11 — un message refusé par la limite n''entre pas en file');
select is(
  (select race_id from private.event_site_contact_messages where sender_name = 'Sam'),
  'aaaaaaaa-0000-4000-8000-000000000013'::uuid,
  'CONTACT-12 — une épreuve publique se désigne');

-- ============================================================
-- 4. Le worker envoie, puis efface
-- ============================================================

-- Les identifiants se lisent en propriétaire : `service_role` n'a pas accès
-- au schéma `private`, il n'en connaît que les fonctions `worker_*`.
select id as sam_id from private.event_site_contact_messages where sender_name = 'Sam' \gset
select id as deux_id from private.event_site_contact_messages where body = 'Deux' \gset

set local role service_role;
create temporary table claimed on commit drop as
  select * from public.worker_claim_event_site_contact(:'sam_id');
reset role;

select is((select recipient_email from claimed), 'courses@trail-de-test.test',
  'CONTACT-13 — le worker lit le destinataire');
select is((select race_name from claimed), '80K', 'CONTACT-14 — et l''épreuve concernée');

set local role service_role;
select public.worker_complete_event_site_contact(:'sam_id');
reset role;

select is(
  (select count(*)::integer from private.event_site_contact_messages where sender_name = 'Sam'), 0,
  'CONTACT-15 — envoyé : le contenu est effacé');
select is(
  (select count(*)::integer from private.event_site_contact_attempts where status = 'sent'), 1,
  'CONTACT-16 — la trace, elle, reste, marquée envoyée');

set local role service_role;
select is(
  (select sendable from public.worker_claim_event_site_contact(:'sam_id')),
  false, 'CONTACT-17 — un message rejoué après envoi s''arrête');
select public.worker_fail_event_site_contact(:'deux_id', 'PROVIDER_DOWN', true);
reset role;

select is(
  (select count(*)::integer from private.event_site_contact_messages where body = 'Deux'), 0,
  'CONTACT-18 — abandonné : le contenu est effacé aussi');

-- ============================================================
-- 5. Les documents diffusés
-- ============================================================

update public.sources set storage_path = 'aaaaaaaa-0000-4000-8000-000000000091/reglement.pdf'
where id = 'aaaaaaaa-0000-4000-8000-000000000091';
insert into storage.objects (bucket_id, name)
values ('race-sources', 'aaaaaaaa-0000-4000-8000-000000000091/reglement.pdf');

select pg_temp.act_as_anon();
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'race-sources'), 0,
  'CONTACT-19 — un document non diffusé ne se lit pas');
select is(public.event_site_document_path('aaaaaaaa-0000-4000-8000-000000000091'), null,
  'CONTACT-20 — ni son chemin');
reset role;

update public.sources set public_download_at = now()
where id = 'aaaaaaaa-0000-4000-8000-000000000091';

select pg_temp.act_as_anon();
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'race-sources'), 1,
  'CONTACT-21 — diffusé, sur un site en ligne : il se lit');
reset role;

update public.event_sites set status = 'draft' where event_id = 'aaaaaaaa-0000-4000-8000-000000000011';

select pg_temp.act_as_anon();
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'race-sources'), 0,
  'CONTACT-22 — site retiré : le document ne se lit plus');
reset role;

select * from finish();
rollback;
