-- PLUKA — Lectures de la console d'administration
-- Référence : docs/03_PRIVACY_RLS.md §8, §104, §136 · migration 0028
--
-- POURQUOI CE FICHIER
--
-- 0028 ouvre onze lectures qui contournent la RLS. Chacune porte sa propre
-- condition d'accès, et une condition portée par du code n'est vraie que si
-- elle est vérifiée : une garde oubliée dans une seule des onze fonctions
-- ouvrirait la table à tout le monde, sans qu'aucune policy ne le signale.
--
-- CONTRAT DE LA SUITE
--
-- §136 : « positif + négatif ». Onze paires — un admin obtient ses lignes, un
-- coureur reçoit `42501`. Le refus compte autant que l'accès : un résultat vide
-- se confondrait avec « rien à afficher », et masquerait une erreur de droits
-- derrière un écran plausible.
--
-- Et les deux moitiés de §104 : les trois lectures de données personnelles
-- écrivent dans le journal d'audit, les huit lectures opérationnelles n'y
-- écrivent rien. La seconde moitié n'est pas un détail — un journal qui
-- enregistrerait chaque consultation de la file de traitements noierait les
-- accès aux identités qu'il doit rendre visibles.
--
-- Chaque fichier rejoue les quatre interdictions organisation : Plan,
-- Nutrition, Assistance, sortie individuelle. Elles valent aussi pour l'admin,
-- et 0028 ne doit pas les avoir rouvertes par la porte de service.

begin;

create extension if not exists pgtap;

select plan(46);

-- Les organisations déjà présentes dans la base locale, avant celles du test.
select count(*) as orgs_before from public.organizations \gset

\ir _personas.psql

-- ============================================================
-- Monde complémentaire
-- ============================================================
-- Le fixture partagé ne sème ni signalement, ni produit nutrition, ni
-- traitement, ni candidat de fact : ce sont précisément les tables que 0005
-- ferme à l'administration, donc celles que cette suite doit voir apparaître.

-- Deux organisations non `active` : invisibles sous
-- `organizations__select__active`, et c'est le cas que 0028 doit rouvrir.
insert into public.organizations (id, name, slug, status) values
  ('dddddddd-0000-4000-8000-000000000001', 'Org Prospect', 'org-prospect', 'prospect'),
  ('dddddddd-0000-4000-8000-000000000002', 'Org Archivee', 'org-archivee', 'archived');

-- Un produit `draft` : l'onglet « À vérifier » porte exactement sur lui.
insert into public.nutrition_products (id, brand, name, category, carbs_g, status) values
  ('dddddddd-0000-4000-8000-000000000011', 'Marque Test', 'Gel brouillon', 'gel', 22, 'draft'),
  ('dddddddd-0000-4000-8000-000000000012', 'Marque Test', 'Gel valide', 'gel', 24, 'validated');

-- Un fil, un message, et deux signalements : un sur le message, un sur le fil.
insert into public.community_threads (id, edition_id, author_user_id, category, title, body) values
  ('dddddddd-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000012',
   '11111111-1111-4111-8111-111111111111', 'race', 'Titre du fil', 'Corps du fil');

insert into public.community_posts (id, thread_id, author_user_id, body) values
  ('dddddddd-0000-4000-8000-000000000022', 'dddddddd-0000-4000-8000-000000000021',
   '22222222-2222-4222-8222-222222222222', 'Contenu signale du message');

insert into public.community_reports (id, reporter_user_id, post_id, reason, details) values
  ('dddddddd-0000-4000-8000-000000000031', '11111111-1111-4111-8111-111111111111',
   'dddddddd-0000-4000-8000-000000000022', 'spam', 'Detail du signalement');

insert into public.community_reports (id, reporter_user_id, thread_id, reason) values
  ('dddddddd-0000-4000-8000-000000000032', '22222222-2222-4222-8222-222222222222',
   'dddddddd-0000-4000-8000-000000000021', 'misinformation');

-- Un traitement en échec : l'écran doit en montrer le statut, l'erreur et la
-- clé d'idempotence. C'est la requête SQL que cet écran doit remplacer.
insert into private.ingestion_jobs
  (id, source_snapshot_id, job_type, status, idempotency_key, attempts, last_error) values
  ('dddddddd-0000-4000-8000-000000000041', 'aaaaaaaa-0000-4000-8000-000000000092',
   'source-ingest', 'failed', 'test-idempotency-key-0041', 3, 'Trace interrompue au km 18');

-- Un candidat de fact à examiner, pour la file de validation globale.
insert into private.extraction_runs (id, source_snapshot_id, run_type, status, started_at) values
  ('dddddddd-0000-4000-8000-000000000051', 'aaaaaaaa-0000-4000-8000-000000000092',
   'fact_extract', 'completed', now());

insert into private.fact_candidates
  (id, extraction_run_id, race_id, category, fact_key, value_text, confidence_label, status) values
  ('dddddddd-0000-4000-8000-000000000052', 'dddddddd-0000-4000-8000-000000000051',
   'aaaaaaaa-0000-4000-8000-000000000013', 'equipment', 'equipment.second_layer',
   'Seconde couche 180 g', 'high', 'needs_review');

-- Le journal part d'un état connu : les assertions d'audit comptent des lignes.
delete from private.audit_logs;

-- ============================================================
-- 1. L'admin plateforme lit ses onze écrans
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select isnt_empty(
  $$ select events_total from public.admin_platform_counters() $$,
  'ADMIN-01 — compteurs de plateforme'
);

select is(
  (select organizations_total from public.admin_platform_counters()),
  4::bigint + :orgs_before,
  'ADMIN-02 — les compteurs comptent les organisations non actives'
);

select is(
  (select products_draft from public.admin_platform_counters()),
  1::bigint,
  'ADMIN-03 — les compteurs voient un produit brouillon'
);

select is(
  (select jobs_failed from public.admin_platform_counters()),
  1::bigint,
  'ADMIN-04 — les compteurs voient un traitement en echec'
);

select is(
  (select count(*) from public.admin_list_organizations(100)
    where status in ('prospect', 'archived')),
  2::bigint,
  'ADMIN-05 — Organisations rend tous les statuts'
);

select isnt_empty(
  $$ select source_id from public.admin_list_sources(100) $$,
  'ADMIN-06 — Sources, toutes editions'
);

select is(
  (select count(*) from public.admin_list_nutrition_products(null, 200)),
  2::bigint,
  'ADMIN-07 — Produits rend tous les statuts'
);

select is(
  (select count(*) from public.admin_list_nutrition_products('draft', 200)),
  1::bigint,
  'ADMIN-08 — Produits filtre par statut'
);

select is(
  (select count(*) from public.admin_list_reports(100)),
  2::bigint,
  'ADMIN-09 — Signalements, file de triage'
);

select is(
  (select target_content from public.admin_get_report('dddddddd-0000-4000-8000-000000000031')),
  'Contenu signale du message',
  'ADMIN-10 — Detail d''un signalement : le contenu vise'
);

select isnt_empty(
  $$ select user_id from public.admin_search_users('runner-a', 50) $$,
  'ADMIN-11 — Recherche d''utilisateurs par email'
);

select is(
  (select entitlement_level from public.admin_get_user('11111111-1111-4111-8111-111111111111')),
  'free',
  'ADMIN-12 — Fiche utilisateur : niveau de droit resolu'
);

select is(
  (select idempotency_key from public.admin_list_jobs(100)
    where job_id = 'dddddddd-0000-4000-8000-000000000041'),
  'test-idempotency-key-0041',
  'ADMIN-13 — Traitements : la cle d''idempotence est rendue'
);

select is(
  (select last_error from public.admin_list_jobs(100)
    where job_id = 'dddddddd-0000-4000-8000-000000000041'),
  'Trace interrompue au km 18',
  'ADMIN-14 — Traitements : l''erreur est rendue'
);

select is(
  (select count(*) from public.admin_list_fact_candidates(100)),
  1::bigint,
  'ADMIN-15 — File de validation globale, toutes courses'
);

-- ============================================================
-- 2. L'audit, moitié positive
-- ============================================================
-- Les trois lectures personnelles de la section 1 — détail d'un signalement,
-- recherche, fiche — doivent avoir laissé trois traces, et trois seulement.
--
-- Ces assertions relisent `private.audit_logs`, que `authenticated` n'a pas le
-- droit d'ouvrir : elles tournent donc en `postgres`. C'est le bon angle — on
-- vérifie ce que la fonction a écrit, pas ce que l'appelant peut relire.

reset role;

select is(
  (select count(*) from private.audit_logs),
  3::bigint,
  'ADMIN-16 — trois lectures personnelles, trois lignes de journal'
);

select results_eq(
  $$ select action from private.audit_logs order by action $$,
  $$ values ('report.read'), ('user.read'), ('user.search') $$,
  'ADMIN-17 — le journal nomme les trois lectures'
);

select is(
  (select actor_user_id from private.audit_logs where action = 'user.read'),
  '88888888-8888-4888-8888-888888888888'::uuid,
  'ADMIN-18 — le journal designe l''administrateur, pas la personne consultee'
);

select is(
  (select after_data->>'query' from private.audit_logs where action = 'user.search'),
  'runner-a',
  'ADMIN-19 — la recherche journalise son terme, pas les personnes trouvees'
);

select is(
  (select entity_id from private.audit_logs where action = 'user.read'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'ADMIN-20 — la fiche journalise l''identifiant consulte'
);

/*
 * Et la preuve que le journal ne dit pas plus qu'il ne doit.
 *
 * Le terme cherché y est, volontairement — c'est lui qui rend l'accès
 * justifiable. Ce qui ne doit pas y être, c'est le résultat : ni email, ni
 * identifiant des personnes trouvées. Les recopier ferait du journal une
 * seconde copie de ce que la lecture devait seulement montrer.
 */
select results_eq(
  $$ select jsonb_object_keys(after_data)
       from private.audit_logs where action = 'user.search' order by 1 $$,
  $$ values ('matches'), ('query') $$,
  'ADMIN-21 — le journal de recherche ne porte que le terme et le nombre'
);

-- ============================================================
-- 3. Ce que l'administration ne voit toujours pas
-- ============================================================
-- §104 vaut aussi pour 0028 : les fonctions ne rouvrent pas les quatre
-- interdictions, et la fiche utilisateur ne les contourne pas.

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select is(
  (select races_count from public.admin_get_user('11111111-1111-4111-8111-111111111111')),
  1::bigint,
  'ADMIN-22 — Fiche utilisateur : un compteur de courses, pas la liste'
);

select is_empty($$ select id from public.race_plans $$,
  'ADMIN-23 — admin plateforme : toujours aucun Plan (§31, §104)');
select is_empty($$ select id from public.nutrition_plans $$,
  'ADMIN-24 — admin plateforme : toujours aucune Nutrition (§40, §104)');
select is_empty($$ select id from public.race_assistants $$,
  'ADMIN-25 — admin plateforme : toujours aucune Assistance (§43, §104)');
select is_empty($$ select id from public.outings $$,
  'ADMIN-26 — admin plateforme : toujours aucune sortie (§39, §104)');
select is_empty($$ select id from public.emergency_contacts $$,
  'ADMIN-27 — admin plateforme : toujours aucun contact d''urgence (§48)');

-- La file de triage ne porte pas le contenu signalé : la colonne n'existe pas
-- dans son type de retour, et la demander est une erreur de requête.
select throws_ok(
  $$ select details from public.admin_list_reports(10) $$,
  '42703', null,
  'ADMIN-28 — la file de signalements n''expose pas le detail'
);

select throws_ok(
  $$ select reporter_email from public.admin_list_reports(10) $$,
  '42703', null,
  'ADMIN-29 — la file de signalements ne nomme pas le declarant'
);

reset role;

-- ============================================================
-- 4. Un non-admin est refusé, pas servi à vide
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select * from public.admin_platform_counters() $$, '42501', null,
  'ADMIN-30 — Runner A refuse sur les compteurs');
select throws_ok(
  $$ select * from public.admin_list_organizations(10) $$, '42501', null,
  'ADMIN-31 — Runner A refuse sur les organisations');
select throws_ok(
  $$ select * from public.admin_list_sources(10) $$, '42501', null,
  'ADMIN-32 — Runner A refuse sur les sources');
select throws_ok(
  $$ select * from public.admin_list_nutrition_products(null, 10) $$, '42501', null,
  'ADMIN-33 — Runner A refuse sur les produits');
select throws_ok(
  $$ select * from public.admin_list_reports(10) $$, '42501', null,
  'ADMIN-34 — Runner A refuse sur les signalements');
select throws_ok(
  $$ select * from public.admin_get_report('dddddddd-0000-4000-8000-000000000031') $$,
  '42501', null,
  'ADMIN-35 — Runner A refuse sur le detail d''un signalement');
select throws_ok(
  $$ select * from public.admin_search_users(null, 10) $$, '42501', null,
  'ADMIN-36 — Runner A refuse sur la recherche d''utilisateurs');
select throws_ok(
  $$ select * from public.admin_get_user('22222222-2222-4222-8222-222222222222') $$,
  '42501', null,
  'ADMIN-37 — Runner A refuse sur la fiche d''un autre coureur');
select throws_ok(
  $$ select * from public.admin_list_jobs(10) $$, '42501', null,
  'ADMIN-38 — Runner A refuse sur les traitements');
select throws_ok(
  $$ select * from public.admin_list_audit(10) $$, '42501', null,
  'ADMIN-39 — Runner A refuse sur le journal d''audit');
select throws_ok(
  $$ select * from public.admin_list_fact_candidates(10) $$, '42501', null,
  'ADMIN-40 — Runner A refuse sur la file de validation');

reset role;

-- ============================================================
-- 5. L'audit, moitié négative
-- ============================================================
-- Les huit lectures opérationnelles ne laissent aucune trace. `lives_ok` les
-- exécute et consomme leur résultat : l'assertion porte donc à la fois sur
-- leur succès et, ensuite, sur le silence du journal.

delete from private.audit_logs;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select lives_ok($$ select * from public.admin_platform_counters() $$,
  'ADMIN-41 — les compteurs s''executent');
select lives_ok($$ select * from public.admin_list_organizations(10) $$,
  'ADMIN-42 — les organisations s''executent');
select lives_ok($$ select * from public.admin_list_sources(10) $$,
  'ADMIN-43 — les sources s''executent');
select lives_ok($$ select * from public.admin_list_nutrition_products(null, 10) $$,
  'ADMIN-44 — les produits s''executent');
select lives_ok($$ select * from public.admin_list_reports(10) $$,
  'ADMIN-45 — la file de signalements s''execute');

reset role;

select is(
  (select count(*) from private.audit_logs),
  0::bigint,
  'ADMIN-46 — les lectures operationnelles n''ecrivent rien au journal'
);

select * from finish();

rollback;
