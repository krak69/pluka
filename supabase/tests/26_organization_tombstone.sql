-- PLUKA — Le super-admin supprime une organisation, quoi qu'elle porte
-- Référence : migration 0038 · 03_PRIVACY_RLS §114, §136 · AGENTS §13, §102
--
-- 1. Un admin ne supprime toujours qu'une organisation vide ; le super-admin
--    supprime aussi une organisation qui porte des données.
-- 2. Suppression avec pierre tombale : membres, invitations et imports
--    disparaissent ; les événements sont détachés (« Maintenus par PLUKA ») ;
--    la ligne reste, invisible, slug libéré ; les droits des coureurs et la
--    provenance gardent leur référence.
-- 3. Une organisation supprimée n'accepte plus rien.

begin;

create extension if not exists pgtap;

select plan(16);

\ir _personas.psql

delete from private.audit_logs;

-- 8888 : admin (défaut de 0035). 9999 devient super-admin.
update public.users set platform_role = 'pluka_admin', staff_role = 'super_admin'
where id = '99999999-9999-4999-8999-999999999999';

-- Une invitation ouverte sur Org A, pour vérifier qu'elle disparaît.
insert into public.organization_invitations (organization_id, email, role, expires_at)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'invite@test.pluka', 'viewer', now() + interval '7 days');

-- ============================================================
-- 1. Qui peut
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select throws_ok(
  $$ select public.admin_delete_organization('aaaaaaaa-0000-4000-8000-000000000001') $$,
  '55000', null,
  'TOMB-01 — admin : une organisation qui porte des donnees reste refusee'
);
reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ select public.admin_delete_organization('aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501', null,
  'TOMB-02 — owner de l''organisation : la console n''est pas sa porte'
);
reset role;

-- ============================================================
-- 2. Le super-admin supprime
-- ============================================================

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
select lives_ok(
  $$ select public.admin_delete_organization('aaaaaaaa-0000-4000-8000-000000000001') $$,
  'TOMB-03 — super-admin : supprimer une organisation qui porte des donnees'
);

select is_empty(
  $$ select * from public.admin_list_organizations(500)
     where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'TOMB-04 — elle disparait de la liste'
);

select is_empty(
  $$ select * from public.admin_get_organization('aaaaaaaa-0000-4000-8000-000000000001') $$,
  'TOMB-05 — et sa fiche est introuvable'
);

select throws_ok(
  $$ select public.admin_delete_organization('aaaaaaaa-0000-4000-8000-000000000001') $$,
  'P0002', null,
  'TOMB-06 — la supprimer deux fois : introuvable'
);

select throws_ok(
  $$ select public.org_invite_member('aaaaaaaa-0000-4000-8000-000000000001', 'x@test.pluka', 'viewer') $$,
  '42501', null,
  'TOMB-07 — une organisation supprimee n''accepte plus d''invitation'
);
reset role;

select is(
  (select count(*) from public.organization_members where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0::bigint,
  'TOMB-08 — ses membres sont retires : leurs acces cessent (§114)'
);

select is(
  (select count(*) from public.organization_invitations where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0::bigint,
  'TOMB-09 — ses invitations sont supprimees'
);

select is(
  (select count(*) from public.events where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0::bigint,
  'TOMB-10 — plus aucun evenement ne lui est rattache'
);

select ok(
  (select bool_and(organization_id is null and management_status = 'pluka_managed')
     from public.events where id in ('aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000015')),
  'TOMB-11 — ses evenements restent, Maintenus par PLUKA'
);

select ok(
  exists (select 1 from public.races r
          join public.editions ed on ed.id = r.edition_id
          where ed.event_id = 'aaaaaaaa-0000-4000-8000-000000000011'),
  'TOMB-12 — leurs courses, et donc les preparations des coureurs, sont intactes'
);

select results_eq(
  $$ select status::text, deleted_at is not null, slug <> 'org-a'
     from public.organizations where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  $$ values ('archived'::text, true, true) $$,
  'TOMB-13 — la ligne reste en pierre tombale : archivee, datee, slug libere'
);

-- Le slug libéré se reprend.
select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
select lives_ok(
  $$ select public.admin_create_organization('Org A nouvelle', 'org-a') $$,
  'TOMB-14 — le slug libere peut etre repris par une nouvelle organisation'
);
reset role;

select is(
  (select after_data->>'mode' from private.audit_logs where action = 'organization.delete'),
  'tombstone',
  'TOMB-15 — le journal dit que la suppression a garde une pierre tombale'
);

select ok(
  (select after_data->'detached' ? 'members' and after_data->'detached' ? 'events'
     from private.audit_logs where action = 'organization.delete'),
  'TOMB-16 — et ce qui a ete detache ou retire, par famille'
);

select * from finish();

rollback;
