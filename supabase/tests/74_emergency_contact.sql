-- PLUKA — Contact d'urgence, et son partage choisi avec l'organisation
-- Référence : migration 0101 · 03_PRIVACY_RLS §48 · AC-ASST-09 · décisions du 2026-11-17
--
-- 1. Un contact par participation, des champs bornés.
-- 2. Sans partage, l'organisation ne voit rien — même son propriétaire.
-- 3. Partagé : propriétaire et admin le consultent, et chaque consultation est
--    journalisée ; éditeur, lecteur et autre organisation sont refusés.
-- 4. Décocher retire l'accès aussitôt.

begin;

create extension if not exists pgtap;

select plan(13);

\ir _personas.psql

-- ============================================================
-- 1. Un par participation
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ insert into public.emergency_contacts
       (participant_race_id, first_name, phone, explicit_consent_at)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'Second', '0600000000', now()) $$,
  '23505',
  null,
  'un seul contact d''urgence par participation'
);

select throws_ok(
  $$ update public.emergency_contacts set phone = '1'
     where id = 'aaaaaaaa-0000-4000-8000-000000000064' $$,
  '23514',
  null,
  'un numéro trop court est refusé'
);

-- ============================================================
-- 2. Sans partage, rien
-- ============================================================

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is_empty(
  $$ select * from public.org_view_emergency_contact('aaaaaaaa-0000-4000-8000-000000000031') $$,
  'sans partage, le propriétaire de l''organisation ne voit pas le contact'
);

select is_empty(
  $$ select * from public.org_list_shared_emergency_contacts('aaaaaaaa-0000-4000-8000-000000000012') $$,
  'sans partage, la liste est vide'
);

select is_empty(
  $$ select id from public.emergency_contacts $$,
  'la table reste illisible à l''organisation, même partagée ou non (§48)'
);

-- ============================================================
-- 3. Partagé : propriétaire et admin, journalisé
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

update public.emergency_contacts set organization_share_consent_at = now()
where id = 'aaaaaaaa-0000-4000-8000-000000000064';

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is(
  (select phone from public.org_view_emergency_contact('aaaaaaaa-0000-4000-8000-000000000031')),
  '+33600000000',
  'partagé, le propriétaire de l''organisation consulte le contact'
);

select is(
  (select count(*)::int
   from public.org_list_shared_emergency_contacts('aaaaaaaa-0000-4000-8000-000000000012')),
  1,
  'la liste signale la participation, sans nom ni numéro'
);

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select is(
  (select first_name from public.org_view_emergency_contact('aaaaaaaa-0000-4000-8000-000000000031')),
  'Dominique',
  'un admin le consulte aussi'
);

reset role;

select is(
  (select count(*)::int from private.audit_logs
   where action = 'emergency_contact.viewed'
     and entity_id = 'aaaaaaaa-0000-4000-8000-000000000064'),
  2,
  'chaque consultation est journalisée'
);

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select throws_ok(
  $$ select * from public.org_view_emergency_contact('aaaaaaaa-0000-4000-8000-000000000031') $$,
  '42501',
  null,
  'un éditeur est refusé'
);

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select throws_ok(
  $$ select * from public.org_view_emergency_contact('aaaaaaaa-0000-4000-8000-000000000031') $$,
  '42501',
  null,
  'un lecteur est refusé'
);

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');

select throws_ok(
  $$ select * from public.org_view_emergency_contact('aaaaaaaa-0000-4000-8000-000000000031') $$,
  '42501',
  null,
  'le propriétaire d''une autre organisation est refusé'
);

-- ============================================================
-- 4. Décocher retire l'accès
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

update public.emergency_contacts set organization_share_consent_at = null
where id = 'aaaaaaaa-0000-4000-8000-000000000064';

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is_empty(
  $$ select * from public.org_view_emergency_contact('aaaaaaaa-0000-4000-8000-000000000031') $$,
  'partage retiré : l''accès disparaît aussitôt'
);

select * from finish();

rollback;
