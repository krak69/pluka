-- PLUKA — Changer l'organisation qui gère un événement
-- Référence : migration 0044 · AGENTS §82, §91, §92
--
-- 1. Seul le super-admin change l'organisation — par la RPC comme par la
--    table : un admin PLUKA ou un membre d'organisation est refusé.
-- 2. Le changement déplace l'accès organisateur d'un bloc : la nouvelle
--    organisation voit les inscrits, l'ancienne ne les voit plus.
-- 3. Statut de gestion selon 0041, audit, rien à écrire quand rien ne change.

begin;

create extension if not exists pgtap;

select plan(17);

\ir _personas.psql

delete from private.audit_logs;

-- 8888 : admin (défaut de 0035). 9999 devient super-admin.
update public.users set platform_role = 'pluka_admin', staff_role = 'super_admin'
where id = '99999999-9999-4999-8999-999999999999';

-- ============================================================
-- 1. Qui peut
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select throws_ok(
  $$ select public.admin_change_event_organization(
       'aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000002') $$,
  '42501', null,
  'EVORG-01 — admin PLUKA : la RPC est reservee au super-admin'
);
select throws_ok(
  $$ update public.events set organization_id = 'aaaaaaaa-0000-4000-8000-000000000002'
     where id = 'aaaaaaaa-0000-4000-8000-000000000011' $$,
  '42501', null,
  'EVORG-02 — admin PLUKA : la table ne contourne pas la RPC'
);
select lives_ok(
  $$ update public.events set name = 'Trail de Test renomme'
     where id = 'aaaaaaaa-0000-4000-8000-000000000011' $$,
  'EVORG-03 — le verrou ne vise que la colonne : le reste se modifie'
);
reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ select public.admin_change_event_organization(
       'aaaaaaaa-0000-4000-8000-000000000011', null) $$,
  '42501', null,
  'EVORG-04 — owner de l''organisation : il ne detache pas son evenement'
);
select throws_ok(
  $$ update public.events set organization_id = null
     where id = 'aaaaaaaa-0000-4000-8000-000000000011' $$,
  '42501', null,
  'EVORG-05 — owner de l''organisation : ni par la table'
);
reset role;

select is(
  (select organization_id from public.events where id = 'aaaaaaaa-0000-4000-8000-000000000011'),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'EVORG-06 — apres ces refus, l''evenement est toujours a Org A'
);

-- ============================================================
-- 2. Le super-admin change
-- ============================================================

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
select is(
  public.admin_change_event_organization(
    'aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000002'),
  true,
  'EVORG-07 — super-admin : l''evenement passe a Org B'
);
select is(
  public.admin_change_event_organization(
    'aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000002'),
  false,
  'EVORG-08 — la meme organisation une seconde fois : rien ne change'
);
select throws_ok(
  $$ select public.admin_change_event_organization(
       'aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-0000000000ff') $$,
  'P0002', null,
  'EVORG-09 — organisation inconnue : introuvable'
);
select throws_ok(
  $$ select public.admin_change_event_organization(
       'aaaaaaaa-0000-4000-8000-0000000000ff', null) $$,
  'P0002', null,
  'EVORG-10 — evenement inconnu : introuvable'
);
reset role;

select is(
  (select management_status::text from public.events
   where id = 'aaaaaaaa-0000-4000-8000-000000000011'),
  'organizer_managed',
  'EVORG-11 — avec une organisation : Partenaire (0041)'
);

select is(
  (select count(*)::integer from private.audit_logs
   where action = 'event.change_organization'
     and entity_id = 'aaaaaaaa-0000-4000-8000-000000000011'
     and after_data ->> 'from' = 'aaaaaaaa-0000-4000-8000-000000000001'
     and after_data ->> 'to' = 'aaaaaaaa-0000-4000-8000-000000000002'),
  1,
  'EVORG-12 — un seul changement journalise, de A vers B'
);

-- ============================================================
-- 3. L'accès suit l'organisation
-- ============================================================

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select is(
  (select count(*)::integer from public.participant_races
   where id = 'aaaaaaaa-0000-4000-8000-000000000031'),
  1,
  'EVORG-13 — owner d''Org B : il voit maintenant les inscrits de l''epreuve'
);
reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::integer from public.participant_races
   where id = 'aaaaaaaa-0000-4000-8000-000000000031'),
  0,
  'EVORG-14 — owner d''Org A : son acces a cesse immediatement'
);
reset role;

-- ============================================================
-- 4. Détacher, et une organisation supprimée
-- ============================================================

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
select is(
  public.admin_change_event_organization('aaaaaaaa-0000-4000-8000-000000000011', null),
  true,
  'EVORG-15 — super-admin : detacher l''evenement'
);
reset role;

select is(
  (select management_status::text from public.events
   where id = 'aaaaaaaa-0000-4000-8000-000000000011'),
  'pluka_managed',
  'EVORG-16 — sans organisation : Maintenu par PLUKA'
);

update public.organizations set deleted_at = now()
where id = 'aaaaaaaa-0000-4000-8000-000000000002';

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
select throws_ok(
  $$ select public.admin_change_event_organization(
       'aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000002') $$,
  'P0002', null,
  'EVORG-17 — une organisation supprimee ne recoit pas d''evenement'
);
reset role;

select * from finish();

rollback;
