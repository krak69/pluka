-- PLUKA — RLS : cloisonnement entre organisations, membre retiré, admin PLUKA
-- Référence : docs/03_PRIVACY_RLS.md §104, §113, §114, §155, §156
--
-- CONTRAT DE LA SUITE
-- Chaque fichier rejoue les quatre interdictions organisation : Plan,
-- Nutrition, Assistance, sortie individuelle.

begin;

create extension if not exists pgtap;

select plan(31);

\ir _personas.psql

-- ============================================================
-- 1. Org B ne voit rien d'Org A (§156)
-- ============================================================

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');

select isnt_empty(
  $$ select id from public.races where id = 'bbbbbbbb-0000-4000-8000-000000000013' $$,
  'PRIVACY — Org B lit sa propre course'
);

select is_empty(
  $$ select id from public.races where id = 'aaaaaaaa-0000-4000-8000-000000000014' $$,
  'PRIVACY-P65 — Org B ne voit pas la course private d''Org A (§156)'
);

select is_empty(
  $$ select id from public.events where id = 'aaaaaaaa-0000-4000-8000-000000000015' $$,
  'PRIVACY-P65 — Org B ne voit pas l''événement brouillon d''Org A (§156)'
);

select is_empty($$ select id from public.participant_races $$,
  'PRIVACY-P67 — Org B ne voit aucun inscrit d''Org A (§156)');

select is_empty($$ select id from public.participant_imports $$,
  'PRIVACY — Org B ne voit aucun import d''Org A (§60)');

select is_empty($$ select id from public.organizer_briefs $$,
  'PRIVACY-P54 — Org B ne lit pas le Brief d''Org A (§75)');

select is_empty($$ select id from public.race_intelligence_runs $$,
  'PRIVACY-P41 — Org B ne lit pas les agrégats d''Org A (§68)');

-- §156 : « une organisation n'écrit jamais dans la course d'une autre. »
select throws_ok(
  $$ insert into public.race_waypoints
       (race_id, name, waypoint_type, distance_km, sort_order)
     values ('aaaaaaaa-0000-4000-8000-000000000013', 'Ravito Org B', 'aid_station', 75, 5) $$,
  '42501', null,
  'PRIVACY-P66 — Org B n''écrit pas dans la course d''Org A (§156)'
);

select throws_ok(
  $$ insert into public.races (edition_id, name, slug, distance_km, start_datetime, timezone)
     values ('aaaaaaaa-0000-4000-8000-000000000012', 'Course pirate', 'pirate',
             10, '2026-06-20T04:00:00Z', 'Europe/Paris') $$,
  '42501', null,
  'PRIVACY — Org B ne crée pas une course dans l''édition d''Org A (§156)'
);

-- Les quatre interdictions, vues d'une organisation tierce.
select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — Org B : aucun Plan (§31)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — Org B : aucune Nutrition (§40)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — Org B : aucune Assistance (§43)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — Org B : aucune sortie individuelle (§39)');

reset role;

-- ============================================================
-- 2. Membre retiré (§114, §155)
-- ============================================================
-- `ex-member-a` a créé l'import de participants d'Org A — la colonne
-- `created_by_user_id` le prouve — mais n'est plus membre. §113 : le scope
-- organisation prime sur le créateur, sinon il garderait l'accès à vie.

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');

select is_empty(
  $$ select id from public.participant_imports $$,
  'PRIVACY-P64 — un ancien membre ne lit plus l''import qu''il a créé (§113, §114)'
);

select is_empty(
  $$ select id from public.participant_import_rows $$,
  'PRIVACY-P64 — un ancien membre ne lit plus les PII importées (§60, §114)'
);

select is_empty(
  $$ select id from public.races where id = 'aaaaaaaa-0000-4000-8000-000000000014' $$,
  'PRIVACY-P64 — un ancien membre ne voit plus la course private (§114)'
);

select is_empty($$ select id from public.organizer_briefs $$,
  'PRIVACY — un ancien membre ne lit plus le Brief (§114)');

select throws_ok(
  $$ insert into public.race_waypoints
       (race_id, name, waypoint_type, distance_km, sort_order)
     values ('aaaaaaaa-0000-4000-8000-000000000013', 'Ravito ex', 'aid_station', 80, 6) $$,
  '42501', null,
  'PRIVACY-P64 — un ancien membre n''écrit plus dans la course (§114)'
);

reset role;

-- ============================================================
-- 3. Admin PLUKA (§104)
-- ============================================================
-- §104 : « Le simple statut pluka_admin ne doit pas transformer toutes les
-- données en contenu courant de l'admin UI. » Il administre la base courses,
-- pas la préparation des coureurs.

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select isnt_empty(
  $$ select id from public.races where id = 'aaaaaaaa-0000-4000-8000-000000000014' $$,
  'PRIVACY — l''admin PLUKA lit la course private, il administre la base courses (§16)'
);

select isnt_empty(
  $$ select id from public.events where id = 'aaaaaaaa-0000-4000-8000-000000000015' $$,
  'PRIVACY — l''admin PLUKA lit un événement brouillon (§16)'
);

-- Les quatre interdictions valent aussi pour lui : le support passe par des
-- use cases serveur audités, pas par une lecture directe (§104, §105).
select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — admin PLUKA : aucun Plan par simple lecture (§104)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — admin PLUKA : aucune Nutrition par simple lecture (§104)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — admin PLUKA : aucune Assistance par simple lecture (§104)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — admin PLUKA : aucune sortie individuelle par simple lecture (§104)');

reset role;

-- ============================================================
-- 4. Un coureur n'est pas un membre d'organisation
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select is_empty($$ select id from public.participant_imports $$,
  'PRIVACY — un coureur ne lit pas les imports de l''organisation (§58)');
select is_empty($$ select id from public.organizer_briefs $$,
  'PRIVACY-P53 — un coureur ne lit pas le Brief organisateur (§75)');
select is_empty($$ select id from public.race_intelligence_runs $$,
  'PRIVACY-P38 — un coureur n''a pas besoin des agrégats Race Intelligence (§68)');

reset role;

-- ============================================================
-- 5. Les quatre interdictions, organisation gestionnaire
-- ============================================================
-- Les personas de ce fichier sont tous extérieurs à Org A. Sans cette
-- dernière section, une fuite ouverte à l'organisation *gestionnaire* —
-- le cas le plus probable, puisque c'est la seule qui a une raison d'approcher
-- ces données — passerait inaperçue ici. Le contrat de la suite veut que
-- chaque fichier la voie.

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — Org A Owner : aucun Plan (§31)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — Org A Owner : aucune Nutrition (§40)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — Org A Owner : aucune Assistance (§43)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — Org A Owner : aucune sortie individuelle (§39)');

reset role;

select * from finish();
rollback;
