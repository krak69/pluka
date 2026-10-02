-- PLUKA — Écritures de la console d'administration
-- Référence : docs/03_PRIVACY_RLS.md §55, §91, §92, §104, §136 · migration 0029
--
-- POURQUOI CE FICHIER
--
-- 0029 ouvre cinq écritures qui contournent la RLS. Comme en 0028, chacune
-- porte sa propre garde, et une garde portée par du code n'est vraie que si
-- elle est vérifiée.
--
-- CONTRAT DE LA SUITE
--
-- §136 : « positif + négatif », pour chaque écriture :
--
-- - un coureur, un owner d'organisation — qui modère pourtant sa communauté
--   via 0005 — et un visiteur anonyme sont refusés, rien ne change, et le
--   journal reste vide ;
-- - l'administrateur obtient la transition, et exactement une entrée d'audit ;
-- - une transition invalide est refusée en `55000`, sans entrée d'audit.
--
-- Et les décisions de modération du lot 4b : masquer clôt les signalements
-- frères sous une seule entrée d'audit qui les liste, classer sans suite n'en
-- clôt qu'un, et chaque signalement garde son motif et son déclarant.

begin;

create extension if not exists pgtap;

select plan(64);

\ir _personas.psql

-- ============================================================
-- Monde complémentaire
-- ============================================================

-- Banque Nutrition : deux propositions, une fiche validée, une archivée.
insert into public.nutrition_products (id, brand, name, category, carbs_g, status) values
  ('eeeeeeee-0000-4000-8000-000000000011', 'Marque Test', 'Gel a valider', 'gel', 22, 'draft'),
  ('eeeeeeee-0000-4000-8000-000000000012', 'Marque Test', 'Gel a refuser', 'gel', 20, 'draft'),
  ('eeeeeeee-0000-4000-8000-000000000013', 'Marque Test', 'Gel catalogue', 'gel', 25, 'validated'),
  ('eeeeeeee-0000-4000-8000-000000000014', 'Marque Test', 'Gel archive', 'gel', 18, 'archived');

-- Fil T, sur l'édition d'Org A, avec deux messages P1 et P2.
insert into public.community_threads (id, edition_id, author_user_id, category, title, body) values
  ('eeeeeeee-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000012',
   '11111111-1111-4111-8111-111111111111', 'race', 'Fil T', 'Corps du fil T'),
  ('eeeeeeee-0000-4000-8000-000000000025', 'aaaaaaaa-0000-4000-8000-000000000012',
   '11111111-1111-4111-8111-111111111111', 'race', 'Fil U', 'Corps du fil U');

insert into public.community_posts (id, thread_id, author_user_id, body) values
  ('eeeeeeee-0000-4000-8000-000000000022', 'eeeeeeee-0000-4000-8000-000000000021',
   '22222222-2222-4222-8222-222222222222', 'Contenu signale P1'),
  ('eeeeeeee-0000-4000-8000-000000000023', 'eeeeeeee-0000-4000-8000-000000000021',
   '22222222-2222-4222-8222-222222222222', 'Contenu signale P2'),
  ('eeeeeeee-0000-4000-8000-000000000026', 'eeeeeeee-0000-4000-8000-000000000025',
   '22222222-2222-4222-8222-222222222222', 'Contenu signale P3');

-- Signalements :
--   R1, R2 sur P1 (deux déclarants, deux motifs) ;
--   R3 sur P2 ; R4 sur le fil T ;
--   R5 sur P1, déjà classé — ne doit pas être touché ;
--   R6, R7 sur P3, dans le fil U — classer R6 ne doit pas classer R7.
insert into public.community_reports (id, reporter_user_id, post_id, thread_id, reason, status) values
  ('eeeeeeee-0000-4000-8000-000000000031', '11111111-1111-4111-8111-111111111111',
   'eeeeeeee-0000-4000-8000-000000000022', null, 'spam', 'open'),
  ('eeeeeeee-0000-4000-8000-000000000032', '33333333-3333-4333-8333-333333333333',
   'eeeeeeee-0000-4000-8000-000000000022', null, 'abuse', 'reviewed'),
  ('eeeeeeee-0000-4000-8000-000000000033', '11111111-1111-4111-8111-111111111111',
   'eeeeeeee-0000-4000-8000-000000000023', null, 'misinformation', 'open'),
  ('eeeeeeee-0000-4000-8000-000000000034', '11111111-1111-4111-8111-111111111111',
   null, 'eeeeeeee-0000-4000-8000-000000000021', 'other', 'open'),
  ('eeeeeeee-0000-4000-8000-000000000035', '11111111-1111-4111-8111-111111111111',
   'eeeeeeee-0000-4000-8000-000000000022', null, 'privacy', 'dismissed'),
  ('eeeeeeee-0000-4000-8000-000000000036', '11111111-1111-4111-8111-111111111111',
   'eeeeeeee-0000-4000-8000-000000000026', null, 'spam', 'open'),
  ('eeeeeeee-0000-4000-8000-000000000037', '33333333-3333-4333-8333-333333333333',
   'eeeeeeee-0000-4000-8000-000000000026', null, 'abuse', 'open');

-- Traitements :
--   J1 en échec, avec son événement outbox d'origine — relançable ;
--   J2 terminé — rien à relancer ;
--   J3 en échec sans événement d'origine — aucune charge utile à rejouer.
insert into private.ingestion_jobs
  (id, source_snapshot_id, job_type, status, idempotency_key, attempts, max_attempts, last_error) values
  ('eeeeeeee-0000-4000-8000-000000000041', 'aaaaaaaa-0000-4000-8000-000000000092',
   'gpx.process', 'failed', 'gpx.process:test-0041', 5, 5, 'Trace interrompue au km 18'),
  ('eeeeeeee-0000-4000-8000-000000000042', 'aaaaaaaa-0000-4000-8000-000000000092',
   'gpx.process', 'completed', 'gpx.process:test-0042', 1, 5, null),
  ('eeeeeeee-0000-4000-8000-000000000043', 'aaaaaaaa-0000-4000-8000-000000000092',
   'gpx.process', 'failed', 'gpx.process:test-0043', 5, 5, 'Erreur sans origine');

insert into private.outbox_events
  (event_type, aggregate_type, aggregate_id, payload, idempotency_key, status) values
  ('gpx.process', 'race', 'aaaaaaaa-0000-4000-8000-000000000013',
   '{"raceId": "aaaaaaaa-0000-4000-8000-000000000013", "idempotencyKey": "gpx.process:test-0041"}',
   'gpx.process:test-0041', 'published');

-- Le journal part d'un état connu : les assertions d'audit comptent des lignes.
delete from private.audit_logs;

-- ============================================================
-- 1. Un non-admin est refusé, et rien ne change
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.admin_hide_reported_content('eeeeeeee-0000-4000-8000-000000000031') $$,
  '42501', null,
  'ADMW-01 — coureur : masquer est refuse'
);

select throws_ok(
  $$ select public.admin_dismiss_report('eeeeeeee-0000-4000-8000-000000000036') $$,
  '42501', null,
  'ADMW-02 — coureur : classer sans suite est refuse'
);

select throws_ok(
  $$ select public.admin_retry_job('eeeeeeee-0000-4000-8000-000000000041') $$,
  '42501', null,
  'ADMW-03 — coureur : relancer un traitement est refuse'
);

select throws_ok(
  $$ select public.admin_validate_nutrition_product('eeeeeeee-0000-4000-8000-000000000011') $$,
  '42501', null,
  'ADMW-04 — coureur : valider une fiche est refuse'
);

select throws_ok(
  $$ select public.admin_archive_nutrition_product('eeeeeeee-0000-4000-8000-000000000013') $$,
  '42501', null,
  'ADMW-05 — coureur : archiver une fiche est refuse'
);

reset role;

-- Owner d'Org A : il modère sa communauté par la policy de 0005, mais la
-- console n'est pas sa porte. Un droit d'organisation ne devient pas un droit
-- plateforme.
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select throws_ok(
  $$ select public.admin_hide_reported_content('eeeeeeee-0000-4000-8000-000000000031') $$,
  '42501', null,
  'ADMW-06 — owner d''organisation : masquer par la console est refuse'
);

select throws_ok(
  $$ select public.admin_validate_nutrition_product('eeeeeeee-0000-4000-8000-000000000011') $$,
  '42501', null,
  'ADMW-07 — owner d''organisation : valider une fiche est refuse'
);

reset role;

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.admin_retry_job('eeeeeeee-0000-4000-8000-000000000041') $$,
  '42501', null,
  'ADMW-08 — anonyme : la fonction ne lui est meme pas executable'
);

reset role;

select is(
  (select count(*) from private.audit_logs),
  0::bigint,
  'ADMW-09 — aucun refus n''ecrit dans le journal'
);

select results_eq(
  $$ select status::text from public.community_reports
      where id in ('eeeeeeee-0000-4000-8000-000000000031', 'eeeeeeee-0000-4000-8000-000000000036')
      order by id $$,
  $$ values ('open'), ('open') $$,
  'ADMW-10 — apres les refus, les signalements sont intacts'
);

select is(
  (select status::text from public.community_posts where id = 'eeeeeeee-0000-4000-8000-000000000022'),
  'published',
  'ADMW-11 — apres les refus, le contenu est toujours publie'
);

select is(
  (select status from private.ingestion_jobs where id = 'eeeeeeee-0000-4000-8000-000000000041'),
  'failed',
  'ADMW-12 — apres les refus, le traitement est toujours en echec'
);

select is(
  (select count(*) from private.outbox_events),
  1::bigint,
  'ADMW-13 — apres les refus, aucun evenement outbox n''a ete emis'
);

select results_eq(
  $$ select status::text from public.nutrition_products
      where id in ('eeeeeeee-0000-4000-8000-000000000011', 'eeeeeeee-0000-4000-8000-000000000013')
      order by id $$,
  $$ values ('draft'), ('validated') $$,
  'ADMW-14 — apres les refus, les fiches sont intactes'
);

-- ============================================================
-- 2. Classer sans suite
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select lives_ok(
  $$ select public.admin_dismiss_report('eeeeeeee-0000-4000-8000-000000000036') $$,
  'ADMW-15 — admin : classer sans suite'
);

select throws_ok(
  $$ select public.admin_dismiss_report('eeeeeeee-0000-4000-8000-000000000036') $$,
  '55000', null,
  'ADMW-16 — un signalement deja classe ne se reclasse pas'
);

select throws_ok(
  $$ select public.admin_dismiss_report('eeeeeeee-0000-4000-8000-0000000000ff') $$,
  'P0002', null,
  'ADMW-17 — un signalement inexistant est introuvable'
);

reset role;

select is(
  (select status::text from public.community_reports where id = 'eeeeeeee-0000-4000-8000-000000000036'),
  'dismissed',
  'ADMW-18 — le signalement est classe'
);

select isnt(
  (select resolved_at from public.community_reports where id = 'eeeeeeee-0000-4000-8000-000000000036'),
  null,
  'ADMW-19 — le classement est date'
);

select is(
  (select status::text from public.community_reports where id = 'eeeeeeee-0000-4000-8000-000000000037'),
  'open',
  'ADMW-20 — classer ne clot que le signalement traite, pas son frere'
);

select is(
  (select status::text from public.community_posts where id = 'eeeeeeee-0000-4000-8000-000000000026'),
  'published',
  'ADMW-21 — classer ne touche pas au contenu'
);

select results_eq(
  $$ select action, entity_id from private.audit_logs $$,
  $$ values ('report.dismiss'::text, 'eeeeeeee-0000-4000-8000-000000000036'::uuid) $$,
  'ADMW-22 — une seule entree d''audit, et pas pour les essais refuses'
);

-- ============================================================
-- 3. Masquer un message
-- ============================================================

delete from private.audit_logs;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select is(
  public.admin_hide_reported_content('eeeeeeee-0000-4000-8000-000000000031'),
  2,
  'ADMW-23 — masquer P1 clot ses deux signalements ouverts'
);

select throws_ok(
  $$ select public.admin_hide_reported_content('eeeeeeee-0000-4000-8000-000000000031') $$,
  '55000', null,
  'ADMW-24 — un signalement clos ne se retraite pas'
);

select throws_ok(
  $$ select public.admin_hide_reported_content('eeeeeeee-0000-4000-8000-0000000000ff') $$,
  'P0002', null,
  'ADMW-25 — masquer depuis un signalement inexistant : introuvable'
);

reset role;

select is(
  (select status::text from public.community_posts where id = 'eeeeeeee-0000-4000-8000-000000000022'),
  'hidden',
  'ADMW-26 — le message est masque'
);

select results_eq(
  $$ select status::text from public.community_reports
      where id in ('eeeeeeee-0000-4000-8000-000000000031', 'eeeeeeee-0000-4000-8000-000000000032')
      order by id $$,
  $$ values ('resolved'), ('resolved') $$,
  'ADMW-27 — le signalement traite et son frere sont resolus'
);

select is(
  (select status::text from public.community_reports where id = 'eeeeeeee-0000-4000-8000-000000000035'),
  'dismissed',
  'ADMW-28 — un signalement deja classe sur le meme contenu n''est pas rouvert en resolu'
);

select is(
  (select status::text from public.community_reports where id = 'eeeeeeee-0000-4000-8000-000000000033'),
  'open',
  'ADMW-29 — masquer un message ne clot pas le signalement d''un autre message du fil'
);

select is(
  (select status::text from public.community_reports where id = 'eeeeeeee-0000-4000-8000-000000000034'),
  'open',
  'ADMW-30 — masquer un message ne clot pas le signalement de son fil'
);

select is(
  (select status::text from public.community_threads where id = 'eeeeeeee-0000-4000-8000-000000000021'),
  'published',
  'ADMW-31 — masquer un message ne masque pas son fil'
);

-- Chaque signalement garde son motif et son déclarant : seuls le statut et la
-- date de traitement changent.
select results_eq(
  $$ select reason::text, reporter_user_id from public.community_reports
      where id = 'eeeeeeee-0000-4000-8000-000000000032' $$,
  $$ values ('abuse'::text, '33333333-3333-4333-8333-333333333333'::uuid) $$,
  'ADMW-32 — le signalement frere garde son motif et son declarant'
);

select is(
  (select count(*) from private.audit_logs),
  1::bigint,
  'ADMW-33 — deux signalements clos, une seule entree d''audit'
);

select is(
  (select action from private.audit_logs),
  'report.hide_content',
  'ADMW-34 — l''entree nomme le geste'
);

select is(
  (select after_data->'closedReportIds' from private.audit_logs),
  '["eeeeeeee-0000-4000-8000-000000000031", "eeeeeeee-0000-4000-8000-000000000032"]'::jsonb,
  'ADMW-35 — l''entree liste les signalements clos : une restauration les retrouvera'
);

select results_eq(
  $$ select after_data->>'contentStatusFrom', after_data->>'contentStatusTo' from private.audit_logs $$,
  $$ values ('published'::text, 'hidden'::text) $$,
  'ADMW-36 — l''entree porte la transition du contenu'
);

select is(
  (select actor_user_id from private.audit_logs),
  '88888888-8888-4888-8888-888888888888'::uuid,
  'ADMW-37 — l''entree designe l''administrateur'
);

-- §92 : ni contenu, ni email dans le journal.
select is(
  (select count(*) from private.audit_logs
    where after_data::text like '%Contenu%' or after_data::text like '%@%'),
  0::bigint,
  'ADMW-38 — le journal ne recopie ni le contenu signale ni une adresse'
);

-- ============================================================
-- 4. Masquer un fil
-- ============================================================

delete from private.audit_logs;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select is(
  public.admin_hide_reported_content('eeeeeeee-0000-4000-8000-000000000034'),
  2,
  'ADMW-39 — masquer le fil T clot son signalement et celui de son message P2'
);

reset role;

select is(
  (select status::text from public.community_threads where id = 'eeeeeeee-0000-4000-8000-000000000021'),
  'hidden',
  'ADMW-40 — le fil est masque'
);

select is(
  (select status::text from public.community_reports where id = 'eeeeeeee-0000-4000-8000-000000000033'),
  'resolved',
  'ADMW-41 — le signalement d''un message du fil est clos avec lui'
);

select is(
  (select after_data->'closedReportIds' from private.audit_logs),
  '["eeeeeeee-0000-4000-8000-000000000033", "eeeeeeee-0000-4000-8000-000000000034"]'::jsonb,
  'ADMW-42 — l''entree liste aussi le signalement du message'
);

select is(
  (select status::text from public.community_reports where id = 'eeeeeeee-0000-4000-8000-000000000037'),
  'open',
  'ADMW-43 — un autre fil n''est pas touche'
);

-- ============================================================
-- 5. Relancer un traitement
-- ============================================================

delete from private.audit_logs;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select is(
  public.admin_retry_job('eeeeeeee-0000-4000-8000-000000000041'),
  1,
  'ADMW-44 — admin : premiere relance'
);

-- Idempotence (§22.1) : le job est `queued`, une seconde relance n'émet rien.
select throws_ok(
  $$ select public.admin_retry_job('eeeeeeee-0000-4000-8000-000000000041') $$,
  '55000', null,
  'ADMW-45 — un job deja remis en file ne se relance pas deux fois'
);

select throws_ok(
  $$ select public.admin_retry_job('eeeeeeee-0000-4000-8000-000000000042') $$,
  '55000', null,
  'ADMW-46 — un job termine ne se relance pas'
);

select throws_ok(
  $$ select public.admin_retry_job('eeeeeeee-0000-4000-8000-000000000043') $$,
  '55000', null,
  'ADMW-47 — un job sans evenement d''origine ne se relance pas'
);

select throws_ok(
  $$ select public.admin_retry_job('eeeeeeee-0000-4000-8000-0000000000ff') $$,
  'P0002', null,
  'ADMW-48 — un job inexistant est introuvable'
);

reset role;

select results_eq(
  $$ select status, attempts from private.ingestion_jobs
      where id = 'eeeeeeee-0000-4000-8000-000000000041' $$,
  $$ values ('queued'::text, 0) $$,
  'ADMW-49 — le job est remis en file, tentatives a zero'
);

select is(
  (select last_error from private.ingestion_jobs where id = 'eeeeeeee-0000-4000-8000-000000000041'),
  'Trace interrompue au km 18',
  'ADMW-50 — la derniere erreur reste lisible jusqu''au prochain passage'
);

select results_eq(
  $$ select event_type, status, payload from private.outbox_events
      where idempotency_key = 'gpx.process:test-0041:retry:1' $$,
  $$ select 'gpx.process'::text, 'pending'::text, payload from private.outbox_events
      where idempotency_key = 'gpx.process:test-0041' $$,
  'ADMW-51 — l''evenement d''origine est rejoue, meme charge utile, en attente'
);

select is(
  (select count(*) from private.outbox_events),
  2::bigint,
  'ADMW-52 — une relance, un evenement : les refus n''en ont emis aucun'
);

select is(
  (select status from private.ingestion_jobs where id = 'eeeeeeee-0000-4000-8000-000000000043'),
  'failed',
  'ADMW-53 — le job sans origine reste en echec'
);

select results_eq(
  $$ select action, (after_data->>'previousAttempts')::int, (after_data->>'retry')::int
      from private.audit_logs $$,
  $$ values ('job.retry'::text, 5, 1) $$,
  'ADMW-54 — une seule entree d''audit, tentatives precedentes et numero de relance'
);

select is(
  (select count(*) from private.audit_logs where after_data::text like '%km 18%'),
  0::bigint,
  'ADMW-55 — le journal ne recopie pas la derniere erreur'
);

-- ============================================================
-- 6. Banque Nutrition
-- ============================================================

delete from private.audit_logs;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select lives_ok(
  $$ select public.admin_validate_nutrition_product('eeeeeeee-0000-4000-8000-000000000011') $$,
  'ADMW-56 — admin : valider une proposition'
);

select throws_ok(
  $$ select public.admin_validate_nutrition_product('eeeeeeee-0000-4000-8000-000000000013') $$,
  '55000', null,
  'ADMW-57 — une fiche deja validee ne se revalide pas'
);

select lives_ok(
  $$ select public.admin_archive_nutrition_product('eeeeeeee-0000-4000-8000-000000000012') $$,
  'ADMW-58 — admin : refuser une proposition (draft vers archived)'
);

select lives_ok(
  $$ select public.admin_archive_nutrition_product('eeeeeeee-0000-4000-8000-000000000013') $$,
  'ADMW-59 — admin : retirer une fiche du catalogue (validated vers archived)'
);

select throws_ok(
  $$ select public.admin_archive_nutrition_product('eeeeeeee-0000-4000-8000-000000000014') $$,
  '55000', null,
  'ADMW-60 — une fiche archivee ne se rearchive pas'
);

select throws_ok(
  $$ select public.admin_validate_nutrition_product('eeeeeeee-0000-4000-8000-000000000014') $$,
  '55000', null,
  'ADMW-61 — une fiche archivee ne se valide pas'
);

reset role;

select results_eq(
  $$ select status::text, verified_at is not null from public.nutrition_products
      where id::text like 'eeeeeeee-%' order by id $$,
  $$ values ('validated'::text, true), ('archived', false), ('archived', false), ('archived', false) $$,
  'ADMW-62 — statuts et date de verification apres les gestes'
);

-- Le Gel catalogue gardait son `verified_at` nul : la fixture ne le pose pas.
-- Ce qui compte est qu'archiver n'en invente pas un.

select results_eq(
  $$ select action, entity_id, after_data->>'statusFrom' from private.audit_logs order by id $$,
  $$ values
       ('nutrition_product.validate'::text, 'eeeeeeee-0000-4000-8000-000000000011'::uuid, 'draft'::text),
       ('nutrition_product.archive', 'eeeeeeee-0000-4000-8000-000000000012'::uuid, 'draft'),
       ('nutrition_product.archive', 'eeeeeeee-0000-4000-8000-000000000013'::uuid, 'validated') $$,
  'ADMW-63 — trois gestes reussis, trois entrees ; les refus n''en ecrivent aucune'
);

-- La fiche validée devient lisible d'un coureur : c'est l'effet attendu de la
-- validation, et la preuve qu'elle n'est pas qu'un changement d'étiquette.
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select results_eq(
  $$ select name from public.nutrition_products where id::text like 'eeeeeeee-%' $$,
  $$ values ('Gel a valider'::text) $$,
  'ADMW-64 — un coureur voit la fiche validee, et aucune fiche archivee'
);

reset role;

select * from finish();

rollback;
