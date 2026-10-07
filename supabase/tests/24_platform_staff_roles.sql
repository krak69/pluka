-- PLUKA — Rôles de l'équipe PLUKA : super-admin, admin, support
-- Référence : docs/03_PRIVACY_RLS.md §4, §8, §104, §136 · migration 0035
--
-- §136 : « positif + négatif ».
--
-- 1. Support lit — vue d'ensemble, organisations, utilisateurs, traitements,
--    journal, événements — et n'écrit rien : ni RPC de console, ni policy
--    d'écriture, ni équipe d'organisation.
-- 2. Admin garde toutes les écritures d'avant 0035.
-- 3. Le rôle ne se pose pas depuis un client, et entrer dans l'équipe sans
--    rôle donne le plus étroit des rôles d'écriture.

begin;

create extension if not exists pgtap;

select plan(18);

\ir _personas.psql

delete from private.audit_logs;

-- 8888 est `pluka_admin` dans les personas : il reçoit `admin` par défaut.
-- 9999 (ex-membre) devient support, 2222 (coureur B) reste coureur.
update public.users set platform_role = 'pluka_admin', staff_role = 'support'
where id = '99999999-9999-4999-8999-999999999999';

-- ============================================================
-- 1. Cohérence du rôle
-- ============================================================

select is(
  (select staff_role::text from public.users where id = '88888888-8888-4888-8888-888888888888'),
  'admin',
  'STAFF-01 — un compte passe pluka_admin sans role recoit admin, le plus etroit des roles d''ecriture'
);

select throws_ok(
  $$ update public.users set staff_role = 'admin' where id = '22222222-2222-4222-8222-222222222222' $$,
  '23514', null,
  'STAFF-02 — un role sans appartenance a l''equipe est refuse par la contrainte'
);

-- ============================================================
-- 2. Support lit
-- ============================================================

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');

select is(public.my_staff_role()::text, 'support', 'STAFF-03 — my_staff_role rend le role de la session');

select lives_ok($$ select * from public.admin_platform_counters() $$, 'STAFF-04 — support : la vue d''ensemble');
select lives_ok($$ select * from public.admin_list_organizations(10) $$, 'STAFF-05 — support : les organisations');
select lives_ok(
  $$ select * from public.admin_get_user('11111111-1111-4111-8111-111111111111') $$,
  'STAFF-06 — support : une fiche utilisateur (lecture auditee)'
);
select lives_ok($$ select * from public.admin_list_jobs(10) $$, 'STAFF-07 — support : les traitements');
select lives_ok($$ select * from public.admin_list_audit(10) $$, 'STAFF-08 — support : le journal');

select ok(
  (select count(*) from public.events where status = 'draft') > 0,
  'STAFF-09 — support : les evenements en brouillon sont lisibles'
);

select lives_ok(
  $$ select * from public.org_list_members('aaaaaaaa-0000-4000-8000-000000000001') $$,
  'STAFF-10 — support : l''equipe d''une organisation'
);

-- ============================================================
-- 3. Support n'écrit rien
-- ============================================================

select throws_ok(
  $$ select public.admin_create_organization('Org S', 'org-s') $$,
  '42501', null,
  'STAFF-11 — support : creer une organisation est refuse'
);

select throws_ok(
  $$ select public.admin_list_fact_candidates(10) $$,
  '42501', null,
  'STAFF-12 — support : la file de validation reste fermee (lecture hors de sa liste)'
);

select throws_ok(
  $$ insert into public.events (organization_id, name, slug) values (null, 'Support', 'support-event') $$,
  '42501', null,
  'STAFF-13 — support : la policy d''ecriture des evenements le refuse'
);

select throws_ok(
  $$ select public.org_invite_member('aaaaaaaa-0000-4000-8000-000000000001', 'x@test.pluka', 'viewer') $$,
  '42501', null,
  'STAFF-14 — support : inviter dans une organisation est refuse'
);

select throws_ok(
  $$ update public.users set staff_role = 'super_admin' where id = '99999999-9999-4999-8999-999999999999' $$,
  '42501', null,
  'STAFF-15 — personne ne change son propre role depuis un client'
);

reset role;

-- ============================================================
-- 4. Admin écrit toujours
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select lives_ok(
  $$ select public.admin_create_organization('Org Admin', 'org-admin') $$,
  'STAFF-16 — admin : creer une organisation'
);

select lives_ok(
  $$ insert into public.events (organization_id, name, slug) values (null, 'Admin', 'admin-event') $$,
  'STAFF-17 — admin : la policy d''ecriture des evenements l''accepte'
);

reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is(public.my_staff_role(), null, 'STAFF-18 — un coureur n''a pas de role d''equipe');

reset role;

select * from finish();

rollback;
