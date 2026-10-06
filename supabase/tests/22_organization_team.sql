-- PLUKA — Équipe d'une organisation : membres, rôles, invitations
-- Référence : docs/03_PRIVACY_RLS.md §3, §15, §114, §115–§118, §136 · migration 0033
--
-- §136 : « positif + négatif ».
--
-- 1. Qui gère : un pluka_admin et l'owner de l'organisation. Ni un admin,
--    ni un editor, ni un viewer d'organisation, ni l'owner d'une autre
--    organisation, ni un coureur, ni un anonyme.
-- 2. Les invariants : jamais sans owner, un membre retiré perd l'accès.
-- 3. L'invitation : outbox dans la transaction, une seule ouverte par
--    adresse, jeton tiré par le worker seulement, aperçu minimal, acceptation
--    liée à l'adresse et unique.
-- 4. L'audit ne cite jamais d'adresse.

begin;

create extension if not exists pgtap;

select plan(44);

\ir _personas.psql

-- Isolation : la base locale porte des données réelles. Le journal et l'outbox
-- sont vidés *dans la transaction*, que le `rollback` final restaure.
delete from private.audit_logs;
delete from private.outbox_events;

-- Le jeton que le « worker » de ce test tire — en clair ici seulement.
create function pg_temp.hash_of(p_token text) returns text language sql as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

-- ============================================================
-- 1. Qui gère l'équipe
-- ============================================================

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select * from public.org_list_members('aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501', null,
  'TEAM-01 — admin d''organisation : lire l''equipe est refuse'
);

select throws_ok(
  $$ select public.org_invite_member('aaaaaaaa-0000-4000-8000-000000000001', 'x@test.pluka', 'viewer') $$,
  '42501', null,
  'TEAM-02 — admin d''organisation : inviter est refuse'
);

select throws_ok(
  $$ select public.org_change_member_role('aaaaaaaa-0000-4000-8000-000000000001',
       '44444444-4444-4444-8444-444444444444', 'owner') $$,
  '42501', null,
  'TEAM-03 — admin d''organisation : s''auto-promouvoir owner est refuse'
);

reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select throws_ok(
  $$ select public.org_remove_member('aaaaaaaa-0000-4000-8000-000000000001',
       '66666666-6666-4666-8666-666666666666') $$,
  '42501', null,
  'TEAM-04 — editor : retirer un membre est refuse (P44)'
);

reset role;

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select throws_ok(
  $$ select * from public.org_list_invitations('aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501', null,
  'TEAM-05 — viewer : lire les invitations est refuse'
);

reset role;

-- Owner d'Org B sur Org A : être owner quelque part ne vaut pas ailleurs.
select pg_temp.act_as('77777777-7777-4777-8777-777777777777');

select throws_ok(
  $$ select public.org_invite_member('aaaaaaaa-0000-4000-8000-000000000001', 'x@test.pluka', 'owner') $$,
  '42501', null,
  'TEAM-06 — owner d''une autre organisation : refuse'
);

reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select * from public.org_list_members('aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501', null,
  'TEAM-07 — coureur : refuse'
);

select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role)
     values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner') $$,
  '42501', null,
  'TEAM-08 — coureur : s''ajouter directement a une organisation est ferme'
);

select throws_ok(
  $$ select * from public.organization_invitations $$,
  '42501', null,
  'TEAM-09 — la table des invitations n''est pas lisible directement'
);

reset role;

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.org_invite_member('aaaaaaaa-0000-4000-8000-000000000001', 'x@test.pluka', 'viewer') $$,
  '42501', null,
  'TEAM-10 — anonyme : la fonction ne lui est meme pas executable'
);

reset role;

-- L'owner d'Org A gère son équipe.
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is(
  (select count(*) from public.org_list_members('aaaaaaaa-0000-4000-8000-000000000001')),
  4::bigint,
  'TEAM-11 — owner : il lit les quatre membres de son organisation'
);

select is(
  (select role::text from public.org_list_members('aaaaaaaa-0000-4000-8000-000000000001') limit 1),
  'owner',
  'TEAM-12 — l''owner vient en tete de liste'
);

reset role;

-- ============================================================
-- 2. Rôles et dernier owner
-- ============================================================

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select throws_ok(
  $$ select public.org_change_member_role('aaaaaaaa-0000-4000-8000-000000000001',
       '33333333-3333-4333-8333-333333333333', 'admin') $$,
  '55000', null,
  'TEAM-13 — le dernier owner ne peut pas se retrograder'
);

select throws_ok(
  $$ select public.org_remove_member('aaaaaaaa-0000-4000-8000-000000000001',
       '33333333-3333-4333-8333-333333333333') $$,
  '55000', null,
  'TEAM-14 — le dernier owner ne peut pas se retirer'
);

select is(
  public.org_change_member_role('aaaaaaaa-0000-4000-8000-000000000001',
    '55555555-5555-4555-8555-555555555555', 'editor'),
  false,
  'TEAM-15 — un role inchange ne change rien'
);

select is(
  public.org_change_member_role('aaaaaaaa-0000-4000-8000-000000000001',
    '44444444-4444-4444-8444-444444444444', 'owner'),
  true,
  'TEAM-16 — l''owner promeut l''admin owner'
);

-- Deux owners : le premier peut désormais se retirer du rôle.
select lives_ok(
  $$ select public.org_change_member_role('aaaaaaaa-0000-4000-8000-000000000001',
       '33333333-3333-4333-8333-333333333333', 'admin') $$,
  'TEAM-17 — avec un second owner, le premier peut se retrograder'
);

reset role;

-- L'ancien owner, devenu admin, n'a plus la main sur l'équipe.
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select throws_ok(
  $$ select * from public.org_list_members('aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501', null,
  'TEAM-18 — retrograde admin, il perd la gestion de l''equipe sur-le-champ'
);

reset role;

-- Le pluka_admin retire le viewer.
select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select lives_ok(
  $$ select public.org_remove_member('aaaaaaaa-0000-4000-8000-000000000001',
       '66666666-6666-4666-8666-666666666666') $$,
  'TEAM-19 — pluka_admin : retirer un membre'
);

select throws_ok(
  $$ select public.org_remove_member('aaaaaaaa-0000-4000-8000-000000000001',
       '66666666-6666-4666-8666-666666666666') $$,
  'P0002', null,
  'TEAM-20 — retirer deux fois : introuvable'
);

reset role;

-- §114 : l'accès cesse immédiatement. Le contrôle s'exécute en `postgres`
-- avec l'identité du membre : `authenticated` n'a pas accès au schéma private.
select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
reset role;

select ok(
  not private.user_is_org_member('aaaaaaaa-0000-4000-8000-000000000001'),
  'TEAM-21 — le membre retire n''est plus membre a la requete suivante'
);

-- ============================================================
-- 3. Invitations
-- ============================================================

-- L'owner restant (ex-admin 4444) invite.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select public.org_invite_member('aaaaaaaa-0000-4000-8000-000000000001',
       'org-editor-a@test.pluka', 'viewer') $$,
  '23505', null,
  'TEAM-22 — inviter un membre deja present est refuse'
);

select lives_ok(
  $$ select public.org_invite_member('aaaaaaaa-0000-4000-8000-000000000001',
       'Runner-B@Test.Pluka', 'editor') $$,
  'TEAM-23 — owner : inviter une adresse, casse indifferente'
);

-- Réinviter : la première invitation est révoquée, une seule reste ouverte.
select lives_ok(
  $$ select public.org_invite_member('aaaaaaaa-0000-4000-8000-000000000001',
       'runner-b@test.pluka', 'viewer') $$,
  'TEAM-24 — reinviter la meme adresse'
);

select results_eq(
  $$ select email, role::text, status::text
     from public.org_list_invitations('aaaaaaaa-0000-4000-8000-000000000001') $$,
  $$ values ('runner-b@test.pluka'::text, 'viewer'::text, 'pending'::text) $$,
  'TEAM-25 — une seule invitation ouverte, celle du dernier envoi'
);

reset role;

select is(
  (select count(*) from private.outbox_events
    where event_type = 'email.organization_invitation'),
  2::bigint,
  'TEAM-26 — chaque invitation a son evenement d''envoi, ecrit dans sa transaction'
);

select ok(
  (select bool_and(token_hash is null) from public.organization_invitations where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'TEAM-27 — aucune invitation n''a de jeton avant l''envoi'
);

-- Le « worker » : seul service_role réclame l'envoi.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select * from public.worker_claim_organization_invitation(
       (select gen_random_uuid()), repeat('a', 64)) $$,
  '42501', null,
  'TEAM-28 — un compte connecte ne reclame pas un envoi'
);

reset role;

set local role service_role;

select is(
  (select sendable from public.worker_claim_organization_invitation(
     (select id from public.organization_invitations where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and status = 'revoked'),
     pg_temp.hash_of('jeton-revoque'))),
  false,
  'TEAM-29 — une invitation revoquee ne s''envoie pas'
);

select results_eq(
  $$ select sendable, email, role::text, organization_name, attempt
     from public.worker_claim_organization_invitation(
       (select id from public.organization_invitations where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and status = 'pending'),
       pg_temp.hash_of('jeton-de-test')) $$,
  $$ values (true, 'runner-b@test.pluka'::text, 'viewer'::text, 'Org A'::text, 1) $$,
  'TEAM-30 — le worker relit destinataire et organisation au moment de l''envoi'
);

select lives_ok(
  $$ select public.worker_complete_organization_invitation(
       (select id from public.organization_invitations where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and status = 'pending')) $$,
  'TEAM-31 — envoi confirme'
);

reset role;

-- Aperçu avant connexion : minimal.
select pg_temp.act_as_anon();

select results_eq(
  $$ select state, organization_name, role::text
     from public.preview_organization_invitation(pg_temp.hash_of('jeton-de-test')) $$,
  $$ values ('valid'::text, 'Org A'::text, 'viewer'::text) $$,
  'TEAM-32 — anonyme : l''apercu donne l''organisation et le role, pas l''adresse'
);

select is(
  (select state from public.preview_organization_invitation(pg_temp.hash_of('mauvais-jeton'))),
  'unknown',
  'TEAM-33 — un jeton inconnu est dit inconnu'
);

select throws_ok(
  $$ select public.accept_organization_invitation(pg_temp.hash_of('jeton-de-test')) $$,
  '42501', null,
  'TEAM-34 — anonyme : accepter exige une connexion'
);

reset role;

-- §117 : un lien transféré ne fait pas entrer quelqu'un d'autre.
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.accept_organization_invitation(pg_temp.hash_of('jeton-de-test')) $$,
  '42501', null,
  'TEAM-35 — une autre adresse que celle invitee est refusee'
);

reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is(
  public.accept_organization_invitation(pg_temp.hash_of('jeton-de-test')),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'TEAM-36 — l''adresse invitee rejoint l''organisation'
);

reset role;

select ok(
  private.user_has_org_role('aaaaaaaa-0000-4000-8000-000000000001', 'viewer'),
  'TEAM-37 — avec le role de l''invitation, effectif immediatement'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

-- §118 : une seule activation.
select throws_ok(
  $$ select public.accept_organization_invitation(pg_temp.hash_of('jeton-de-test')) $$,
  '55000', null,
  'TEAM-38 — une invitation ne s''accepte qu''une fois'
);

reset role;

-- Expiration.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.org_invite_member('aaaaaaaa-0000-4000-8000-000000000001', 'ex-member-a@test.pluka', 'editor');
reset role;

set local role service_role;
select public.worker_claim_organization_invitation(
  (select id from public.organization_invitations where email = 'ex-member-a@test.pluka' and status = 'pending'),
  pg_temp.hash_of('jeton-expire'));
reset role;

update public.organization_invitations set expires_at = now() - interval '1 minute'
where token_hash = pg_temp.hash_of('jeton-expire');

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');

select is(
  (select state from public.preview_organization_invitation(pg_temp.hash_of('jeton-expire'))),
  'expired',
  'TEAM-39 — l''apercu dit qu''une invitation est expiree'
);

select throws_ok(
  $$ select public.accept_organization_invitation(pg_temp.hash_of('jeton-expire')) $$,
  '55000', null,
  'TEAM-40 — une invitation expiree est refusee'
);

reset role;

-- Révocation par l'owner. Les identifiants sont lus en `postgres` : la
-- table n'est pas lisible du rôle `authenticated`.
select id as activated_id from public.organization_invitations where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and status = 'activated' \gset
select id as open_id from public.organization_invitations
  where email = 'ex-member-a@test.pluka' and status = 'pending' \gset

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  format('select public.org_revoke_invitation(%L)', :'activated_id'),
  '55000', null,
  'TEAM-41 — revoquer une invitation deja acceptee est refuse'
);

select lives_ok(
  format('select public.org_revoke_invitation(%L)', :'open_id'),
  'TEAM-42 — owner : revoquer une invitation ouverte'
);

reset role;

-- ============================================================
-- 4. Audit
-- ============================================================

select is(
  (select count(*) from private.audit_logs where action like 'organization_member.%'),
  -- 2 changements de rôle effectifs, 1 retrait, 3 invitations, 1 adhésion, 1 révocation.
  8::bigint,
  'TEAM-43 — chaque geste effectif est audite, et seulement lui'
);

select ok(
  not exists (
    select 1 from private.audit_logs
    where action like 'organization_member.%' and after_data::text like '%@%'
  ),
  'TEAM-44 — l''audit ne cite aucune adresse email'
);

select * from finish();

rollback;
