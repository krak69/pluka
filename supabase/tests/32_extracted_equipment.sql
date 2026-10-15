-- PLUKA — Matériel extrait d'un document ou d'une page
-- Référence : migration 0046 · SOURCES_EXTRACTION §31, §38, §82, S14 · AGENTS §13, §14
--
-- 1. Une version de matériel qui porte une structure la porte bien formée,
--    quel que soit le chemin d'écriture.
-- 2. Un candidat dont l'exigence diffère de la version publiée est une
--    contradiction ; une exigence que le document ne dit pas n'en est pas une.
-- 3. La revue publie la structure choisie, en version N+1.

begin;

create extension if not exists pgtap;

select plan(14);

\ir _personas.psql

-- ============================================================
-- 1. La structure, gardée à l'écriture
-- ============================================================

select throws_ok(
  $$ insert into public.race_fact_versions (fact_id, version_number, value_text, value_json, workflow_status)
     values ('aaaaaaaa-0000-4000-8000-000000000093', 2, 'Veste',
             '{"requirement": "optional"}'::jsonb, 'draft') $$,
  '22023', null,
  'XEQ-01 — exigence hors des trois de §82 : refusée'
);

select throws_ok(
  $$ insert into public.race_fact_versions (fact_id, version_number, value_text, value_json, workflow_status)
     values ('aaaaaaaa-0000-4000-8000-000000000093', 2, 'Veste',
             '{"requirement": "conditional", "condition": " "}'::jsonb, 'draft') $$,
  '22023', null,
  'XEQ-02 — conditionnel sans condition : refusé'
);

select throws_ok(
  $$ insert into public.race_fact_versions (fact_id, version_number, value_text, value_json, workflow_status)
     values ('aaaaaaaa-0000-4000-8000-000000000093', 2, 'Veste',
             '{"requirement": "mandatory", "taille": "XL"}'::jsonb, 'draft') $$,
  '22023', null,
  'XEQ-03 — clé inconnue dans la structure : refusée'
);

select lives_ok(
  $$ insert into public.race_fact_versions (fact_id, version_number, value_text, value_json, workflow_status)
     values ('aaaaaaaa-0000-4000-8000-000000000093', 2, 'Veste',
             '{"requirement": "conditional", "condition": "si pluie annoncée", "detail": null}'::jsonb,
             'draft') $$,
  'XEQ-04 — structure bien formée : acceptée'
);

select lives_ok(
  $$ insert into public.race_fact_versions (fact_id, version_number, value_text, value_json, workflow_status)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 2, 'Retrait',
             '{"lieu": "salle des fêtes"}'::jsonb, 'draft') $$,
  'XEQ-05 — une autre catégorie garde sa liberté de structure'
);

-- ============================================================
-- 2. Un document relu face au matériel publié
-- ============================================================

-- Les gants, publiés « recommandés » par l'éditeur.
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select public.add_race_equipment(
  array['aaaaaaaa-0000-4000-8000-000000000013']::uuid[],
  'equipment.gants', 'Gants', 'recommended', null, null, 'official');
reset role;

insert into private.extraction_runs
  (id, source_snapshot_id, run_type, status, provider, model,
   engine_version, schema_version, prompt_version)
values
  ('eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000092',
   'fact_extract', 'completed', 'fournisseur-test', 'modele-test',
   'sources-v1.0.0', 'extractor-1.1.0', 'extract-facts-1.1.0');

insert into private.source_blocks
  (id, source_snapshot_id, extraction_run_id, block_index, section_path, heading,
   block_type, content, locator, content_hash)
values
  ('eeeeeeee-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000092',
   'eeeeeeee-0000-4000-8000-000000000001', 0, '["Règlement", "Matériel"]'::jsonb,
   'Matériel', 'paragraph', 'Gants obligatoires. Frontale obligatoire.',
   '{"cssSelector": "p"}'::jsonb, repeat('c', 64));

select private.record_fact_candidates(
  'eeeeeeee-0000-4000-8000-000000000001',
  'eeeeeeee-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000092',
  jsonb_build_array(
    jsonb_build_object(
      'factType', 'equipment', 'factKey', 'equipment.gants', 'valueText', 'Gants',
      'valueJson', jsonb_build_object('requirement', 'mandatory', 'condition', null, 'detail', null),
      'confidence', 'high', 'origin', 'ai', 'reviewState', 'needs_review', 'notes', 'obligatoire',
      'evidence', jsonb_build_array(jsonb_build_object(
        'blockIndex', 0, 'chunkIndex', null, 'isPrimary', true, 'excerpt', 'Gants obligatoires.'))),
    jsonb_build_object(
      'factType', 'equipment', 'factKey', 'equipment.gants', 'valueText', 'Gants',
      'valueJson', null,
      'confidence', 'medium', 'origin', 'ai', 'reviewState', 'needs_review', 'notes', 'sans exigence',
      'evidence', jsonb_build_array(jsonb_build_object(
        'blockIndex', 0, 'chunkIndex', null, 'isPrimary', true, 'excerpt', 'Gants'))),
    jsonb_build_object(
      'factType', 'equipment', 'factKey', 'equipment.gants', 'valueText', 'Gants',
      'valueJson', jsonb_build_object('requirement', 'recommended', 'condition', null, 'detail', null),
      'confidence', 'high', 'origin', 'ai', 'reviewState', 'needs_review', 'notes', 'recommandé',
      'evidence', jsonb_build_array(jsonb_build_object(
        'blockIndex', 0, 'chunkIndex', null, 'isPrimary', true, 'excerpt', 'Gants'))),
    jsonb_build_object(
      'factType', 'equipment', 'factKey', 'equipment.frontale', 'valueText', 'Frontale',
      'valueJson', jsonb_build_object('requirement', 'mandatory', 'condition', null, 'detail', null),
      'confidence', 'high', 'origin', 'ai', 'reviewState', 'needs_review', 'notes', 'nouvelle',
      'evidence', jsonb_build_array(jsonb_build_object(
        'blockIndex', 0, 'chunkIndex', null, 'isPrimary', true, 'excerpt', 'Frontale obligatoire.')))
  )
);

select is(
  (select status from private.fact_candidates
   where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and notes = 'obligatoire'),
  'conflict',
  'XEQ-06 — recommandé publié, obligatoire lu : contradiction (§38, S14)'
);

select is(
  (select count(*)::integer from private.conflict_reports r
   join private.fact_candidates c on c.id = r.candidate_id
   where c.race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and c.notes = 'obligatoire'),
  1,
  'XEQ-07 — la contradiction est matérialisée pour la revue'
);

select is(
  (select status from private.fact_candidates
   where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and notes = 'sans exigence'),
  'needs_review',
  'XEQ-08 — exigence non dite par le document : pas une contradiction'
);

select is(
  (select status from private.fact_candidates
   where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and notes = 'recommandé'),
  'needs_review',
  'XEQ-09 — même exigence : pas une contradiction'
);

select is(
  (select matched_fact_id is null and status = 'needs_review' from private.fact_candidates
   where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and notes = 'nouvelle'),
  true,
  'XEQ-10 — matériel absent de la fiche : une proposition neuve'
);

-- ============================================================
-- 3. La revue publie la structure choisie
-- ============================================================

-- Lus avant de prendre le rôle de l'éditeur : le schéma privé ne lui est pas ouvert.
select id as cand_new from private.fact_candidates
where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and notes = 'nouvelle' \gset
select id as cand_conflict from private.fact_candidates
where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and notes = 'obligatoire' \gset

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select throws_ok(
  format($f$ select * from public.publish_fact_candidate(%L::uuid,
       '55555555-5555-4555-8555-555555555555', 'official', 'Frontale', null,
       '{"requirement": "conditional", "condition": null, "detail": null}'::jsonb) $f$, :'cand_new'),
  '22023', null,
  'XEQ-11 — publier un conditionnel sans condition : refusé'
);

select lives_ok(
  format($f$ select * from public.publish_fact_candidate(%L::uuid,
       '55555555-5555-4555-8555-555555555555', 'official', 'Gants', null,
       '{"requirement": "mandatory", "condition": null, "detail": "chauds"}'::jsonb,
       null, 'règlement 2026', true) $f$, :'cand_conflict'),
  'XEQ-12 — la revue tranche la contradiction et publie l''exigence lue'
);

reset role;

select is(
  (select string_agg(v.version_number::text || ':' || v.workflow_status::text || ':'
                     || coalesce(v.value_json->>'requirement', '-'), ',' order by v.version_number)
   from public.race_fact_versions v
   join public.race_facts f on f.id = v.fact_id
   where f.race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and f.fact_key = 'equipment.gants'),
  '1:superseded:recommended,2:published:mandatory',
  'XEQ-13 — version N+1 avec l''exigence, la version 1 reste (AGENTS §14)'
);

select is(
  (select count(*)::integer from public.fact_sources fs
   join public.race_facts f on f.current_version_id = fs.fact_version_id
   where f.race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and f.fact_key = 'equipment.gants'
     and fs.source_snapshot_id = 'aaaaaaaa-0000-4000-8000-000000000092'),
  1,
  'XEQ-14 — la version publiée cite le document lu'
);

select * from finish();

rollback;
