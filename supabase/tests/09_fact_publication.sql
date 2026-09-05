-- PLUKA — Publication d'un fact : acte humain, autorisé, journalisé
-- Référence : docs/engines/SOURCES_EXTRACTION.md §4.1, §4.2, §25, §30, §31,
--             §32, §33, §34, §35, §38, §40, §43, §44, §62 ·
--             docs/03_PRIVACY_RLS.md §8
--
-- POURQUOI CE FICHIER
--
-- « Aucun chemin d'écriture ne doit permettre de publier sans acte humain
-- autorisé et journalisé. » Une fonction bien écrite ne suffit pas à le
-- garantir : elle se contourne par un `insert` direct, et le `service_role`
-- du worker ignore la RLS.
--
-- Ce fichier attaque donc la table, pas la fonction. Les tests tournent en
-- `postgres` — plus large que `service_role`, plus large que n'importe quelle
-- session applicative. Ce qui lui est refusé est refusé à tout le monde.
--
-- CONTRAT DE LA SUITE
-- Chaque fichier rejoue les quatre interdictions organisation : Plan,
-- Nutrition, Assistance, sortie individuelle.

begin;

create extension if not exists pgtap;

select plan(38);

\ir _personas.psql

-- ============================================================
-- Un candidat à publier, tel que l'étape 3 en produit
-- ============================================================
-- Semé directement plutôt que par la chaîne d'ingestion : ce fichier juge la
-- publication, pas l'extraction. La chaîne complète est vérifiée par le test
-- de bout en bout de `packages/domain`.

insert into private.extraction_runs
  (id, source_snapshot_id, run_type, status, provider, model,
   engine_version, schema_version, prompt_version)
values
  ('dddddddd-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000092',
   'fact_extract', 'completed', 'fournisseur-test', 'modele-test',
   'sources-v1.0.0', 'extractor-1.0.0', 'extract-facts-1.0.0');

insert into private.source_blocks
  (id, source_snapshot_id, extraction_run_id, block_index, section_path, heading,
   block_type, content, locator, content_hash)
values
  ('dddddddd-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000092',
   'dddddddd-0000-4000-8000-000000000001', 0, '["Règlement", "Assistance"]'::jsonb,
   'Assistance', 'paragraph', 'Assistance autorisée uniquement à Lenk.',
   '{"cssSelector": "p"}'::jsonb, repeat('b', 64));

-- Un candidat neuf : aucune valeur publiée ne lui correspond.
insert into private.fact_candidates
  (id, extraction_run_id, race_id, category, fact_key, value_text,
   confidence_label, status, origin)
values
  ('dddddddd-0000-4000-8000-000000000010', 'dddddddd-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000013', 'assistance', 'assistance/lenk/authorization',
   'autorisée uniquement à Lenk', 'high', 'needs_review', 'ai');

-- Un candidat qui contredit la veste imperméable déjà publiée (§38).
insert into private.fact_candidates
  (id, extraction_run_id, race_id, category, fact_key, value_text,
   confidence_label, status, origin, matched_fact_id)
values
  ('dddddddd-0000-4000-8000-000000000011', 'dddddddd-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000013', 'equipment', 'veste-impermeable',
   'Veste coupe-vent simple', 'medium', 'conflict', 'ai',
   'aaaaaaaa-0000-4000-8000-000000000093');

-- Un candidat sans la moindre preuve : §20 et §34 le rendent impubliable.
insert into private.fact_candidates
  (id, extraction_run_id, race_id, category, fact_key, value_text,
   confidence_label, status, origin)
values
  ('dddddddd-0000-4000-8000-000000000012', 'dddddddd-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000013', 'rules', 'rules/sans_preuve',
   'valeur orpheline', 'low', 'detected', 'ai');

insert into private.fact_candidate_evidence
  (candidate_id, source_block_id, section_path, locator, excerpt, is_primary)
values
  ('dddddddd-0000-4000-8000-000000000010', 'dddddddd-0000-4000-8000-000000000002',
   '["Règlement", "Assistance"]'::jsonb, '{"cssSelector": "p"}'::jsonb,
   'Assistance autorisée uniquement à Lenk.', true),
  ('dddddddd-0000-4000-8000-000000000011', 'dddddddd-0000-4000-8000-000000000002',
   '["Règlement", "Assistance"]'::jsonb, '{"cssSelector": "p"}'::jsonb,
   'Veste coupe-vent simple', true);

insert into private.conflict_reports
  (race_id, fact_key, existing_fact_id, candidate_id, conflict_type)
values
  ('aaaaaaaa-0000-4000-8000-000000000013', 'veste-impermeable',
   'aaaaaaaa-0000-4000-8000-000000000093', 'dddddddd-0000-4000-8000-000000000011',
   'published_fact_conflict');

-- ============================================================
-- 1. Aucune publication anonyme (§25, §30)
-- ============================================================
-- Couche déclarative : elle ne dépend d'aucun rôle, d'aucune policy, d'aucune
-- fonction. Elle vaut donc aussi pour le `service_role` du worker.

select throws_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status, published_at)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 2, 'publié par personne',
             'published', now()) $$,
  '23514',
  null,
  'SRC-30 — une version publiée sans auteur humain est refusée par la contrainte'
);

select lives_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 3, 'brouillon sans auteur', 'draft') $$,
  'SRC-30 — un brouillon sans auteur reste possible : seule la publication est gardée'
);

-- ============================================================
-- 2. L'auteur doit avoir autorité, relue en base (§30)
-- ============================================================

select throws_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status, published_at,
        published_by_user_id)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 4, 'publié par un coureur',
             'published', now(), '11111111-1111-4111-8111-111111111111') $$,
  '42501',
  null,
  'SRC-30 — un coureur ne peut pas être l''auteur d''une publication'
);

select throws_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status, published_at,
        published_by_user_id)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 5, 'publié par un viewer',
             'published', now(), '66666666-6666-4666-8666-666666666666') $$,
  '42501',
  null,
  'SRC-30 — un rôle viewer ne publie pas : editor est le minimum d''écriture'
);

select throws_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status, published_at,
        published_by_user_id)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 6, 'publié par un ancien membre',
             'published', now(), '99999999-9999-4999-8999-999999999999') $$,
  '42501',
  null,
  'PRIV-114 — un membre parti ne publie plus, l''autorité étant relue à chaque écriture'
);

select throws_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status, published_at,
        published_by_user_id)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 7, 'publié par une autre organisation',
             'published', now(), '77777777-7777-4777-8777-777777777777') $$,
  '42501',
  null,
  'SRC-30 — l''owner d''une autre organisation n''a pas autorité sur cette course'
);

select lives_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status, published_at,
        published_by_user_id)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 8, 'publié par l''éditeur',
             'published', now(), '55555555-5555-4555-8555-555555555555') $$,
  'SRC-30 — l''éditeur de l''organisation gestionnaire publie'
);

-- ============================================================
-- 3. « Officielle » n'est conféré que par l'organisation (§32)
-- ============================================================

select throws_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status, published_at,
        published_by_user_id, trust_level, validated_by_organization_id)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 9, 'officielle par PLUKA',
             'published', now(), '88888888-8888-4888-8888-888888888888',
             'official', 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501',
  null,
  'SRC-32 — un admin PLUKA non membre ne rend pas une information « officielle »'
);

select throws_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status, published_at,
        published_by_user_id, trust_level, validated_by_organization_id)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 10, 'officielle au nom d''une autre',
             'published', now(), '55555555-5555-4555-8555-555555555555',
             'official', 'aaaaaaaa-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'SRC-32 — une organisation ne confère pas « officielle » à la course d''une autre'
);

select lives_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status, published_at,
        published_by_user_id, trust_level, validated_by_organization_id)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 11, 'officielle par son organisation',
             'published', now(), '55555555-5555-4555-8555-555555555555',
             'official', 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  'SRC-32 — l''organisation gestionnaire confère « officielle » à sa propre course'
);

-- §4.2 : « Validée PLUKA » est une vérification faite par PLUKA. Une
-- organisation ne se décerne pas le label d'un tiers.
select throws_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status, published_at,
        published_by_user_id, trust_level)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 12, 'auto-validée PLUKA',
             'published', now(), '55555555-5555-4555-8555-555555555555',
             'pluka_validated') $$,
  '42501',
  null,
  'SRC-4.2 — une organisation ne se décerne pas le niveau « validée PLUKA »'
);

select lives_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status, published_at,
        published_by_user_id, trust_level)
     values ('aaaaaaaa-0000-4000-8000-000000000095', 13, 'validée par PLUKA',
             'published', now(), '88888888-8888-4888-8888-888888888888',
             'pluka_validated') $$,
  'SRC-4.2 — un admin PLUKA publie une information « validée PLUKA »'
);

-- ============================================================
-- 4. La fonction de publication exige une session (§25, §30)
-- ============================================================
-- Sans `auth.uid()`, il n'y a pas d'acte humain. C'est le cas du worker et de
-- tout appel en `service_role`.

select throws_ok(
  $$ select * from private.publish_fact_from_candidate(
       'dddddddd-0000-4000-8000-000000000010',
       '55555555-5555-4555-8555-555555555555',
       'official', null, null, null, null, null, false) $$,
  '42501',
  null,
  'SRC-25 — sans session, la publication est refusée : aucun acte humain'
);

select is(
  (select count(*)::integer from public.race_facts
   where race_id = 'aaaaaaaa-0000-4000-8000-000000000013'
     and fact_key = 'assistance/lenk/authorization'),
  0,
  'SRC-25 — et rien n''a été créé au passage'
);

-- ============================================================
-- 5. Publication par un éditeur autorisé (§31, §33)
-- ============================================================

select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555555', 'role', 'authenticated')::text,
  true);
set local role authenticated;

select throws_ok(
  $$ select * from public.publish_fact_candidate(
       'dddddddd-0000-4000-8000-000000000010',
       '33333333-3333-4333-8333-333333333333',
       'official') $$,
  '42501',
  null,
  'SRC-30 — publier au nom d''un autre utilisateur est refusé'
);

select throws_ok(
  $$ select * from public.publish_fact_candidate(
       'dddddddd-0000-4000-8000-000000000012',
       '55555555-5555-4555-8555-555555555555',
       'official') $$,
  '55000',
  null,
  'SRC-34 — FACT_SOURCE_MISSING : un candidat sans preuve ne se publie pas'
);

select throws_ok(
  $$ select * from public.publish_fact_candidate(
       'dddddddd-0000-4000-8000-000000000011',
       '55555555-5555-4555-8555-555555555555',
       'official') $$,
  '55000',
  null,
  'SRC-38 — FACT_CONFLICT_UNRESOLVED : un conflit ne se publie pas en silence'
);

select lives_ok(
  $$ select * from public.publish_fact_candidate(
       'dddddddd-0000-4000-8000-000000000010',
       '55555555-5555-4555-8555-555555555555',
       'official', null, null, null, null, 'validé en revue') $$,
  'SPEC-33 — un éditeur autorisé publie un candidat'
);

reset role;

select is(
  (select v.value_text
   from public.race_facts f
   join public.race_fact_versions v on v.id = f.current_version_id
   where f.race_id = 'aaaaaaaa-0000-4000-8000-000000000013'
     and f.fact_key = 'assistance/lenk/authorization'),
  'autorisée uniquement à Lenk',
  'SPEC-33.6 — `current_version_id` pointe vers la version publiée'
);

select is(
  (select status from private.fact_candidates
   where id = 'dddddddd-0000-4000-8000-000000000010'),
  'accepted',
  'SPEC-31 — le candidat est tranché, il ne revient pas en revue'
);

select isnt_empty(
  $$ select fs.id from public.fact_sources fs
     join public.race_fact_versions v on v.id = fs.fact_version_id
     join public.race_facts f on f.id = v.fact_id
     where f.fact_key = 'assistance/lenk/authorization' and fs.is_primary $$,
  'SPEC-34 — la version publiée porte sa preuve, avec son locator'
);

select is(
  (select fs.excerpt from public.fact_sources fs
   join public.race_fact_versions v on v.id = fs.fact_version_id
   join public.race_facts f on f.id = v.fact_id
   where f.fact_key = 'assistance/lenk/authorization'),
  'Assistance autorisée uniquement à Lenk.',
  'SPEC-20 — l''extrait cité suit la publication'
);

-- ============================================================
-- 6. La décision est journalisée (§30, §31)
-- ============================================================

select results_eq(
  $$ select action, actor_user_id::text, authority
     from private.fact_publication_acts
     where candidate_id = 'dddddddd-0000-4000-8000-000000000010' $$,
  $$ values ('publish'::text, '55555555-5555-4555-8555-555555555555'::text,
             'organization_member'::text) $$,
  'SPEC-31 — l''acte de publication est journalisé avec son auteur et son autorité'
);

select isnt_empty(
  $$ select id from private.audit_logs
     where action = 'fact.publish'
       and actor_user_id = '55555555-5555-4555-8555-555555555555' $$,
  'SPEC-30 — la décision apparaît aussi dans le journal d''audit'
);

-- ============================================================
-- 7. Le changement est signalé, pas appliqué (§43, §44)
-- ============================================================

select results_eq(
  $$ select severity::text from public.race_change_events ce
     join public.race_facts f on f.id = ce.fact_id
     where f.fact_key = 'assistance/lenk/authorization' $$,
  $$ values ('important'::text) $$,
  'SPEC-43 — une première publication d''assistance produit un changement signalé'
);

select isnt_empty(
  $$ select id from private.outbox_events
     where event_type = 'race.fact.published' $$,
  'SPEC-33.7 — l''événement métier part dans la transaction de publication'
);

select is_empty(
  $$ select id from public.participant_change_impacts $$,
  'SPEC-44 — le moteur signale le changement, il ne réécrit aucun objet downstream'
);

-- ============================================================
-- 8. Résolution explicite d'un conflit (§38, §40)
-- ============================================================

select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555555', 'role', 'authenticated')::text,
  true);
set local role authenticated;

select lives_ok(
  $$ select * from public.publish_fact_candidate(
       'dddddddd-0000-4000-8000-000000000011',
       '55555555-5555-4555-8555-555555555555',
       'official', 'Veste imperméable à coutures étanchées, capuche obligatoire',
       null, null, null, 'conflit tranché : le règlement fait foi', true) $$,
  'SPEC-40 — un conflit se résout explicitement, en éditant la valeur'
);

reset role;

select is(
  (select value_text from public.race_fact_versions
   where id = 'aaaaaaaa-0000-4000-8000-000000000094'),
  'Veste imperméable à coutures étanchées',
  'SPEC-35 — l''ancienne version garde sa valeur, elle n''est pas réécrite'
);

select is(
  (select workflow_status::text from public.race_fact_versions
   where id = 'aaaaaaaa-0000-4000-8000-000000000094'),
  'superseded',
  'SPEC-35 — elle est remplacée, et reste accessible à l''audit'
);

select results_eq(
  $$ select action from private.fact_publication_acts
     where candidate_id = 'dddddddd-0000-4000-8000-000000000011' $$,
  $$ values ('edit_and_publish'::text) $$,
  'SPEC-31 — une valeur corrigée avant publication est journalisée comme telle'
);

select is(
  (select original_value->>'valueText' from private.fact_publication_acts
   where candidate_id = 'dddddddd-0000-4000-8000-000000000011'),
  'Veste coupe-vent simple',
  'SPEC-31 — le journal conserve la valeur que l''humain a écartée'
);

select is(
  (select status from private.conflict_reports
   where candidate_id = 'dddddddd-0000-4000-8000-000000000011'),
  'resolved',
  'SPEC-40 — la résolution clôt le conflit'
);

select results_eq(
  $$ select severity::text from public.race_change_events ce
     where ce.fact_id = 'aaaaaaaa-0000-4000-8000-000000000093' $$,
  $$ values ('critical'::text) $$,
  'SPEC-43 — changer une exigence de matériel déjà publiée est un changement critique'
);

-- ============================================================
-- 9. Les quatre interdictions organisation (contrat de suite)
-- ============================================================

select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-4333-8333-333333333333', 'role', 'authenticated')::text,
  true);
set local role authenticated;

select is_empty(
  $$ select id from public.race_plans $$,
  'PRIV-1 — l''organisation ne lit aucun Plan'
);

select is_empty(
  $$ select id from public.nutrition_plans $$,
  'PRIV-2 — l''organisation ne lit aucune Nutrition'
);

select is_empty(
  $$ select id from public.race_assistants $$,
  'PRIV-3 — l''organisation ne lit aucune Assistance'
);

select is_empty(
  $$ select id from public.outings $$,
  'PRIV-4 — l''organisation ne lit aucune sortie individuelle'
);

select * from finish();

rollback;
