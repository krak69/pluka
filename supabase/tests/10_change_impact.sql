-- PLUKA — Impact Analyzer : qui est concerné, et qui ne le voit pas
-- Référence : docs/engines/SOURCES_EXTRACTION.md §43, §44, §45, §46 ·
--             docs/00_PRODUCT_SPEC.md §35, §37 · docs/03_PRIVACY_RLS.md §35
--
-- POURQUOI CE FICHIER
--
-- Deux questions, et elles ne se testent pas au même endroit.
--
-- La première est métier : §44 demande d'identifier les préparations
-- « réellement concernées ». Un analyseur qui marquerait tout le monde à
-- chaque changement serait aussi inutile qu'un analyseur qui ne marquerait
-- personne. La règle vit dans une fonction SQL, et c'est donc ici qu'elle se
-- vérifie.
--
-- La seconde est de confidentialité : §37 du PRODUCT_SPEC — « ne jamais
-- exposer une liste nominative des comportements privés de préparation ». Un
-- impact dit qu'un coureur nommé doit revérifier son Plan : c'est exactement
-- ce que l'organisation ne doit pas lire.
--
-- CONTRAT DE LA SUITE
-- Chaque fichier rejoue les quatre interdictions organisation : Plan,
-- Nutrition, Assistance, sortie individuelle.

begin;

create extension if not exists pgtap;

select plan(31);

\ir _personas.psql

-- ============================================================
-- Deux coureurs de plus, pour que l'analyse ait à discriminer
-- ============================================================
-- Runner A est déjà là, avec Plan, Nutrition et assistant. On lui ajoute :
--
--   Runner B — inscrit et actif, mais sans Plan ;
--   Runner C — inscrit, avec un Plan qui ne dépend pas de la version changée ;
--   Runner D — abandonné, avec un Plan : sa préparation n'a plus d'objet.

insert into auth.users (id, email) values
  ('cccccccc-1111-4111-8111-000000000001', 'runner-c@test.pluka'),
  ('cccccccc-1111-4111-8111-000000000002', 'runner-d@test.pluka');

insert into public.participant_races (id, race_id, user_id, bib_number, status) values
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000013',
   '22222222-2222-4222-8222-222222222222', '102', 'active'),
  ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000013',
   'cccccccc-1111-4111-8111-000000000001', '103', 'active'),
  ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000013',
   'cccccccc-1111-4111-8111-000000000002', '104', 'dnf');

insert into public.race_plans
  (id, participant_race_id, version, engine_version,
   initial_target_duration_seconds, target_duration_seconds)
values
  ('cccccccc-0000-4000-8000-000000000011', 'cccccccc-0000-4000-8000-000000000002',
   1, 'plan-1.0.0', 43200, 43200),
  ('cccccccc-0000-4000-8000-000000000012', 'cccccccc-0000-4000-8000-000000000003',
   1, 'plan-1.0.0', 43200, 43200);

-- Runner B coupe ses notifications ; Runner C n'a aucune ligne de réglages,
-- ce qui doit valoir « activé » (§46, défaut de la colonne).
insert into public.participant_race_settings (participant_race_id, notifications_enabled) values
  ('cccccccc-0000-4000-8000-000000000001', false);

-- Runner D crée ses réglages pour son objectif, sans rien dire des
-- notifications : le défaut de la colonne doit les laisser actives.
insert into public.participant_race_settings (participant_race_id, target_duration_seconds) values
  ('cccccccc-0000-4000-8000-000000000003', 43200);

-- ============================================================
-- Une barrière qui change de valeur
-- ============================================================

insert into public.race_facts (id, race_id, category, fact_key) values
  ('cccccccc-0000-4000-8000-000000000020', 'aaaaaaaa-0000-4000-8000-000000000013',
   'cutoff', 'cutoff/iffigenalp/arrival');

insert into public.race_fact_versions
  (id, fact_id, version_number, value_text, workflow_status, published_at, published_by_user_id)
values
  ('cccccccc-0000-4000-8000-000000000021', 'cccccccc-0000-4000-8000-000000000020',
   1, '16:20', 'superseded', now(), '55555555-5555-4555-8555-555555555555'),
  ('cccccccc-0000-4000-8000-000000000022', 'cccccccc-0000-4000-8000-000000000020',
   2, '16:35', 'published', now(), '55555555-5555-4555-8555-555555555555');

update public.race_facts
set current_version_id = 'cccccccc-0000-4000-8000-000000000022'
where id = 'cccccccc-0000-4000-8000-000000000020';

-- §45 : « lorsqu'un Plan est confirmé, le domaine conserve les versions
-- exactes des facts utilisés ». Le Plan de Runner A dépend de la version 1 ;
-- celui de Runner C n'en déclare aucune.
insert into public.plan_version_dependencies
  (race_plan_id, race_fact_version_id, dependency_type, dependency_key)
values
  ('aaaaaaaa-0000-4000-8000-000000000041', 'cccccccc-0000-4000-8000-000000000021',
   'cutoff', 'iffigenalp');

insert into public.race_change_events
  (id, race_id, fact_id, from_version_id, to_version_id, severity, title,
   published_by_user_id)
values
  ('cccccccc-0000-4000-8000-000000000030', 'aaaaaaaa-0000-4000-8000-000000000013',
   'cccccccc-0000-4000-8000-000000000020', 'cccccccc-0000-4000-8000-000000000021',
   'cccccccc-0000-4000-8000-000000000022', 'critical', 'cutoff/iffigenalp/arrival',
   '55555555-5555-4555-8555-555555555555');

-- Un changement de contact, qui ne concerne aucune préparation.
insert into public.race_facts (id, race_id, category, fact_key) values
  ('cccccccc-0000-4000-8000-000000000040', 'aaaaaaaa-0000-4000-8000-000000000013',
   'contact', 'contact/organisation/email');

insert into public.race_fact_versions
  (id, fact_id, version_number, value_text, workflow_status, published_at, published_by_user_id)
values
  ('cccccccc-0000-4000-8000-000000000041', 'cccccccc-0000-4000-8000-000000000040',
   1, 'info@org.test', 'published', now(), '55555555-5555-4555-8555-555555555555');

insert into public.race_change_events
  (id, race_id, fact_id, to_version_id, severity, title, published_by_user_id)
values
  ('cccccccc-0000-4000-8000-000000000050', 'aaaaaaaa-0000-4000-8000-000000000013',
   'cccccccc-0000-4000-8000-000000000040', 'cccccccc-0000-4000-8000-000000000041',
   'info', 'contact/organisation/email', '55555555-5555-4555-8555-555555555555');

-- Un changement de matériel obligatoire : il concerne toute préparation.
insert into public.race_change_events
  (id, race_id, fact_id, to_version_id, severity, title, published_by_user_id)
values
  ('cccccccc-0000-4000-8000-000000000060', 'aaaaaaaa-0000-4000-8000-000000000013',
   'aaaaaaaa-0000-4000-8000-000000000093', 'aaaaaaaa-0000-4000-8000-000000000094',
   'critical', 'veste-impermeable', '55555555-5555-4555-8555-555555555555');

-- ============================================================
-- 1. La correspondance catégorie → modules (§44)
-- ============================================================

select results_eq(
  $$ select private.impacted_modules('cutoff') $$,
  $$ values (array['plan']) $$,
  'SRC-44 — une barrière concerne le Plan'
);

select results_eq(
  $$ select private.impacted_modules('start') $$,
  $$ values (array['plan', 'preparation', 'conditions']) $$,
  'SRC-44 — une heure de départ décale le Plan et les Conditions calées dessus'
);

select results_eq(
  $$ select private.impacted_modules('assistance') $$,
  $$ values (array['assistance', 'preparation']) $$,
  'SRC-44 — une règle d''assistance concerne l''Assistance et la préparation'
);

select results_eq(
  $$ select private.impacted_modules('contact') $$,
  $$ values (array[]::text[]) $$,
  'SRC-44 — un contact ne concerne aucune préparation'
);

-- ============================================================
-- 2. Qui est réellement concerné (§44, §45)
-- ============================================================

select is(
  private.analyze_change_impact('cccccccc-0000-4000-8000-000000000030'),
  1,
  'SRC-45 — un seul Plan dépend de la version remplacée'
);

select results_eq(
  $$ select participant_race_id::text, impacted_module
     from public.participant_change_impacts
     where change_event_id = 'cccccccc-0000-4000-8000-000000000030' $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000031'::text, 'plan'::text) $$,
  'SRC-45 — c''est le Plan qui déclarait la dépendance, pas un autre'
);

select is_empty(
  $$ select id from public.participant_change_impacts
     where change_event_id = 'cccccccc-0000-4000-8000-000000000030'
       and participant_race_id = 'cccccccc-0000-4000-8000-000000000002' $$,
  'SRC-45 — un Plan qui ne dépend pas de la version changée n''est pas marqué'
);

select is_empty(
  $$ select id from public.participant_change_impacts
     where change_event_id = 'cccccccc-0000-4000-8000-000000000030'
       and participant_race_id = 'cccccccc-0000-4000-8000-000000000001' $$,
  'SRC-44 — un coureur sans Plan n''a pas de Plan à revérifier'
);

-- ============================================================
-- 3. Idempotence (§22.1)
-- ============================================================

select is(
  private.analyze_change_impact('cccccccc-0000-4000-8000-000000000030'),
  0,
  'ARCH-22.1 — rejouer l''analyse ne crée aucun impact supplémentaire'
);

select is(
  (select count(*)::integer from public.participant_change_impacts
   where change_event_id = 'cccccccc-0000-4000-8000-000000000030'),
  1,
  'ARCH-22.1 — et le nombre total reste le même'
);

-- ============================================================
-- 4. Un changement sans effet ne produit rien (§44)
-- ============================================================

select is(
  private.analyze_change_impact('cccccccc-0000-4000-8000-000000000050'),
  0,
  'SRC-44 — un changement de contact ne concerne personne'
);

select is_empty(
  $$ select id from public.participant_change_impacts
     where change_event_id = 'cccccccc-0000-4000-8000-000000000050' $$,
  'SRC-44 — et aucun impact n''est écrit'
);

-- ============================================================
-- 5. Un changement de matériel concerne toute préparation active
-- ============================================================

select is(
  private.analyze_change_impact('cccccccc-0000-4000-8000-000000000060'),
  3,
  'SRC-44 — les trois coureurs actifs voient leur préparation concernée'
);

select is_empty(
  $$ select id from public.participant_change_impacts
     where change_event_id = 'cccccccc-0000-4000-8000-000000000060'
       and participant_race_id = 'cccccccc-0000-4000-8000-000000000003' $$,
  'SRC-44 — un coureur qui a abandonné n''a plus de préparation à ajuster'
);

-- ============================================================
-- 6. Rien n'est muté en aval (§46)
-- ============================================================

select is(
  (select target_duration_seconds from public.race_plans
   where id = 'aaaaaaaa-0000-4000-8000-000000000041'),
  43200,
  'SRC-46 — le Plan n''est pas recalculé : il est signalé'
);

select is(
  (select carbs_target_g_per_hour::integer from public.nutrition_plans
   where id = 'aaaaaaaa-0000-4000-8000-000000000051'),
  60,
  'SRC-46 — la Nutrition n''est pas réécrite'
);

select is(
  (select status::text from public.race_assistants
   where id = 'aaaaaaaa-0000-4000-8000-000000000061'),
  'active',
  'SRC-46 — l''Assistance n''est pas modifiée'
);

select is(
  (select status::text from public.participant_change_impacts
   where change_event_id = 'cccccccc-0000-4000-8000-000000000030'),
  'pending',
  'SRC-46 — l''impact attend une décision du coureur'
);

-- ============================================================
-- 7. L'organisation ne voit aucun impact individuel (§37)
-- ============================================================
-- « Ne jamais exposer une liste nominative des comportements privés de
-- préparation. » Un impact dit qu'un coureur nommé doit revérifier son Plan.

select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-4333-8333-333333333333', 'role', 'authenticated')::text,
  true);
set local role authenticated;

select is_empty(
  $$ select id from public.participant_change_impacts $$,
  'PRIVACY-37 — l''owner de l''organisation ne lit aucun impact individuel'
);

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555555', 'role', 'authenticated')::text,
  true);
set local role authenticated;

select is_empty(
  $$ select id from public.participant_change_impacts $$,
  'PRIVACY-37 — l''éditeur non plus, alors qu''il a publié le changement'
);

reset role;

-- Le coureur concerné, lui, doit voir le sien : sans cela l'analyse ne sert
-- à rien (§46, « le coureur est informé »).
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text,
  true);
set local role authenticated;

select isnt_empty(
  $$ select id from public.participant_change_impacts $$,
  'SRC-46 — le coureur concerné lit son propre impact'
);

reset role;

-- Un autre coureur de la même course ne voit pas ceux de son voisin.
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text,
  true);
set local role authenticated;

select is_empty(
  $$ select id from public.participant_change_impacts
     where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031' $$,
  'PRIVACY-37 — un coureur ne lit pas les impacts d''un autre'
);

reset role;

-- ============================================================
-- 7 bis. La préférence de notification (§46, 02_DATA_MODEL §9.2)
-- ============================================================
-- Le changement de matériel concerne les trois coureurs actifs. Runner B a
-- coupé ses notifications : il garde son impact, il ne reçoit pas d'email.

select is(
  (select count(*)::integer from private.notification_deliveries
   where change_event_id = 'cccccccc-0000-4000-8000-000000000060'),
  2,
  'SRC-46 — deux livraisons pour trois coureurs concernés : un a dit non'
);

select is_empty(
  $$ select id from private.notification_deliveries
     where change_event_id = 'cccccccc-0000-4000-8000-000000000060'
       and participant_race_id = 'cccccccc-0000-4000-8000-000000000001' $$,
  'SRC-46 — le coureur qui a coupé ses notifications n''en reçoit aucune'
);

select isnt_empty(
  $$ select id from public.participant_change_impacts
     where change_event_id = 'cccccccc-0000-4000-8000-000000000060'
       and participant_race_id = 'cccccccc-0000-4000-8000-000000000001' $$,
  'SRC-46 — mais son impact reste écrit : couper l''email ne coupe pas l''information'
);

select isnt_empty(
  $$ select id from private.notification_deliveries
     where change_event_id = 'cccccccc-0000-4000-8000-000000000060'
       and participant_race_id = 'cccccccc-0000-4000-8000-000000000002' $$,
  'SRC-46 — sans ligne de réglages, le coureur est notifié'
);

-- Le défaut de la colonne compte pour lui-même : une ligne de réglages créée
-- pour une autre raison — objectif, Nutrition — ne doit pas couper les
-- notifications au passage. §46 fait de l'information la règle.
select is(
  (select notifications_enabled from public.participant_race_settings
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000003'),
  true,
  'SRC-46 — une ligne de réglages écrite sans la colonne laisse les notifications actives'
);

-- ============================================================
-- 8. Les quatre interdictions organisation (contrat de suite)
-- ============================================================

select set_config('request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-8444-444444444444', 'role', 'authenticated')::text,
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
