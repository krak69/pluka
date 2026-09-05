-- PLUKA — Une valeur publiée ne se réécrit pas
-- Référence : docs/engines/SOURCES_EXTRACTION.md §23, §25, §35, §61 ·
--             docs/03_PRIVACY_RLS.md §8
--
-- POURQUOI CE FICHIER
--
-- L'étape 3 de l'ingestion produit des candidats, et la règle non négociable
-- est qu'« une extraction ne modifie jamais silencieusement une donnée
-- existante ». La RLS interdit déjà l'écriture aux rôles client (04). Elle ne
-- dit rien du `service_role`, qui est précisément celui qu'emprunte le worker
-- d'extraction : c'est donc le seul rôle capable de contredire la règle, et le
-- seul qui mérite d'être mis à l'épreuve.
--
-- Le garde-fou lui-même date de 0001 : il n'était simplement couvert par aucun
-- test, et 0011 y ajoute `trust_level` pour §32. Ce fichier vérifie les deux.
--
-- Les tests tournent en `postgres`, rôle encore plus large que `service_role` :
-- ce qui lui est refusé l'est à tout le monde.
--
-- CONTRAT DE LA SUITE
-- Chaque fichier rejoue les quatre interdictions organisation : Plan,
-- Nutrition, Assistance, sortie individuelle.

begin;

create extension if not exists pgtap;

select plan(17);

\ir _personas.psql

-- ============================================================
-- 1. La valeur d'une version publiée est close (§23, §35)
-- ============================================================

select throws_ok(
  $$ update public.race_fact_versions
     set value_text = 'valeur réécrite par une extraction'
     where id = 'aaaaaaaa-0000-4000-8000-000000000094' $$,
  'race_fact_versions payload is immutable; create a new version instead',
  'SRC-35 — réécrire la valeur d''une version publiée est refusé'
);

select is(
  (select value_text from public.race_fact_versions
   where id = 'aaaaaaaa-0000-4000-8000-000000000094'),
  'Veste imperméable à coutures étanchées',
  'SRC-35 — après le refus, la valeur publiée est intacte'
);

select throws_ok(
  $$ update public.race_fact_versions
     set value_number = 42
     where id = 'aaaaaaaa-0000-4000-8000-000000000094' $$,
  'race_fact_versions payload is immutable; create a new version instead',
  'SRC-35 — écrire une valeur numérique sur une version existante est refusé'
);

select throws_ok(
  $$ update public.race_fact_versions
     set value_json = '{"reecrit": true}'::jsonb
     where id = 'aaaaaaaa-0000-4000-8000-000000000094' $$,
  'race_fact_versions payload is immutable; create a new version instead',
  'SRC-35 — écrire une valeur structurée sur une version existante est refusé'
);

select throws_ok(
  $$ update public.race_fact_versions
     set unit = 'km'
     where id = 'aaaaaaaa-0000-4000-8000-000000000094' $$,
  'race_fact_versions payload is immutable; create a new version instead',
  'SRC-35 — changer l''unité d''une version existante est refusé'
);

-- ============================================================
-- 2. Une version en travail n'est pas plus réécrivable (§23)
-- ============================================================
-- §23 ne distingue pas : une version est une valeur à un instant donné. Un
-- brouillon réécrit sur place perdrait son historique tout autant.

select throws_ok(
  $$ update public.race_fact_versions
     set value_text = 'brouillon réécrit'
     where id = 'aaaaaaaa-0000-4000-8000-000000000096' $$,
  'race_fact_versions payload is immutable; create a new version instead',
  'SRC-23 — réécrire la valeur d''un brouillon est refusé aussi'
);

-- ============================================================
-- 3. L'identité d'une version est close (§24)
-- ============================================================

select throws_ok(
  $$ update public.race_fact_versions
     set fact_id = 'aaaaaaaa-0000-4000-8000-000000000095'
     where id = 'aaaaaaaa-0000-4000-8000-000000000094' $$,
  'race_fact_versions payload is immutable; create a new version instead',
  'SRC-24 — rattacher une version à un autre fact est refusé'
);

select throws_ok(
  $$ update public.race_fact_versions
     set version_number = 7
     where id = 'aaaaaaaa-0000-4000-8000-000000000094' $$,
  'race_fact_versions payload is immutable; create a new version instead',
  'SRC-23 — renuméroter une version est refusé'
);

-- ============================================================
-- 4. Le niveau de confiance ne se change pas en place (§32)
-- ============================================================
-- « Seule une organisation autorisée peut conférer le niveau Officielle. »
-- Requalifier une version existante contournerait ce workflow sans laisser de
-- trace : la requalification passe par une nouvelle version.

select throws_ok(
  $$ update public.race_fact_versions
     set trust_level = 'pluka_validated'
     where id = 'aaaaaaaa-0000-4000-8000-000000000094' $$,
  'race_fact_versions payload is immutable; create a new version instead',
  'SRC-32 — requalifier le niveau de confiance en place est refusé'
);

-- ============================================================
-- 5. Le cycle de vie reste ouvert (§33)
-- ============================================================
-- Sans cela, la publication de §33 — « créer une nouvelle version, mettre à
-- jour current_version_id » — n'aurait plus de chemin. Ce qui est fermé est la
-- valeur, pas l'état.

select lives_ok(
  $$ update public.race_fact_versions
     set workflow_status = 'superseded'
     where id = 'aaaaaaaa-0000-4000-8000-000000000094' $$,
  'SPEC-33 — marquer une version comme remplacée reste possible'
);

select is(
  (select workflow_status::text from public.race_fact_versions
   where id = 'aaaaaaaa-0000-4000-8000-000000000094'),
  'superseded',
  'SPEC-33 — le changement de cycle de vie a bien été appliqué'
);

select lives_ok(
  $$ insert into public.race_fact_versions
       (fact_id, version_number, value_text, workflow_status, published_at,
        supersedes_version_id)
     values
       ('aaaaaaaa-0000-4000-8000-000000000093', 2,
        'Veste imperméable — nouvelle exigence', 'published', now(),
        'aaaaaaaa-0000-4000-8000-000000000094') $$,
  'SPEC-33 — publier une nouvelle version reste le chemin normal'
);

select is(
  (select count(*)::integer from public.race_fact_versions
   where fact_id = 'aaaaaaaa-0000-4000-8000-000000000093'),
  2,
  'SPEC-23 — l''ancienne version reste accessible à côté de la nouvelle'
);

-- ============================================================
-- 6. Les quatre interdictions organisation (contrat de suite)
-- ============================================================
-- Une organisation ne lit ni Plan, ni Nutrition, ni Assistance, ni sortie
-- individuelle. Rien de ce qui précède n'ouvre une de ces portes.

select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-000000000002', 'role', 'authenticated')::text,
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
