-- PLUKA — RLS : visibilité de course, référentiel, sources et facts
-- Référence : docs/03_PRIVACY_RLS.md §16 à §25, §42, §52, §139, §140, §160
--
-- CONTRAT DE LA SUITE
-- Chaque fichier rejoue les quatre interdictions organisation : Plan,
-- Nutrition, Assistance, sortie individuelle.

begin;

create extension if not exists pgtap;

select plan(31);

\ir _personas.psql

-- ============================================================
-- 1. Lecture publique (§16, §17)
-- ============================================================

select pg_temp.act_as_anon();

select results_eq(
  $$ select id from public.races order by id $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000013'::uuid),
            ('bbbbbbbb-0000-4000-8000-000000000013'::uuid) $$,
  'PRIVACY-P05 — anon ne voit que les courses publiées et publiques (§16, §17)'
);

select is_empty(
  $$ select id from public.races where id = 'aaaaaaaa-0000-4000-8000-000000000014' $$,
  'PRIVACY-P06 — la course private n''est pas listable, même son UUID connu (§17)'
);

select is_empty(
  $$ select id from public.events where id = 'aaaaaaaa-0000-4000-8000-000000000015' $$,
  'PRIVACY-P07 — un événement brouillon n''est pas public (§16)'
);

select is_empty(
  $$ select id from public.editions where id = 'aaaaaaaa-0000-4000-8000-000000000016' $$,
  'PRIVACY-P08 — une édition brouillon n''est pas publique (§16)'
);

-- §18 : « Une course non publique ne doit pas devenir lisible via un waypoint
-- directement requêté. » C'est le contournement que la remontée jusqu'à
-- `races` doit fermer.
select results_eq(
  $$ select count(*)::int from public.race_waypoints $$,
  $$ values (2) $$,
  'PRIVACY — anon ne voit que les waypoints de la course publique (§18)'
);

select is_empty(
  $$ select id from public.race_waypoints
     where race_id = 'aaaaaaaa-0000-4000-8000-000000000014' $$,
  'PRIVACY — le waypoint ne rend pas lisible une course private (§18)'
);

-- §52, §160 : une notice officielle est lisible sans premium.
select isnt_empty(
  $$ select id from public.race_notices $$,
  'PRIVACY-P73 — la notice officielle est lisible en Free (§52)'
);

-- §22 : seule une version publiée sort du périmètre organisation.
select results_eq(
  $$ select id from public.race_fact_versions $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000094'::uuid) $$,
  'PRIVACY-P09 — anon ne lit que la version de fact publiée (§22)'
);

select is_empty(
  $$ select id from public.race_fact_versions
     where workflow_status <> 'published' $$,
  'PRIVACY-P10 — un brouillon de fact reste interne (§22)'
);

select isnt_empty($$ select id from public.fact_sources $$,
  'PRIVACY-P11 — la preuve d''un fact publié est lisible dans le même scope (§25)');

-- §21 : le contenu brut d'un snapshot n'est pas ouvert à anon.
select throws_ok(
  $$ select id from public.source_snapshots $$,
  '42501', null,
  'PRIVACY-P12 — anon n''a aucun droit sur les snapshots bruts (§21)'
);

-- §20 : la métadonnée publique d'une source est lisible, colonnes choisies.
select isnt_empty(
  $$ select id, title from public.sources $$,
  'PRIVACY-P13 — la métadonnée de source publiée est lisible (§20)'
);

select throws_ok(
  $$ select storage_path from public.sources $$,
  '42501', null,
  'PRIVACY — le storage_path d''une source n''est accordé à personne côté client (§20)'
);

-- §14 : la fiche opérationnelle d'une organisation n'est pas publique.
select isnt_empty($$ select id, name from public.organizations $$,
  'PRIVACY — l''identité publique d''une organisation est lisible (§14)');

select throws_ok(
  $$ select contact_email from public.organizations $$,
  '42501', null,
  'PRIVACY — le contact_email d''une organisation n''est pas public (§14)'
);

reset role;

-- ============================================================
-- 2. Le participant voit sa course (§18)
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select isnt_empty($$ select id from public.races $$,
  'PRIVACY — Runner A lit la course à laquelle il participe (§16)');
select isnt_empty($$ select id from public.race_waypoints $$,
  'PRIVACY — Runner A lit le référentiel de sa course (§18)');
select isnt_empty($$ select id from public.race_notices $$,
  'PRIVACY — Runner A lit les notices de sa course (§52)');

reset role;

-- ============================================================
-- 3. L'organisation gestionnaire voit son travail en cours
-- ============================================================

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select isnt_empty(
  $$ select id from public.races where id = 'aaaaaaaa-0000-4000-8000-000000000014' $$,
  'PRIVACY — Org Viewer lit sa course private (§16)'
);

select isnt_empty(
  $$ select id from public.events where id = 'aaaaaaaa-0000-4000-8000-000000000015' $$,
  'PRIVACY — Org Viewer lit son événement brouillon (§16)'
);

select isnt_empty(
  $$ select id from public.race_fact_versions where workflow_status = 'draft' $$,
  'PRIVACY — Org Viewer lit ses facts en travail (§22)'
);

select isnt_empty(
  $$ select id from public.source_snapshots $$,
  'PRIVACY — Org Viewer lit les snapshots de son édition (§21)'
);

-- Le chemin de stockage n'est ouvert à aucun rôle client, membre compris :
-- les fichiers passent par des URLs signées produites côté serveur (§20, §90).
-- Un grant de table sur `sources` couvrirait toutes les colonnes et
-- écraserait la projection restreinte — d'où ce test, qui garde la nuance.
select throws_ok(
  $$ select storage_path from public.sources $$,
  '42501', null,
  'PRIVACY — même un membre de l''organisation ne lit pas storage_path (§20)'
);

reset role;

-- ============================================================
-- 4. Les quatre interdictions organisation
-- ============================================================
-- Voir une course de bout en bout ne donne aucun accès à la préparation des
-- coureurs qui la courent (§1, §26).

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — Org Viewer : aucun Plan (§31)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — Org Viewer : aucune Nutrition (§40)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — Org Viewer : aucune Assistance (§43)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — Org Viewer : aucune sortie individuelle (§39)');

reset role;

-- Et l'anonyme encore moins.
select pg_temp.act_as_anon();

select throws_ok($$ select id from public.race_plans $$, '42501', null,
  'PRIVACY — anon n''a aucun droit sur les Plans (§31)');
select throws_ok($$ select id from public.nutrition_plans $$, '42501', null,
  'PRIVACY — anon n''a aucun droit sur la Nutrition (§40)');
select throws_ok($$ select id from public.race_assistants $$, '42501', null,
  'PRIVACY — anon n''a aucun droit sur l''Assistance (§43)');
select throws_ok($$ select id from public.outings $$, '42501', null,
  'PRIVACY — anon n''a aucun droit sur les sorties (§39)');

reset role;

select * from finish();
rollback;
