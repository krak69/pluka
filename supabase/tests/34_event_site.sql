-- PLUKA — Le site de l'événement
-- Référence : migration 0049 · docs/features/EVENT_SITE.md §14 · AGENTS §91, §92
--
-- 1. Qui édite, qui publie, qui suspend — et les autres organisations.
-- 2. Ce que lit un visiteur : rien tant que rien n'est en ligne, jamais une
--    épreuve privée ni l'adresse de contact.
-- 3. Les documents ne se diffusent que sur autorisation d'owner ou d'admin.
-- 4. Les anciens slugs redirigent et restent à leur événement ; les
--    sous-domaines réservés ne deviennent pas des slugs.
-- 5. Le contact : une trace sans contenu, une limite de débit, le serveur seul.

begin;

create extension if not exists pgtap;

select plan(42);

\ir _personas.psql

-- ============================================================
-- 1. Rien n'est en ligne avant qu'on le mette en ligne
-- ============================================================

select pg_temp.act_as_anon();
select is(public.event_site_public('trail-de-test'), null,
  'SITE-01 — pas de site : un visiteur ne lit rien');
reset role;

-- ============================================================
-- 2. Qui édite
-- ============================================================

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]') $$,
  '42501', null, 'SITE-02 — lecteur de l''organisation : n''édite pas');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]') $$,
  '42501', null, 'SITE-03 — owner d''une autre organisation : n''édite pas');
reset role;

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null, '[]') $$,
  '42501', null, 'SITE-04 — ancien membre : n''édite plus');
reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select lives_ok(
  $$ select public.save_event_site(
       'aaaaaaaa-0000-4000-8000-000000000011', '#1F6FEB', 'oswald', 'courses@trail-de-test.test',
       '[{"title": "Hébergement", "body": "Gîte du col, 40 places."},
         {"title": "Stationnement", "body": "Parking de la salle des fêtes."}]') $$,
  'SITE-05 — éditeur : enregistre l''identité, le contact et les blocs');
select is(
  (select accent_color from public.event_sites where event_id = 'aaaaaaaa-0000-4000-8000-000000000011'),
  '#1f6feb', 'SITE-06 — l''accent est rangé en minuscules');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', 'bleu', null, null, '[]') $$,
  '23514', null, 'SITE-07 — un accent qui n''est pas une couleur est refusé');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, 'comic-sans', null, '[]') $$,
  '23514', null, 'SITE-08 — une police hors de la liste est refusée');
select throws_ok(
  $$ select public.save_event_site('aaaaaaaa-0000-4000-8000-000000000011', null, null, null,
       '[{"title": "", "body": "Vide"}]') $$,
  '23514', null, 'SITE-09 — un bloc sans titre est refusé');
select throws_ok(
  $$ select public.set_event_site_image('aaaaaaaa-0000-4000-8000-000000000011', 'logo',
       'bbbbbbbb-0000-4000-8000-000000000011/logo.png') $$,
  '22023', 'INVALID_ASSET_PATH', 'SITE-10 — une image hors du dossier de l''événement est refusée');
select throws_ok(
  $$ select public.set_event_site_image('aaaaaaaa-0000-4000-8000-000000000011', 'logo',
       'aaaaaaaa-0000-4000-8000-000000000011/logo.svg') $$,
  '22023', 'INVALID_ASSET_PATH', 'SITE-11 — un SVG est refusé');
select lives_ok(
  $$ select public.set_event_site_image('aaaaaaaa-0000-4000-8000-000000000011', 'logo',
       'aaaaaaaa-0000-4000-8000-000000000011/logo.png') $$,
  'SITE-12 — éditeur : pose le logo');
with written as (
  update public.event_sites set status = 'published', published_at = now()
  where event_id = 'aaaaaaaa-0000-4000-8000-000000000011' returning 1
)
select is(count(*)::integer, 0, 'SITE-13 — aucune écriture directe sur le site') from written;
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select lives_ok(
  $$ select public.save_event_site(
       'aaaaaaaa-0000-4000-8000-000000000011', '#1f6feb', 'oswald', 'courses@trail-de-test.test',
       '[{"title": "Hébergement", "body": "Gîte du col, 40 places."},
         {"title": "Stationnement", "body": "Parking de la salle des fêtes."}]') $$,
  'SITE-14 — admin PLUKA : peut intervenir');
reset role;

-- ============================================================
-- 3. Qui publie
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.set_event_site_status('aaaaaaaa-0000-4000-8000-000000000011', 'published') $$,
  '42501', null, 'SITE-15 — éditeur : ne met pas en ligne');
reset role;

select pg_temp.act_as_anon();
select is(public.event_site_public('trail-de-test'), null,
  'SITE-16 — brouillon : un visiteur ne lit rien');
select is_empty($$ select 1 from public.event_sites $$,
  'SITE-17 — un visiteur ne lit jamais la table du site');
reset role;

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select lives_ok(
  $$ select public.set_event_site_status('aaaaaaaa-0000-4000-8000-000000000011', 'published') $$,
  'SITE-18 — admin de l''organisation : met en ligne');
select throws_ok(
  $$ select public.set_event_site_status('aaaaaaaa-0000-4000-8000-000000000011', 'published') $$,
  '55000', null, 'SITE-19 — déjà en ligne : rien à faire');
reset role;

select ok(
  exists (select 1 from private.audit_logs
          where action = 'event_site.status' and entity_id = 'aaaaaaaa-0000-4000-8000-000000000011'),
  'SITE-20 — la mise en ligne est journalisée');

-- ============================================================
-- 4. Ce que lit un visiteur
-- ============================================================

select pg_temp.act_as_anon();
select is(public.event_site_public('trail-de-test') -> 'event' ->> 'name', 'Trail de Test',
  'SITE-21 — en ligne : un visiteur lit le site');
select is(
  (select jsonb_agg(r ->> 'name') from jsonb_array_elements(public.event_site_public('trail-de-test') -> 'races') r),
  '["80K"]'::jsonb,
  'SITE-22 — seules les épreuves publiques y figurent');
select is(position('courses@trail-de-test.test' in public.event_site_public('trail-de-test')::text), 0,
  'SITE-23 — l''adresse de contact ne sort jamais');
select is((public.event_site_public('trail-de-test') ->> 'hasContact')::boolean, true,
  'SITE-24 — seul le fait qu''elle existe sort');
select is(public.event_site_public('trail-de-test') -> 'sections' -> 0 ->> 'title', 'Hébergement',
  'SITE-25 — les blocs sortent dans leur ordre');
select is(public.event_site_public('trail-de-test') -> 'edition' ->> 'year', '2026',
  'SITE-26 — l''édition affichée est la dernière, à défaut d''une à venir');
select is(public.event_site_public('TRAIL-de-test') -> 'event' ->> 'slug', 'trail-de-test',
  'SITE-27 — l''hôte se lit sans égard à la casse');
select is(jsonb_array_length(public.event_site_public('trail-de-test') -> 'documents'), 0,
  'SITE-28 — aucun document n''est diffusé sans autorisation');
reset role;

-- ============================================================
-- 5. Diffuser un document
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.set_source_public_download('aaaaaaaa-0000-4000-8000-000000000091', true) $$,
  '42501', null, 'SITE-29 — éditeur : ne diffuse pas un document');
select throws_ok(
  $$ update public.sources set public_download_at = now()
     where id = 'aaaaaaaa-0000-4000-8000-000000000091' $$,
  '42501', null, 'SITE-30 — éditeur : ne contourne pas par une écriture directe');
reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select lives_ok(
  $$ select public.set_source_public_download('aaaaaaaa-0000-4000-8000-000000000091', true) $$,
  'SITE-31 — owner : autorise la diffusion');
reset role;

select pg_temp.act_as_anon();
select is(public.event_site_public('trail-de-test') -> 'documents' -> 0 ->> 'title', 'Règlement officiel',
  'SITE-32 — le document autorisé apparaît');
reset role;

-- ============================================================
-- 6. Suspendre
-- ============================================================

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ select public.set_event_site_status('aaaaaaaa-0000-4000-8000-000000000011', 'suspended') $$,
  '42501', null, 'SITE-33 — owner : ne suspend pas');
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select lives_ok(
  $$ select public.set_event_site_status('aaaaaaaa-0000-4000-8000-000000000011', 'suspended') $$,
  'SITE-34 — admin PLUKA : suspend');
reset role;

select pg_temp.act_as_anon();
select is(public.event_site_public('trail-de-test'), null, 'SITE-35 — suspendu : hors ligne');
reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ select public.set_event_site_status('aaaaaaaa-0000-4000-8000-000000000011', 'published') $$,
  '42501', null, 'SITE-36 — owner : ne lève pas une suspension');
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select public.set_event_site_status('aaaaaaaa-0000-4000-8000-000000000011', 'published');
reset role;

-- Une organisation qui n'est plus active n'a plus de site en ligne.
update public.organizations set status = 'suspended' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select pg_temp.act_as_anon();
select is(public.event_site_public('trail-de-test'), null, 'SITE-37 — organisation suspendue : hors ligne');
reset role;
update public.organizations set status = 'active' where id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- ============================================================
-- 7. Slugs : réservés, anciens, repris
-- ============================================================

select throws_ok(
  $$ update public.events set slug = 'app' where id = 'aaaaaaaa-0000-4000-8000-000000000011' $$,
  '22023', 'RESERVED_SUBDOMAIN', 'SITE-38 — un sous-domaine réservé ne devient pas un slug');

update public.events set slug = 'trail-de-test-v2' where id = 'aaaaaaaa-0000-4000-8000-000000000011';

select pg_temp.act_as_anon();
select is(public.event_site_public('trail-de-test') ->> 'redirectTo', 'trail-de-test-v2',
  'SITE-39 — l''ancien slug redirige vers le nouveau');
reset role;

select throws_ok(
  $$ update public.events set slug = 'trail-de-test' where id = 'bbbbbbbb-0000-4000-8000-000000000011' $$,
  '23505', 'SLUG_HELD_BY_ANOTHER_EVENT', 'SITE-40 — un ancien slug ne passe pas à un autre événement');

-- ============================================================
-- 8. Contact : le serveur seul, une limite, aucune donnée
-- ============================================================

select pg_temp.act_as_anon();
select throws_ok(
  $$ select public.claim_event_site_contact('aaaaaaaa-0000-4000-8000-000000000011', repeat('a', 32),
       interval '10 minutes', 2, 3) $$,
  '42501', null, 'SITE-41 — un visiteur n''écrit pas la trace lui-même');
reset role;

set local role service_role;
select is(
  array[
    public.claim_event_site_contact('aaaaaaaa-0000-4000-8000-000000000011', repeat('a', 32), interval '10 minutes', 2, 3) is not null,
    public.claim_event_site_contact('aaaaaaaa-0000-4000-8000-000000000011', repeat('a', 32), interval '10 minutes', 2, 3) is not null,
    public.claim_event_site_contact('aaaaaaaa-0000-4000-8000-000000000011', repeat('a', 32), interval '10 minutes', 2, 3) is not null,
    public.claim_event_site_contact('aaaaaaaa-0000-4000-8000-000000000011', repeat('b', 32), interval '10 minutes', 2, 3) is not null,
    public.claim_event_site_contact('aaaaaaaa-0000-4000-8000-000000000011', repeat('c', 32), interval '10 minutes', 2, 3) is not null
  ],
  array[true, true, false, true, false],
  'SITE-42 — deux envois par empreinte, trois par événement, puis plus rien');
reset role;

select * from finish();
rollback;
