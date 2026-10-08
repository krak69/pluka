-- PLUKA — Matériel d'une épreuve, saisi à la main
-- Référence : migration 0045 · 00_PRODUCT_SPEC §14.1 · SOURCES_EXTRACTION §82 · AGENTS §14, §91
--
-- 1. Qui peut ajouter : éditeur de l'organisation, admin PLUKA ; ni lecteur,
--    ni autre organisation. « Officielle » réservée à l'éditeur.
-- 2. Un élément est une information versionnée, sourcée « Saisie manuelle »,
--    signalée à l'analyseur d'impact.
-- 3. Plusieurs épreuves d'une même édition en un geste ; pas de doublon.
-- 4. Corriger crée N+1 ; la correction générique refuse le matériel.

begin;

create extension if not exists pgtap;

select plan(24);

\ir _personas.psql

-- ============================================================
-- 1. Qui peut
-- ============================================================

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.add_race_equipment(
       array['aaaaaaaa-0000-4000-8000-000000000013']::uuid[], 'equipment.frontale', 'Frontale',
       'mandatory', null, null, 'official') $$,
  '42501', null,
  'EQUIP-01 — lecteur de l''organisation : refusé'
);
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.add_race_equipment(
       array['aaaaaaaa-0000-4000-8000-000000000013']::uuid[], 'equipment.frontale', 'Frontale',
       'mandatory', null, null, 'official') $$,
  '42501', null,
  'EQUIP-02 — owner d''une autre organisation : refusé'
);
reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.add_race_equipment(
       array['aaaaaaaa-0000-4000-8000-000000000013']::uuid[], 'equipment.frontale', 'Frontale',
       'mandatory', null, null, 'pluka_validated') $$,
  '42501', 'PLUKA_VALIDATION_REQUIRED',
  'EQUIP-03b — éditeur de l''organisation : « Validée PLUKA » lui est refusée'
);
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select throws_ok(
  $$ select public.add_race_equipment(
       array['aaaaaaaa-0000-4000-8000-000000000013']::uuid[], 'equipment.frontale', 'Frontale',
       'mandatory', null, null, 'official') $$,
  '42501', 'OFFICIAL_AUTHORIZATION_REQUIRED',
  'EQUIP-03 — admin PLUKA : « Officielle » lui est refusée'
);
reset role;

-- ============================================================
-- 2. L'éditeur ajoute, pour deux épreuves de l'édition
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is(
  public.add_race_equipment(
    array['aaaaaaaa-0000-4000-8000-000000000013', 'aaaaaaaa-0000-4000-8000-000000000014']::uuid[],
    'equipment.veste-impermeable', 'Veste imperméable', 'mandatory', null, 'Membrane 10 000 mm',
    'official'),
  2,
  'EQUIP-04 — éditeur : ajouté aux deux épreuves en un geste'
);
select is(
  public.add_race_equipment(
    array['aaaaaaaa-0000-4000-8000-000000000013', 'aaaaaaaa-0000-4000-8000-000000000014']::uuid[],
    'equipment.gants', 'Gants', 'conditional', 'Si température < 5 °C', null, 'official'),
  2,
  'EQUIP-05 — un élément conditionnel avec sa condition'
);
select throws_ok(
  $$ select public.add_race_equipment(
       array['aaaaaaaa-0000-4000-8000-000000000013']::uuid[], 'equipment.bonnet', 'Bonnet',
       'conditional', '  ', null, 'official') $$,
  '22023', null,
  'EQUIP-06 — conditionnel sans condition : refusé (§82)'
);
select throws_ok(
  $$ select public.add_race_equipment(
       array['aaaaaaaa-0000-4000-8000-000000000013']::uuid[], 'equipment.gants', 'Gants',
       'mandatory', null, null, 'official') $$,
  '23505', null,
  'EQUIP-07 — déjà présent partout : refusé'
);
select is(
  public.add_race_equipment(
    array['aaaaaaaa-0000-4000-8000-000000000013']::uuid[],
    'equipment.couverture-de-survie', 'Couverture de survie', 'mandatory', null, null, 'official'),
  1,
  'EQUIP-08 — une seule épreuve visée'
);
select throws_ok(
  $$ select public.add_race_equipment(
       array['aaaaaaaa-0000-4000-8000-000000000013', 'bbbbbbbb-0000-4000-8000-000000000013']::uuid[],
       'equipment.sifflet', 'Sifflet', 'mandatory', null, null, 'official') $$,
  '22023', null,
  'EQUIP-09 — deux éditions différentes : refusé'
);
select throws_ok(
  $$ select public.add_race_equipment(
       array['aaaaaaaa-0000-4000-8000-000000000013']::uuid[], 'Frontale', 'Frontale',
       'mandatory', null, null, 'official') $$,
  '22023', null,
  'EQUIP-10 — clé mal formée : refusée'
);
reset role;

-- ============================================================
-- 3. Ce qui est écrit
-- ============================================================

select is(
  (select v.value_json from public.race_facts f
   join public.race_fact_versions v on v.id = f.current_version_id
   where f.race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and f.fact_key = 'equipment.gants'),
  '{"requirement": "conditional", "condition": "Si température < 5 °C", "detail": null}'::jsonb,
  'EQUIP-11 — la structure vit dans la version'
);

select is(
  (select f.category::text || '|' || v.value_text || '|' || v.trust_level::text || '|' || v.workflow_status::text
   from public.race_facts f
   join public.race_fact_versions v on v.id = f.current_version_id
   where f.race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and f.fact_key = 'equipment.veste-impermeable'),
  'equipment|Veste imperméable|official|published',
  'EQUIP-12 — information « Matériel », nom de l''organisation, officielle, publiée'
);

select is(
  (select string_agg(distinct s.source_type::text || ':' || s.title, ',')
   from public.fact_sources fs
   join public.sources s on s.id = fs.source_id
   join public.race_fact_versions v on v.id = fs.fact_version_id
   where v.created_by_user_id = '55555555-5555-4555-8555-555555555555'
     and s.edition_id = 'aaaaaaaa-0000-4000-8000-000000000012'),
  'organizer_input:Saisie de l''organisation',
  'EQUIP-13 — l''éditeur saisit : une seule source « Saisie de l''organisation » pour l''édition'
);

select is(
  (select count(*)::integer from private.outbox_events e
   where e.event_type = 'race.fact.published'
     and e.payload ->> 'factKey' like 'equipment.%'),
  5,
  'EQUIP-14 — chaque ajout est signalé à l''analyseur d''impact'
);

select is(
  (select count(*)::integer from private.fact_publication_acts a
   join public.race_facts f on f.id = a.fact_id
   where f.category = 'equipment' and a.action = 'publish'
     and a.actor_user_id = '55555555-5555-4555-8555-555555555555'),
  5,
  'EQUIP-15 — chaque ajout nomme son auteur'
);

-- L'admin PLUKA ajoute en « Validée PLUKA ».
select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select is(
  public.add_race_equipment(
    array['aaaaaaaa-0000-4000-8000-000000000013']::uuid[],
    'equipment.frontale', 'Frontale', 'recommended', null, null, 'pluka_validated'),
  1,
  'EQUIP-16 — admin PLUKA : ajout en « Validée PLUKA »'
);
reset role;

select is(
  (select s.source_type::text || ':' || s.title
   from public.race_facts f
   join public.fact_sources fs on fs.fact_version_id = f.current_version_id
   join public.sources s on s.id = fs.source_id
   where f.race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and f.fact_key = 'equipment.frontale'),
  'manual:Saisie PLUKA',
  'EQUIP-16b — l''équipe PLUKA saisit : la source dit « Saisie PLUKA »'
);

-- ============================================================
-- 4. Corriger
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select lives_ok(
  $$ select public.revise_race_equipment(
       (select id from public.race_facts where race_id = 'aaaaaaaa-0000-4000-8000-000000000013'
          and fact_key = 'equipment.frontale'),
       'Frontale + piles de rechange', 'mandatory', null, null, 'official', 'règlement 2026') $$,
  'EQUIP-17 — éditeur : corriger le nom et passer en obligatoire'
);
select throws_ok(
  $$ select public.revise_race_equipment(
       (select id from public.race_facts where race_id = 'aaaaaaaa-0000-4000-8000-000000000013'
          and fact_key = 'equipment.frontale'),
       'Frontale + piles de rechange', 'mandatory', null, null, 'official') $$,
  '55000', null,
  'EQUIP-18 — même valeur : aucune modification'
);
select throws_ok(
  $$ select public.revise_race_fact(
       (select id from public.race_facts where race_id = 'aaaaaaaa-0000-4000-8000-000000000013'
          and fact_key = 'equipment.frontale'),
       'Frontale', null, null, 'official') $$,
  '55000', null,
  'EQUIP-19 — la correction générique refuse le matériel'
);
reset role;

select is(
  (select string_agg(v.version_number::text || ':' || v.workflow_status::text, ',' order by v.version_number)
   from public.race_fact_versions v
   join public.race_facts f on f.id = v.fact_id
   where f.race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and f.fact_key = 'equipment.frontale'),
  '1:superseded,2:published',
  'EQUIP-20 — la version 1 reste, en superseded (AGENTS §14)'
);

select is(
  (select count(*)::integer from public.fact_sources fs
   join public.race_fact_versions v on v.id = fs.fact_version_id
   join public.race_facts f on f.id = v.fact_id
   where f.fact_key = 'equipment.frontale' and v.version_number = 2),
  1,
  'EQUIP-21 — la preuve suit la nouvelle version'
);

-- La lecture d'édition rend la structure.
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is(
  (select item -> 'valueJson' ->> 'requirement'
   from jsonb_array_elements(public.list_race_facts_for_editing('aaaaaaaa-0000-4000-8000-000000000013')) item
   where item ->> 'factKey' = 'equipment.frontale'),
  'mandatory',
  'EQUIP-22 — la lecture d''édition rend l''exigence'
);
reset role;

select * from finish();

rollback;
