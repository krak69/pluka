-- PLUKA — RLS : socle deny-by-default et identité
-- Référence : docs/03_PRIVACY_RLS.md §1, §5, §6, §7, §12, §13, §136, §138
--
-- CONTRAT DE LA SUITE
-- Chaque fichier de tests rejoue les quatre interdictions organisation :
-- Plan, Nutrition, Assistance, sortie individuelle. Une régression sur l'une
-- d'elles doit faire tomber toute la suite, pas un seul fichier.

begin;

create extension if not exists pgtap;

select plan(27);

\ir _personas.psql

-- ============================================================
-- 1. Deny-by-default (§6)
-- ============================================================

select ok(
  (select bool_and(rowsecurity) from pg_tables
   where schemaname = 'public' and tablename <> 'spatial_ref_sys'),
  'PRIVACY — RLS activée sur toutes les tables public (§6)'
);

select pg_temp.act_as_anon();

-- Le refus prend deux formes, et la distinction est volontaire :
--   - aucun grant          → 42501 permission denied, la table n'existe pas
--                            pour ce rôle ;
--   - grant + policy       → zéro ligne.
-- Les tables personnelles ne sont accordées qu'à `authenticated` : `anon` se
-- heurte donc au grant avant même d'atteindre une policy (§170).
select throws_ok(
  $$ select id from public.users $$,
  '42501', null,
  'PRIVACY-P01 — anon n''a aucun droit sur les utilisateurs (§12, §170)'
);
select throws_ok(
  $$ select user_id from public.trail_profiles $$,
  '42501', null,
  'PRIVACY-P02 — anon n''a aucun droit sur les profils trailer (§13)'
);
select throws_ok(
  $$ select id from public.participant_races $$,
  '42501', null,
  'PRIVACY-P03 — anon n''a aucun droit sur les participations (§26)'
);

-- La course publiée, elle, reste lisible : le socle refuse par défaut, il ne
-- casse pas la lecture publique prévue (§16).
select isnt_empty(
  $$ select id from public.races $$,
  'PRIVACY — anon lit la course publiée (§16)'
);

reset role;

-- ============================================================
-- 2. Identité (§12, §13, §138)
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select results_eq(
  $$ select id from public.users $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid) $$,
  'PRIVACY-P01 — Runner A ne voit que sa propre ligne user (§12)'
);

select is_empty(
  $$ select id from public.users where id = '22222222-2222-4222-8222-222222222222' $$,
  'PRIVACY-P02 — Runner A ne lit pas le user de Runner B (§12)'
);

select results_eq(
  $$ select user_id from public.trail_profiles $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid) $$,
  'PRIVACY — Runner A lit son profil trailer (§13)'
);

-- §12 / §179 : la colonne est protégée par le grant *et* par un trigger.
select throws_ok(
  $$ update public.users set platform_role = 'pluka_admin'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501',
  null,
  'PRIVACY-P03 — Runner A ne modifie pas son platform_role (§4, §179)'
);

select throws_ok(
  $$ update public.users set email = 'usurpation@test.pluka'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501',
  null,
  'PRIVACY-P04 — Runner A ne modifie pas son email (§12)'
);

select lives_ok(
  $$ update public.users set first_name = 'Alex'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  'PRIVACY — Runner A modifie bien une colonne autorisée (§12)'
);

reset role;

-- ============================================================
-- 3. Cloisonnement entre coureurs (§136 test négatif)
-- ============================================================

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is_empty($$ select id from public.race_plans $$,
  'PRIVACY — Runner B ne lit pas le Plan de Runner A (§31)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY — Runner B ne lit pas la sortie de Runner A (§39)');
select is_empty($$ select id from public.library_templates $$,
  'PRIVACY — Runner B ne lit pas la bibliothèque de Runner A');

reset role;

-- ============================================================
-- 4. Le propriétaire, lui, voit ses objets (§136 test positif)
-- ============================================================
-- Sans ces quatre assertions, les `is_empty` de la section suivante ne
-- prouveraient rien : une base vide les satisferait aussi.

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select isnt_empty($$ select id from public.race_plans $$,
  'PRIVACY — Runner A lit son Plan (§32)');
select isnt_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY — Runner A lit sa Nutrition (§40)');
select isnt_empty($$ select id from public.race_assistants $$,
  'PRIVACY — Runner A lit son Assistance (§43)');
select isnt_empty($$ select id from public.outings $$,
  'PRIVACY — Runner A lit sa sortie (§39)');
select isnt_empty($$ select id from public.library_templates $$,
  'PRIVACY — Runner A lit sa bibliothèque personnelle');

reset role;

-- ============================================================
-- 5. Les quatre interdictions organisation (contrat de la suite)
-- ============================================================
-- §1 : « L'organisation ne voit jamais la préparation privée individuelle du
-- coureur. » Testé ici avec l'Owner, le rôle le plus fort de l'organisation
-- gestionnaire de la course à laquelle Runner A participe.

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select isnt_empty($$ select id from public.participant_races $$,
  'PRIVACY — Org Owner voit bien l''inscription (accès opérationnel, §26)');

select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — Org Owner : aucun Plan (§31)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — Org Owner : aucune Nutrition (§40)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — Org Owner : aucune Assistance (§43)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — Org Owner : aucune sortie individuelle (§39)');

select is_empty($$ select user_id from public.trail_profiles $$,
  'PRIVACY — Org Owner : aucun profil trailer (§13)');
select is_empty($$ select id from public.library_templates $$,
  'PRIVACY — Org Owner : aucune bibliothèque personnelle');

reset role;

-- ============================================================
-- 6. Schéma privé (§7, §153)
-- ============================================================

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select throws_ok(
  $$ select count(*) from private.analytics_events $$,
  '42501',
  null,
  'PRIVACY-P59 — le schéma private reste fermé au client (§7)'
);

reset role;

select * from finish();
rollback;
