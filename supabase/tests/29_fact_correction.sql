-- PLUKA — Corriger, retirer et restaurer une information publiée
-- Référence : docs/engines/SOURCES_EXTRACTION.md §35, §37, §44 · AGENTS §14, §102 · migration 0043
--
-- 1. Seuls un éditeur de l'organisation de la course et l'administration
--    PLUKA corrigent ; un lecteur, un coureur, une autre organisation non.
-- 2. Corriger crée la version N+1 : N reste, en `superseded`, avec ses
--    preuves recopiées ; rien n'est réécrit.
-- 3. Retirer cache l'information à tout lecteur public, versions comprises,
--    sans rien effacer ; restaurer la remet.
-- 4. Chaque geste laisse un changement signalé à l'analyseur d'impact et un
--    acte au journal.

begin;

create extension if not exists pgtap;

select plan(18);

\ir _personas.psql

delete from private.audit_logs;
delete from private.outbox_events;

-- La fixture attache déjà une preuve principale à la version 1 du matériel.

-- Depuis 0045, le matériel a son propre geste de correction
-- (`revise_race_equipment`), et la correction générique le refuse — pièce
-- testée en 31. Ce fichier éprouve la correction générique : l'information
-- de la fixture y est donc lue comme une consigne de sécurité — catégorie
-- critique elle aussi (§43), pour que FIX-10 garde son sens — sans rien
-- changer d'autre à ce qu'elle porte.
update public.race_facts set category = 'safety'
where id = 'aaaaaaaa-0000-4000-8000-000000000093';

-- ============================================================
-- 1. Qui corrige
-- ============================================================

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.revise_race_fact('aaaaaaaa-0000-4000-8000-000000000093', 'Veste', null, null, 'pluka_validated') $$,
  '42501', null, 'FIX-01 — lecteur de l''organisation : corriger est refuse');
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.retire_race_fact('aaaaaaaa-0000-4000-8000-000000000093') $$,
  '42501', null, 'FIX-02 — coureur : retirer est refuse');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.list_race_facts_for_editing('aaaaaaaa-0000-4000-8000-000000000013') $$,
  '42501', null, 'FIX-03 — autre organisation : meme la lecture est refusee');
reset role;

-- ============================================================
-- 2. Corriger
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select throws_ok(
  $$ select public.revise_race_fact('aaaaaaaa-0000-4000-8000-000000000093', '  ', null, null, 'pluka_validated') $$,
  '22023', null, 'FIX-04 — une version sans valeur est refusee');

select lives_ok(
  $$ select public.revise_race_fact('aaaaaaaa-0000-4000-8000-000000000093',
       'Veste imperméable avec capuche, coutures étanchées', null, null, 'pluka_validated',
       'Capuche oubliée par l''extraction') $$,
  'FIX-05 — admin : corriger une information publiee');

select throws_ok(
  $$ select public.revise_race_fact('aaaaaaaa-0000-4000-8000-000000000093',
       'Veste imperméable avec capuche, coutures étanchées', null, null, 'pluka_validated') $$,
  '55000', null, 'FIX-06 — la meme valeur ne cree pas de version');
reset role;

select results_eq(
  $$ select version_number, workflow_status::text, trust_level::text
     from public.race_fact_versions where fact_id = 'aaaaaaaa-0000-4000-8000-000000000093'
     order by version_number $$,
  $$ values (1, 'superseded'::text, 'community'::text), (2, 'published', 'pluka_validated') $$,
  'FIX-07 — la version 1 reste, remplacee ; la version 2 est publiee');

select is(
  (select v.value_text from public.race_fact_versions v where v.id = 'aaaaaaaa-0000-4000-8000-000000000094'),
  'Veste imperméable à coutures étanchées', 'FIX-08 — la valeur de la version 1 n''est pas reecrite');

select is(
  (select count(*)::integer from public.fact_sources fs
   join public.race_facts f on f.current_version_id = fs.fact_version_id
   where f.id = 'aaaaaaaa-0000-4000-8000-000000000093'),
  (select count(*)::integer from public.fact_sources where fact_version_id = 'aaaaaaaa-0000-4000-8000-000000000094'),
  'FIX-09 — les preuves de la version 1 suivent la nouvelle version');

select results_eq(
  $$ select change_kind, severity::text from public.race_change_events
     where fact_id = 'aaaaaaaa-0000-4000-8000-000000000093' $$,
  $$ values ('revised'::text, 'critical'::text) $$,
  'FIX-10 — corriger une information critique signale un changement critique');

select is(
  (select count(*)::integer from private.outbox_events where event_type = 'race.fact.revised'),
  1, 'FIX-11 — l''analyseur d''impact est prevenu');

-- ============================================================
-- 3. Retirer, restaurer
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select lives_ok(
  $$ select public.retire_race_fact('aaaaaaaa-0000-4000-8000-000000000093', 'Plus demandée cette année') $$,
  'FIX-12 — editeur de l''organisation : retirer une information');
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::integer from public.race_facts where id = 'aaaaaaaa-0000-4000-8000-000000000093')
  + (select count(*)::integer from public.race_fact_versions where fact_id = 'aaaaaaaa-0000-4000-8000-000000000093'),
  0, 'FIX-13 — un coureur ne voit plus l''information retiree, ni ses versions');
reset role;

select is(
  (select count(*)::integer from public.race_fact_versions where fact_id = 'aaaaaaaa-0000-4000-8000-000000000093'),
  2, 'FIX-14 — rien n''est efface : les deux versions restent');

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select throws_ok(
  $$ select public.revise_race_fact('aaaaaaaa-0000-4000-8000-000000000093', 'Autre', null, null, 'pluka_validated') $$,
  '55000', null, 'FIX-15 — une information retiree se restaure avant de se corriger');
select lives_ok(
  $$ select public.restore_race_fact('aaaaaaaa-0000-4000-8000-000000000093') $$,
  'FIX-16 — restaurer une information retiree');
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  (select v.value_text from public.race_facts f join public.race_fact_versions v on v.id = f.current_version_id
   where f.id = 'aaaaaaaa-0000-4000-8000-000000000093'),
  'Veste imperméable avec capuche, coutures étanchées', 'FIX-17 — restauree, elle est de nouveau lisible');
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select results_eq(
  $$ select h ->> 'action' from jsonb_array_elements(
       public.list_race_fact_history('aaaaaaaa-0000-4000-8000-000000000093')) h order by 1 $$,
  $$ values ('restore'::text), ('retire'), ('revise') $$,
  'FIX-18 — l''historique montre chaque geste (une transaction : meme horodatage, d''ou le tri)');
reset role;

select * from finish();

rollback;
