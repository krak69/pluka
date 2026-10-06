-- PLUKA — Fiche et édition d'une organisation par la console d'administration
-- Référence : docs/00_PRODUCT_SPEC.md §3.5 · docs/03_PRIVACY_RLS.md §92, §104, §136 · migration 0031
--
-- §136 : « positif + négatif ».
--
-- - un coureur, un owner d'organisation — même sur sa propre organisation —
--   et un visiteur anonyme sont refusés en lecture comme en écriture, et rien
--   ne change ;
-- - la voie directe reste fermée : `organizations` n'a pas de policy UPDATE ;
-- - l'administrateur lit la fiche et l'édite, avec une entrée d'audit qui
--   nomme les champs modifiés sans en citer les valeurs ;
-- - une édition sans changement n'écrit ni la ligne ni le journal ;
-- - le slug ne change jamais.

begin;

create extension if not exists pgtap;

select plan(19);

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
  $$ select * from public.admin_get_organization('aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501', null,
  'ADME-01 — coureur : lire la fiche est refuse'
);

select throws_ok(
  $$ select public.admin_update_organization('aaaaaaaa-0000-4000-8000-000000000001', 'Pirate', null, null, 'active') $$,
  '42501', null,
  'ADME-02 — coureur : editer est refuse'
);

reset role;

-- Owner d'Org A, sur Org A : posséder l'organisation n'ouvre pas la console.
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select throws_ok(
  $$ select public.admin_update_organization('aaaaaaaa-0000-4000-8000-000000000001', 'Pirate', null, null, 'active') $$,
  '42501', null,
  'ADME-03 — owner : editer sa propre organisation par la console est refuse'
);

-- Pas de `grant update` sur la table : la voie directe est fermée avant même la RLS.
select throws_ok(
  $$ update public.organizations set name = 'Pirate'
     where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  '42501', null,
  'ADME-04 — owner : la mise a jour directe est refusee'
);

reset role;

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.admin_update_organization('aaaaaaaa-0000-4000-8000-000000000001', 'Pirate', null, null, 'active') $$,
  '42501', null,
  'ADME-05 — anonyme : la fonction ne lui est meme pas executable'
);

reset role;

select is(
  (select name from public.organizations where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'Org A',
  'ADME-06 — aucun refus n''a modifie l''organisation'
);

select is(
  (select count(*) from private.audit_logs),
  0::bigint,
  'ADME-07 — aucun refus n''a ecrit le journal'
);

-- ============================================================
-- 2. Administrateur
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select is(
  (select contact_email from public.admin_get_organization('aaaaaaaa-0000-4000-8000-000000000001')),
  'contact@org-a.test',
  'ADME-08 — administrateur : la fiche est lisible'
);

select is_empty(
  $$ select * from public.admin_get_organization('aaaaaaaa-0000-4000-8000-00000000ffff') $$,
  'ADME-09 — une organisation inexistante rend une fiche vide'
);

select throws_ok(
  $$ select public.admin_update_organization('aaaaaaaa-0000-4000-8000-00000000ffff', 'X', null, null, 'active') $$,
  'P0002', null,
  'ADME-10 — editer une organisation inexistante est refuse'
);

select is(
  public.admin_update_organization('aaaaaaaa-0000-4000-8000-000000000001', 'Org A', 'contact@org-a.test', null, 'active'),
  0,
  'ADME-11 — une edition identique ne change rien'
);

select is(
  public.admin_update_organization(
    'aaaaaaaa-0000-4000-8000-000000000001', 'Org A renommee', 'contact@org-a.test', 'https://org-a.test', 'prospect'
  ),
  3,
  'ADME-12 — nom, site et statut modifies : trois champs'
);

-- Effacer le site web est une modification.
select is(
  public.admin_update_organization(
    'aaaaaaaa-0000-4000-8000-000000000001', 'Org A renommee', 'contact@org-a.test', null, 'prospect'
  ),
  1,
  'ADME-13 — effacer un champ compte comme une modification'
);

reset role;

select results_eq(
  $$ select name, slug, status::text, website_url from public.organizations
     where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  $$ values ('Org A renommee'::text, 'org-a'::text, 'prospect'::text, null::text) $$,
  'ADME-14 — la ligne porte la saisie, et le slug n''a pas change'
);

select is(
  (select count(*) from private.audit_logs where action = 'organization.update'),
  2::bigint,
  'ADME-15 — deux entrees d''audit, l''edition identique n''en ecrit pas'
);

select is(
  (select after_data from private.audit_logs
    where action = 'organization.update' and after_data ? 'statusFrom'),
  jsonb_build_object('changed', jsonb_build_array('name', 'websiteUrl', 'status'),
                     'statusFrom', 'active', 'statusTo', 'prospect'),
  'ADME-16 — l''audit nomme les champs et les deux statuts'
);

select is(
  (select after_data from private.audit_logs
    where action = 'organization.update' and not after_data ? 'statusFrom'),
  jsonb_build_object('changed', jsonb_build_array('websiteUrl')),
  'ADME-17 — sans changement de statut, l''audit ne le cite pas'
);

select ok(
  not exists (
    select 1 from private.audit_logs
    where action = 'organization.update'
      and (after_data::text like '%Org A renommee%' or after_data::text like '%contact@org-a.test%')
  ),
  'ADME-18 — l''audit ne cite ni le nom ni l''email'
);

select is(
  (select actor_user_id from private.audit_logs where action = 'organization.update' limit 1),
  '88888888-8888-4888-8888-888888888888'::uuid,
  'ADME-19 — le journal designe l''administrateur du jeton'
);

select * from finish();

rollback;
