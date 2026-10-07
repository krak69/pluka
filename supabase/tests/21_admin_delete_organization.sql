-- PLUKA — Suppression d'une organisation vide par la console d'administration
-- Référence : docs/00_PRODUCT_SPEC.md §3.5 · docs/03_PRIVACY_RLS.md §104, §136 · migration 0032
--
-- §136 : « positif + négatif ».
--
-- - un coureur, l'owner d'une organisation — même vide, même la sienne — et
--   un visiteur anonyme sont refusés, et rien n'est supprimé ;
-- - la voie directe reste fermée : pas de `grant delete` sur la table ;
-- - une organisation qui porte des données (un membre, un événement) est
--   refusée en `55000`, intacte, sans entrée d'audit ;
-- - une organisation vide est supprimée, avec une entrée d'audit qui garde
--   son slug.

begin;

create extension if not exists pgtap;

select plan(16);

\ir _personas.psql

-- Isolation : la base locale porte des données réelles. Le journal et l'outbox
-- sont vidés *dans la transaction*, que le `rollback` final restaure.
delete from private.audit_logs;
delete from private.outbox_events;

-- Org C : vide. Org D : un seul membre, l'owner d'Org A, et rien d'autre.
insert into public.organizations (id, name, slug, status) values
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'Org C', 'org-c', 'prospect'),
  ('aaaaaaaa-0000-4000-8000-0000000000d1', 'Org D', 'org-d', 'active');

insert into public.organization_members (organization_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-0000000000d1', '33333333-3333-4333-8333-333333333333', 'owner');

-- ============================================================
-- 1. Refus d'accès
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.admin_delete_organization('aaaaaaaa-0000-4000-8000-0000000000c1') $$,
  '42501', null,
  'ADMD-01 — coureur : supprimer est refuse'
);

select throws_ok(
  $$ delete from public.organizations where id = 'aaaaaaaa-0000-4000-8000-0000000000c1' $$,
  '42501', null,
  'ADMD-02 — coureur : la suppression directe est fermee'
);

reset role;

-- L'owner d'Org D supprime-t-il sa propre organisation ? Non : la console
-- n'est pas sa porte.
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select throws_ok(
  $$ select public.admin_delete_organization('aaaaaaaa-0000-4000-8000-0000000000d1') $$,
  '42501', null,
  'ADMD-03 — owner : supprimer sa propre organisation par la console est refuse'
);

reset role;

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.admin_delete_organization('aaaaaaaa-0000-4000-8000-0000000000c1') $$,
  '42501', null,
  'ADMD-04 — anonyme : la fonction ne lui est meme pas executable'
);

reset role;

select is(
  (select count(*) from public.organizations where slug in ('org-c', 'org-d')),
  2::bigint,
  'ADMD-05 — aucun refus d''acces n''a supprime d''organisation'
);

-- ============================================================
-- 2. Administrateur
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select throws_ok(
  $$ select public.admin_delete_organization('aaaaaaaa-0000-4000-8000-00000000ffff') $$,
  'P0002', null,
  'ADMD-06 — une organisation inexistante est introuvable'
);

select throws_ok(
  $$ select public.admin_delete_organization('aaaaaaaa-0000-4000-8000-0000000000d1') $$,
  '55000', null,
  'ADMD-07 — une organisation avec un membre est refusee'
);

-- Org B a des membres et un événement : les deux sont nommés.
select throws_like(
  $$ select public.admin_delete_organization('aaaaaaaa-0000-4000-8000-000000000002') $$,
  '%events, members%',
  'ADMD-08 — le refus nomme les donnees encore liees'
);

-- 0037 : la fiche lit, avant le clic, ce qui retient l'organisation.
select results_eq(
  $$ select kind, total from public.admin_get_organization_dependencies('aaaaaaaa-0000-4000-8000-000000000002')
     where kind in ('members', 'events') order by kind $$,
  $$ values ('events'::text, 1::bigint), ('members'::text, 1::bigint) $$,
  'ADMD-15 — administrateur : la fiche dit ce qui retient l''organisation, famille par famille'
);

select is_empty(
  $$ select * from public.admin_get_organization_dependencies('aaaaaaaa-0000-4000-8000-0000000000c1') $$,
  'ADMD-16 — une organisation vide n''a rien qui la retienne'
);

select lives_ok(
  $$ select public.admin_delete_organization('aaaaaaaa-0000-4000-8000-0000000000c1') $$,
  'ADMD-09 — une organisation vide est supprimee'
);

reset role;

select is(
  (select count(*) from public.organizations where slug = 'org-c'),
  0::bigint,
  'ADMD-10 — la ligne a disparu'
);

select results_eq(
  $$ select
       (select count(*) from public.organizations where slug = 'org-d'),
       (select count(*) from public.organization_members
         where organization_id = 'aaaaaaaa-0000-4000-8000-0000000000d1'),
       (select count(*) from public.events
         where organization_id = 'aaaaaaaa-0000-4000-8000-000000000002') > 0 $$,
  $$ values (1::bigint, 1::bigint, true) $$,
  'ADMD-11 — les refus n''ont rien efface : ni l''organisation, ni ses membres, ni ses evenements'
);

select is(
  (select count(*) from private.audit_logs where action = 'organization.delete'),
  1::bigint,
  'ADMD-12 — une seule entree d''audit : les refus n''en ecrivent pas'
);

select is(
  (select after_data from private.audit_logs where action = 'organization.delete'),
  jsonb_build_object('slug', 'org-c', 'status', 'prospect', 'mode', 'erased'),
  'ADMD-13 — l''audit garde le slug et le statut de la ligne supprimee'
);

select is(
  (select entity_id from private.audit_logs where action = 'organization.delete'),
  'aaaaaaaa-0000-4000-8000-0000000000c1'::uuid,
  'ADMD-14 — l''entree designe toujours l''organisation par son identifiant'
);

select * from finish();

rollback;
