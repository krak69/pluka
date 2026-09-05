-- PLUKA — RLS : chemins d'écriture, grants et protections de colonnes
-- Référence : docs/03_PRIVACY_RLS.md §12, §15, §24, §30, §33, §34, §45,
--             §59, §111, §149, §170, §179
--
-- Ce fichier vérifie l'autre moitié de la frontière : ce qu'on peut écrire.
-- Une policy d'écriture sans grant est morte, un grant sans policy est une
-- porte ouverte — les deux erreurs se voient ici.
--
-- CONTRAT DE LA SUITE
-- Chaque fichier rejoue les quatre interdictions organisation : Plan,
-- Nutrition, Assistance, sortie individuelle.

begin;

create extension if not exists pgtap;

select plan(24);

\ir _personas.psql

-- ============================================================
-- 1. Hiérarchie des rôles organisation (§111, §149)
-- ============================================================
-- L'ordre de l'enum est l'inverse de la hiérarchie : un rang lexicographique
-- donnerait des droits à l'envers. Ces quatre tests le prouvent.

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select lives_ok(
  $$ insert into public.race_waypoints
       (race_id, name, waypoint_type, distance_km, sort_order)
     values ('aaaaaaaa-0000-4000-8000-000000000013', 'Ravito 2', 'aid_station', 60, 3) $$,
  'PRIVACY-P44 — l''éditeur gère le référentiel de sa course (§111)'
);

reset role;

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select throws_ok(
  $$ insert into public.race_waypoints
       (race_id, name, waypoint_type, distance_km, sort_order)
     values ('aaaaaaaa-0000-4000-8000-000000000013', 'Ravito viewer', 'aid_station', 70, 4) $$,
  '42501', null,
  'PRIVACY-P46 — un viewer ne modifie pas la course (§111)'
);

-- Les deux formes de refus, encore, et la nuance compte pour l'applicatif :
-- un INSERT interdit lève (le `with check` échoue), un DELETE interdit ne
-- lève pas — la policy retire simplement les lignes de la portée, et la
-- commande supprime zéro ligne. Un code qui attendrait une exception pour
-- conclure au refus se tromperait ici.
select lives_ok(
  $$ delete from public.races where id = 'aaaaaaaa-0000-4000-8000-000000000013' $$,
  'PRIVACY — un DELETE hors périmètre ne lève pas : il ne voit aucune ligne (§111)'
);

select isnt_empty(
  $$ select id from public.races where id = 'aaaaaaaa-0000-4000-8000-000000000013' $$,
  'PRIVACY-P46 — la course est intacte : le viewer n''a rien supprimé (§111)'
);

reset role;

-- §59 : « l'import de PII n'est pas un droit Viewer. »
select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select is_empty($$ select id from public.participant_imports $$,
  'PRIVACY — Org Viewer ne lit pas les imports de participants (§59)');
select is_empty($$ select id from public.participant_import_rows $$,
  'PRIVACY-P60 — Org Viewer ne lit pas les lignes d''import, qui portent des PII (§60)');

reset role;

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select isnt_empty($$ select id from public.participant_imports $$,
  'PRIVACY — Org Admin lit les imports de son organisation (§59)');
select isnt_empty($$ select id from public.participant_import_rows $$,
  'PRIVACY — Org Admin lit les lignes d''import de son organisation (§59)');

reset role;

-- ============================================================
-- 2. Écritures réservées au serveur (§33, §34, §30, §15)
-- ============================================================
-- Ces tables sont lisibles par leur propriétaire mais ne reçoivent aucun
-- verbe d'écriture client : le grant manque, et c'est délibéré.

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ insert into public.race_plans
       (participant_race_id, version, engine_version,
        initial_target_duration_seconds, target_duration_seconds)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 2, 'plan-1.0.0', 40000, 40000) $$,
  '42501', null,
  'PRIVACY — le client n''écrit pas un Plan directement (§33)'
);

select throws_ok(
  $$ update public.race_plans set target_duration_seconds = 1
     where id = 'aaaaaaaa-0000-4000-8000-000000000041' $$,
  '42501', null,
  'PRIVACY — le client ne réécrit pas son Plan sans passer par le moteur (§33)'
);

select throws_ok(
  $$ insert into public.plan_version_dependencies
       (race_plan_id, race_fact_version_id, dependency_type)
     values ('aaaaaaaa-0000-4000-8000-000000000041',
             'aaaaaaaa-0000-4000-8000-000000000094', 'course_fact') $$,
  '42501', null,
  'PRIVACY — le client ne déclare pas de quelle version dépend son Plan (§34)'
);

-- §30 : « Il ne peut pas en créer, en modifier, les révoquer. »
select throws_ok(
  $$ insert into public.entitlements (kind, source, user_id)
     values ('plus', 'admin', '11111111-1111-4111-8111-111111111111') $$,
  '42501', null,
  'PRIVACY-P47 — un utilisateur ne se crée pas un entitlement (§30)'
);

-- §45 : la table des jetons Assistant n'est ni lisible ni écrivable.
select throws_ok(
  $$ insert into public.assistant_access_tokens (assistant_id, token_hash)
     values ('aaaaaaaa-0000-4000-8000-000000000061', repeat('c', 64)) $$,
  '42501', null,
  'PRIVACY — le client ne fabrique pas un jeton Assistant (§45)'
);

-- §15 : les mutations de membres passent par un service serveur.
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111', 'owner') $$,
  '42501', null,
  'PRIVACY — personne ne s''auto-promeut membre d''une organisation (§15)'
);

reset role;

-- ============================================================
-- 3. Immuabilité des versions de fact (§24)
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select throws_ok(
  $$ update public.race_fact_versions set value_text = 'valeur imposée'
     where id = 'aaaaaaaa-0000-4000-8000-000000000094' $$,
  '42501', null,
  'PRIVACY-P14 — aucune écriture cliente sur une version de fact publiée (§24)'
);

select throws_ok(
  $$ delete from public.race_fact_versions
     where id = 'aaaaaaaa-0000-4000-8000-000000000094' $$,
  '42501', null,
  'PRIVACY — une version de fact ne se supprime pas : une nouvelle valeur crée une version (§24)'
);

reset role;

-- ============================================================
-- 4. Écritures propriétaire (§107, §108)
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ insert into public.library_templates (user_id, template_type, name)
     values ('11111111-1111-4111-8111-111111111111', 'bag', 'Sac type 50K') $$,
  'PRIVACY — Runner A crée un template dans sa bibliothèque'
);

-- §108 : le `with check` empêche d'écrire une ligne au nom d'un autre.
select throws_ok(
  $$ insert into public.library_templates (user_id, template_type, name)
     values ('22222222-2222-4222-8222-222222222222', 'bag', 'Sac imposé') $$,
  '42501', null,
  'PRIVACY — Runner A ne crée pas un template au nom de Runner B (§108)'
);

select lives_ok(
  $$ insert into public.tasks (participant_race_id, title)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'Tester les chaussures') $$,
  'PRIVACY — Runner A crée une tâche sur sa participation (§36)'
);

select throws_ok(
  $$ insert into public.outings (user_id, name)
     values ('22222222-2222-4222-8222-222222222222', 'Sortie imposée') $$,
  '42501', null,
  'PRIVACY — Runner A ne crée pas une sortie au nom de Runner B (§39)'
);

reset role;

-- ============================================================
-- 5. Les quatre interdictions organisation
-- ============================================================
-- Testées ici avec l'admin de l'organisation, qui a pourtant le droit de
-- manipuler les imports de participants.

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — Org Admin : aucun Plan (§31)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — Org Admin : aucune Nutrition (§40)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — Org Admin : aucune Assistance (§43)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — Org Admin : aucune sortie individuelle (§39)');

reset role;

select * from finish();
rollback;
