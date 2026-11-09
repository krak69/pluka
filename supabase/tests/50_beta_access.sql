-- PLUKA — Accès bêta : accorder, réserver, retirer
-- Référence : docs/04_ENTITLEMENTS.md §14, §61 · migration 0073

begin;

create extension if not exists pgtap;

select plan(12);

\ir _personas.psql


select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select throws_ok(
  $$ select public.admin_grant_beta_access(array['runner-a@test.pluka'], now() + interval '30 days') $$,
  '42501', null, 'BETA-01 — un membre d''organisation n''accorde pas d''accès bêta');
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select throws_ok(
  $$ select public.admin_grant_beta_access(array['runner-a@test.pluka'], now() - interval '1 day') $$,
  '22023', null, 'BETA-02 — la date de fin est obligatoire et future (§14)');

select is(
  public.admin_grant_beta_access(
    array['runner-a@test.pluka', 'Futur.Testeur@Example.com', 'pas-une-adresse', ''],
    now() + interval '30 days', 'Bêta de novembre'),
  '{"granted": 1, "extended": 0, "reserved": 1, "invalid": 1}'::jsonb,
  'BETA-03 — un compte reçoit l''accès, une adresse sans compte est réservée');

select is(
  public.admin_grant_beta_access(array['runner-a@test.pluka'], now() + interval '60 days'),
  '{"granted": 0, "extended": 1, "reserved": 0, "invalid": 0}'::jsonb,
  'BETA-04 — accorder à nouveau prolonge l''accès en cours');
reset role;

select is(
  (select count(*)::integer from public.beta_access_grants
   where user_id = '11111111-1111-4111-8111-111111111111' and status = 'active'),
  1, 'BETA-05 — un seul accès bêta global actif par compte');
select ok(
  (select ends_at > now() + interval '59 days' from public.beta_access_grants
   where user_id = '11111111-1111-4111-8111-111111111111' and status = 'active'),
  'BETA-06 — la prolongation repousse la date de fin');

-- La réservation s'ouvre à la création du compte.
insert into auth.users (id, email) values
  ('cccccccc-1111-4111-8111-000000000009', 'futur.testeur@example.com');

select is(
  (select scope_type::text || ':' || status::text from public.beta_access_grants
   where user_id = 'cccccccc-1111-4111-8111-000000000009'),
  'global:active', 'BETA-07 — le compte créé reçoit l''accès réservé');
select is_empty(
  $$ select email from private.beta_access_reservations where email = 'futur.testeur@example.com' $$,
  'BETA-08 — la réservation est consommée');

-- Le coureur lit son propre accès, et seulement le sien.
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::integer from public.beta_access_grants),
  1, 'BETA-09 — le testeur lit son accès');
reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is_empty($$ select id from public.beta_access_grants $$,
  'BETA-10 — un autre compte ne le lit pas');
reset role;

select id as grant_id from public.beta_access_grants
where user_id = '11111111-1111-4111-8111-111111111111' and status = 'active' \gset

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select lives_ok(
  format($$ select public.admin_revoke_beta_access(%L, 'Fin du test') $$, :'grant_id'),
  'BETA-11 — PLUKA retire un accès');
select is(
  (select status from public.admin_list_beta_access() where email = 'runner-a@test.pluka'),
  'revoked', 'BETA-12 — la liste dit qu''il est retiré');
reset role;

select * from finish();
rollback;
