-- PLUKA — Création d'une organisation par la console d'administration
-- Référence : docs/00_PRODUCT_SPEC.md §3.5 · docs/03_PRIVACY_RLS.md §104, §136 · migration 0030
--
-- §136 : « positif + négatif ».
--
-- - un coureur, un owner d'organisation et un visiteur anonyme sont refusés,
--   aucune organisation n'apparaît et le journal reste vide ;
-- - la voie directe reste fermée : `organizations` n'a pas de policy INSERT ;
-- - l'administrateur crée l'organisation, au statut par défaut, avec
--   exactement une entrée d'audit qui ne cite ni le nom ni l'email ;
-- - un slug déjà pris est refusé en `23505`, sans entrée d'audit.

begin;

create extension if not exists pgtap;

select plan(12);

\ir _personas.psql

-- Isolation : la base locale porte des données réelles. Le journal et l'outbox
-- sont vidés *dans la transaction*, que le `rollback` final restaure.
delete from private.audit_logs;
delete from private.outbox_events;

-- ============================================================
-- 1. Refus
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.admin_create_organization('Org C', 'org-c') $$,
  '42501', null,
  'ADMO-01 — coureur : creer une organisation est refuse'
);

select throws_ok(
  $$ insert into public.organizations (name, slug) values ('Org C', 'org-c') $$,
  '42501', null,
  'ADMO-02 — coureur : l''insertion directe reste fermee'
);

reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select throws_ok(
  $$ select public.admin_create_organization('Org C', 'org-c') $$,
  '42501', null,
  'ADMO-03 — owner d''organisation : un droit d''organisation n''est pas un droit plateforme'
);

reset role;

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.admin_create_organization('Org C', 'org-c') $$,
  '42501', null,
  'ADMO-04 — anonyme : la fonction ne lui est meme pas executable'
);

reset role;

select is(
  (select count(*) from public.organizations where slug = 'org-c'),
  0::bigint,
  'ADMO-05 — aucun refus n''a cree d''organisation'
);

select is(
  (select count(*) from private.audit_logs),
  0::bigint,
  'ADMO-06 — aucun refus n''a ecrit le journal'
);

-- ============================================================
-- 2. Administrateur
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select lives_ok(
  $$ select public.admin_create_organization('Org C', 'org-c', 'contact@org-c.test', 'https://org-c.test') $$,
  'ADMO-07 — administrateur : l''organisation est creee'
);

select throws_ok(
  $$ select public.admin_create_organization('Org A bis', 'org-a') $$,
  '23505', null,
  'ADMO-08 — un slug deja pris est refuse'
);

reset role;

select is(
  (select status::text from public.organizations where slug = 'org-c'),
  'active',
  'ADMO-09 — la ligne prend le statut par defaut de la colonne'
);

select is(
  (select count(*) from private.audit_logs where action = 'organization.create'),
  1::bigint,
  'ADMO-10 — exactement une entree d''audit, le doublon n''en ecrit pas'
);

select is(
  (select actor_user_id from private.audit_logs where action = 'organization.create'),
  '88888888-8888-4888-8888-888888888888'::uuid,
  'ADMO-11 — le journal designe l''administrateur du jeton'
);

select is(
  (select after_data from private.audit_logs where action = 'organization.create'),
  jsonb_build_object('slug', 'org-c', 'status', 'active'),
  'ADMO-12 — l''audit est minimal : ni nom, ni email'
);

select * from finish();

rollback;
