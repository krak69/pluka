-- PLUKA — Équipe PLUKA : membres, rôles, invitations
-- Référence : docs/03_PRIVACY_RLS.md §4, §104, §115–§118, §136 · migration 0036
--
-- 1. Seul un super-admin gère l'équipe : ni admin, ni support, ni coureur.
-- 2. Jamais sans super-admin ; retirer rend simple utilisateur.
-- 3. Invitation : jeton tiré par le worker, acceptation par l'adresse invitée
--    seulement, une fois ; le rôle posé est celui de l'invitation.
-- 4. L'audit ne cite aucune adresse.

begin;

create extension if not exists pgtap;

select plan(22);

\ir _personas.psql

-- Isolation : la base locale porte une vraie équipe PLUKA. Elle sort de
-- l'équipe *dans la transaction*, que le `rollback` final restaure.
delete from private.audit_logs;
delete from private.outbox_events;
update public.users set platform_role = 'user'
where platform_role = 'pluka_admin'
  and id not in ('88888888-8888-4888-8888-888888888888');

create function pg_temp.hash_of(p_token text) returns text language sql as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

-- 8888 : super-admin. 5555 (editor d'Org A) : admin PLUKA. 6666 : support.
update public.users set staff_role = 'super_admin' where id = '88888888-8888-4888-8888-888888888888';
update public.users set platform_role = 'pluka_admin', staff_role = 'admin'
  where id = '55555555-5555-4555-8555-555555555555';
update public.users set platform_role = 'pluka_admin', staff_role = 'support'
  where id = '66666666-6666-4666-8666-666666666666';

-- ============================================================
-- 1. Qui gère
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok($$ select * from public.staff_list_members() $$, '42501', null,
  'TEAMP-01 — admin : lire l''equipe PLUKA est refuse');
select throws_ok($$ select public.staff_invite('x@test.pluka', 'admin') $$, '42501', null,
  'TEAMP-02 — admin : inviter est refuse');
select throws_ok($$ select public.staff_change_role('55555555-5555-4555-8555-555555555555', 'super_admin') $$,
  '42501', null, 'TEAMP-03 — admin : s''auto-promouvoir super-admin est refuse');
reset role;

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok($$ select public.staff_remove('88888888-8888-4888-8888-888888888888') $$, '42501', null,
  'TEAMP-04 — support : retirer un membre est refuse');
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok($$ select * from public.staff_invitations $$, '42501', null,
  'TEAMP-05 — coureur : la table des invitations n''est pas lisible');
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select is((select count(*) from public.staff_list_members()), 3::bigint,
  'TEAMP-06 — super-admin : il lit les trois membres de l''equipe');
select is((select staff_role::text from public.staff_list_members() limit 1), 'super_admin',
  'TEAMP-07 — les super-admins viennent en tete');

-- ============================================================
-- 2. Rôles et dernier super-admin
-- ============================================================

select throws_ok($$ select public.staff_change_role('88888888-8888-4888-8888-888888888888', 'admin') $$,
  '55000', null, 'TEAMP-08 — le dernier super-admin ne peut pas se retrograder');
select throws_ok($$ select public.staff_remove('88888888-8888-4888-8888-888888888888') $$,
  '55000', null, 'TEAMP-09 — le dernier super-admin ne peut pas se retirer');
select is(public.staff_change_role('66666666-6666-4666-8666-666666666666', 'support'), false,
  'TEAMP-10 — un role inchange ne change rien');
select is(public.staff_change_role('55555555-5555-4555-8555-555555555555', 'super_admin'), true,
  'TEAMP-11 — super-admin : promouvoir un admin super-admin');
select lives_ok($$ select public.staff_remove('66666666-6666-4666-8666-666666666666') $$,
  'TEAMP-12 — super-admin : retirer le support');
reset role;

select results_eq(
  $$ select platform_role::text, staff_role::text from public.users
     where id = '66666666-6666-4666-8666-666666666666' $$,
  $$ values ('user'::text, null::text) $$,
  'TEAMP-13 — retire, il redevient simple utilisateur, sans role'
);

-- ============================================================
-- 3. Invitations
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select throws_ok($$ select public.staff_invite('org-editor-a@test.pluka', 'admin') $$, '23505', null,
  'TEAMP-14 — inviter un membre deja dans l''equipe est refuse');
select lives_ok($$ select public.staff_invite('Runner-B@Test.Pluka', 'support') $$,
  'TEAMP-15 — super-admin : inviter une adresse, casse indifferente');
reset role;

select is(
  (select count(*) from private.outbox_events where event_type = 'email.staff_invitation'),
  1::bigint,
  'TEAMP-16 — l''invitation emet son evenement d''envoi dans sa transaction'
);

set local role service_role;
select is(
  (select sendable from public.worker_claim_staff_invitation(
     (select id from public.staff_invitations where status = 'pending'),
     pg_temp.hash_of('jeton-staff'))),
  true,
  'TEAMP-17 — le worker reclame l''envoi et depose le hash'
);
select public.worker_complete_staff_invitation((select id from public.staff_invitations where status = 'pending'));
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok($$ select public.accept_staff_invitation(pg_temp.hash_of('jeton-staff')) $$, '42501', null,
  'TEAMP-18 — une autre adresse que celle invitee est refusee');
reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is(public.accept_staff_invitation(pg_temp.hash_of('jeton-staff'))::text, 'support',
  'TEAMP-19 — l''adresse invitee entre dans l''equipe avec le role de l''invitation');
select throws_ok($$ select public.accept_staff_invitation(pg_temp.hash_of('jeton-staff')) $$, '55000', null,
  'TEAMP-20 — une invitation ne s''accepte qu''une fois');
select is(public.my_staff_role()::text, 'support', 'TEAMP-21 — le role est effectif sur-le-champ');
reset role;

-- ============================================================
-- 4. Audit
-- ============================================================

select ok(
  not exists (select 1 from private.audit_logs where action like 'staff.%' and after_data::text like '%@%')
  and (select count(*) from private.audit_logs where action like 'staff.%') = 4,
  'TEAMP-22 — quatre gestes audites (promotion, retrait, invitation, adhesion), aucune adresse'
);

select * from finish();

rollback;
