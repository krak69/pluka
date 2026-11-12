-- PLUKA — Canal A : le lien de l'organisation, et l'ajout d'une course
-- Référence : migration 0087 · docs/00_PRODUCT_SPEC.md §6.5.4 · docs/04_ENTITLEMENTS.md §73.1, E45
--
-- 1. Chaque édition d'une organisation reçoit son code, lisible par elle seule.
-- 2. Le lien s'ouvre sans compte et ne montre que l'édition et ses épreuves publiées.
-- 3. Le coureur ajoute sa course lui-même ; le code valide se pose, l'autre est ignoré et journalisé.
-- 4. Personne ne s'inscrit pour un autre, ni sur une épreuve fermée.
-- 5. Seul PLUKA coupe un lien ; l'attribution reste côté serveur.

begin;

create extension if not exists pgtap;

select plan(18);

\ir _personas.psql

-- Lu ici, avec tous les droits : la table des codes n'est ouverte à aucun client.
select code as code_a from public.organization_referral_codes
where edition_id = 'aaaaaaaa-0000-4000-8000-000000000012' \gset

-- ============================================================
-- 1. Les codes
-- ============================================================

select ok(:'code_a' ~ '^TRAILDETEST26',
  'REF-01 — une édition reçoit un code lisible, tiré de l''événement et de l''année');
select is(
  (select count(*)::integer from public.organization_referral_codes
   where edition_id in ('aaaaaaaa-0000-4000-8000-000000000012', 'bbbbbbbb-0000-4000-8000-000000000012')),
  2, 'REF-02 — une par édition, pour chaque organisation');

insert into public.editions (id, event_id, year, slug, start_date, status) values
  ('aaaaaaaa-0000-4000-8000-000000000099', 'aaaaaaaa-0000-4000-8000-000000000011',
   2027, 'trail-de-test-2027', '2027-06-19', 'draft');
select is(
  (select code from public.organization_referral_codes
   where edition_id = 'aaaaaaaa-0000-4000-8000-000000000099'),
  'TRAILDETEST27', 'REF-03 — une nouvelle édition reçoit son code à sa création');

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select is(
  (select code from public.org_get_referral_code('aaaaaaaa-0000-4000-8000-000000000012')),
  :'code_a', 'REF-04 — un viewer de l''organisation lit son lien');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select * from public.org_get_referral_code('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'REF-05 — une autre organisation ne le lit pas');
reset role;

-- ============================================================
-- 2. Le lien, sans compte
-- ============================================================

set local role anon;
select is(
  (select format('%s/%s/%s', event_slug, edition_slug, jsonb_array_length(races))
   from public.resolve_referral_code(lower(:'code_a'))),
  'trail-de-test/trail-de-test-2026/1',
  'REF-06 — le lien s''ouvre sans compte, sans la casse, et ne montre que l''épreuve publique');
-- `Trail Confidentiel` est en brouillon : son code, devinable, ne doit pas même dire son nom.
select is(
  (select count(*)::integer from public.resolve_referral_code('TRAILCONFIDENTIEL26')),
  0, 'REF-06b — le code d''un événement non publié ne révèle rien');
reset role;

-- ============================================================
-- 3. L'ajout d'une course
-- ============================================================

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select public.attach_participant_race('aaaaaaaa-0000-4000-8000-000000000013', :'code_a') as attached \gset
reset role;

select is(
  (select format('%s/%s', user_id, registration_source) from public.participant_races where id = :'attached'),
  '22222222-2222-4222-8222-222222222222/direct',
  'REF-07 — le coureur de la session ajoute sa course');
select is(
  (select c.code from public.participant_races pr
   join public.organization_referral_codes c on c.id = pr.referral_code_id where pr.id = :'attached'),
  :'code_a', 'REF-08 — un code valide de l''édition se pose sur la participation');

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ select public.attach_participant_race('aaaaaaaa-0000-4000-8000-000000000013') $$,
  '23505', null, 'REF-09 — une course déjà ajoutée ne se double pas');
reset role;

-- Runner A tente, sur l'épreuve d'Org B, le code d'une édition d'Org A.
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select public.attach_participant_race('bbbbbbbb-0000-4000-8000-000000000013', :'code_a') as foreign_code \gset
reset role;

select is(
  (select referral_code_id from public.participant_races where id = :'foreign_code'),
  null::uuid, 'REF-10 — le code d''une autre édition est ignoré : la course s''ajoute sans attribution');
select is(
  (select after_data ->> 'reason' from private.audit_logs
   where action = 'referral.ignored' and entity_id = 'bbbbbbbb-0000-4000-8000-000000000013'
     and actor_user_id = '11111111-1111-4111-8111-111111111111'),
  'other_edition', 'REF-11 — l''anomalie est journalisée (§73.1)');

-- ============================================================
-- 4. Ce qui se refuse
-- ============================================================

set local role anon;
select throws_ok(
  $$ select public.attach_participant_race('aaaaaaaa-0000-4000-8000-000000000013') $$,
  '42501', null, 'REF-12 — sans compte, aucune course ne s''ajoute');
reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ select public.attach_participant_race('aaaaaaaa-0000-4000-8000-000000000014') $$,
  'P0002', null, 'REF-13 — une épreuve privée ne s''ajoute pas depuis un lien');
select throws_ok(
  $$ insert into public.participant_races (race_id, user_id)
     values ('aaaaaaaa-0000-4000-8000-000000000013', '33333333-3333-4333-8333-333333333333') $$,
  '42501', null, 'REF-14 — personne n''écrit une participation directement, ni pour un autre');
reset role;

-- ============================================================
-- 5. Côté PLUKA, côté serveur
-- ============================================================

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ select public.admin_set_referral_code_active('aaaaaaaa-0000-4000-8000-000000000012', false) $$,
  '42501', null, 'REF-15 — le propriétaire ne coupe pas son lien lui-même');
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select public.admin_set_referral_code_active('aaaaaaaa-0000-4000-8000-000000000012', false);
reset role;
set local role anon;
select is(
  (select count(*)::integer from public.resolve_referral_code(:'code_a')),
  0, 'REF-16 — un lien coupé ne mène plus nulle part');
reset role;

select ok(
  not has_column_privilege('authenticated', 'public.participant_races', 'referral_code_id', 'select'),
  'REF-17 — l''attribution ne se lit pas côté client');

select * from finish();
rollback;
